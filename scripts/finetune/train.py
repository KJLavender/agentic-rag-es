"""
用自己的語料微調 bge-m3（InfoNCE / in-batch negatives），解決「問法跟文件用詞不同就搜不到」。

    .cache/ft-venv/Scripts/python scripts/finetune/train.py

- 資料：scripts/finetune/make-queries.ts 產生的 .cache/ft/train.jsonl、val.jsonl（評測題沒有參與）。
- Loss：CachedMultipleNegativesRankingLoss = InfoNCE，同一批的其他片段當負例；
  另外替每個問題挑 1 個「base 模型覺得很像、但不是答案」的困難負例。GradCache 讓 8GB GPU 也能用 32 的 batch。
- 只訓練 LoRA（attention 的 query/key/value/dense），原本 5.7 億參數凍結：
  全參數微調的 optimizer 狀態放不進 8GB GPU，LoRA 只要多幾 MB。訓練完合併回權重，輸出一般的 HF 模型。
- 訓練前後各用驗證集算一次 MRR@10 / Recall@10，確認沒有學壞。

輸出：.cache/ft/bge-m3-ft/（之後用 scripts/finetune/to-ollama.sh 轉 GGUF 放進 Ollama）
參數：FT_LR、FT_EPOCHS、FT_BATCH、FT_HARD_NEG=0/1、FT_SAVE=0（只看分數不存檔）。
結果：在這份語料上，每組參數在調整組都輸給沒微調的 bge-m3（見 README 的「Fine-tuning the embedding model」）。
"""
import json
import os
import random

import torch
from datasets import Dataset
from peft import LoraConfig, TaskType, get_peft_model
from sentence_transformers import SentenceTransformer, SentenceTransformerTrainer, SentenceTransformerTrainingArguments
from sentence_transformers.evaluation import InformationRetrievalEvaluator
from sentence_transformers.losses import CachedMultipleNegativesRankingLoss
from sentence_transformers.training_args import BatchSamplers
from sentence_transformers.util import mine_hard_negatives

OUT = ".cache/ft"
BASE = os.environ.get("FT_BASE", "BAAI/bge-m3")
EPOCHS = float(os.environ.get("FT_EPOCHS", "2"))
LR = float(os.environ.get("FT_LR", "1e-4"))
BATCH = int(os.environ.get("FT_BATCH", "32"))
HARD_NEG = os.environ.get("FT_HARD_NEG", "1") == "1"
SAVE = os.environ.get("FT_SAVE", "1") == "1"
random.seed(42)
torch.manual_seed(42)


def load(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


train, val = load(f"{OUT}/train.jsonl"), load(f"{OUT}/val.jsonl")
print(f"train {len(train)} pairs, val {len(val)} pairs, base {BASE}")

model = SentenceTransformer(BASE, device="cuda", model_kwargs={"torch_dtype": torch.float32})
model.max_seq_length = 512

# 驗證：val 的問題 → 在「全部片段」裡找它的片段
corpus = {}
for p in train + val:
    corpus.setdefault(p["chunk_id"], p["pos"])
queries = {f"q{i}": p["query"] for i, p in enumerate(val)}
relevant = {f"q{i}": {p["chunk_id"]} for i, p in enumerate(val)}
evaluator = InformationRetrievalEvaluator(queries, corpus, relevant, name="val", mrr_at_k=[10], accuracy_at_k=[1, 5], precision_recall_at_k=[10], ndcg_at_k=[10], show_progress_bar=False)
before = evaluator(model)
print("before", {k: round(v, 4) for k, v in before.items() if "mrr" in k or "recall" in k or "accuracy" in k})


def tune_mrr(m):
    """調整組（eval/golden.json 的 tune）向量檢索 MRR@10：選訓練參數用。檔案由 export-eval.ts 產生，沒有就跳過。"""
    path = f"{OUT}/tune-eval.json"
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    ids = [c["id"] for c in data["chunks"]]
    emb = m.encode([c["text"] for c in data["chunks"]], batch_size=16, normalize_embeddings=True, convert_to_tensor=True)
    total = 0.0
    for q in data["questions"]:
        allowed = set(q["groups"]) | {"public"}
        qv = m.encode([q["query"]], normalize_embeddings=True, convert_to_tensor=True)
        scores = (emb @ qv.T).squeeze(1).tolist()
        order = [ids[i] for i in sorted(range(len(ids)), key=lambda i: -scores[i]) if allowed & set(data["chunks"][i]["acl"])][:10]
        rank = next((i + 1 for i, cid in enumerate(order) if cid in q["relevant"]), 0)
        total += 1 / rank if rank else 0
    return round(total / len(data["questions"]), 4)


tune_before = tune_mrr(model)
print("tune before", tune_before)

# 困難負例：base 模型排在前面、但不是正確片段的片段（太像的跳過，避免其實也是答案）
ds = Dataset.from_list([{"anchor": p["query"], "positive": p["pos"]} for p in train])
if HARD_NEG:
    ds = mine_hard_negatives(ds, model, corpus=list(corpus.values()), range_min=1, range_max=15, relative_margin=0.05, num_negatives=1, sampling_strategy="top", batch_size=32, use_faiss=False)
print(f"training rows: {len(ds)} (hard negatives: {HARD_NEG})")

# 用 peft 直接包住底層的 XLMRobertaModel（model[0].model；auto_model 是唯讀屬性）：訓練完才能 merge_and_unload 合併回權重
model[0].model = get_peft_model(model[0].model, LoraConfig(task_type=TaskType.FEATURE_EXTRACTION, r=16, lora_alpha=32, lora_dropout=0.1, target_modules=["query", "key", "value", "dense"]))
trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
print(f"trainable params: {trainable:,}")

loss = CachedMultipleNegativesRankingLoss(model, mini_batch_size=4)
args = SentenceTransformerTrainingArguments(
    output_dir=f"{OUT}/checkpoints",
    num_train_epochs=EPOCHS,
    per_device_train_batch_size=BATCH,
    learning_rate=LR,
    warmup_ratio=0.1,
    fp16=True,
    batch_sampler=BatchSamplers.NO_DUPLICATES,  # 同一個片段的多個問題不要擠在同一批，否則彼此會被當成負例
    eval_strategy="epoch",
    save_strategy="no",
    logging_steps=5,
    report_to="none",
    seed=42,
)
trainer = SentenceTransformerTrainer(model=model, args=args, train_dataset=ds, loss=loss, evaluator=evaluator)
trainer.train()

after = evaluator(model)
print("after", {k: round(v, 4) for k, v in after.items() if "mrr" in k or "recall" in k or "accuracy" in k})
tune_after = tune_mrr(model)
print("tune after", tune_after, f"(lr={LR}, epochs={EPOCHS}, hard_neg={HARD_NEG})")
if not SAVE:
    raise SystemExit(0)

# 合併 LoRA，存成一般的 HF 模型（轉 GGUF 用）
model[0].model.save_pretrained(f"{OUT}/lora-adapter")  # 先存 adapter，合併出錯也不用重訓
model[0].model = model[0].model.merge_and_unload()
model.save(f"{OUT}/bge-m3-ft")
with open(f"{OUT}/train-report.json", "w", encoding="utf-8") as f:
    json.dump({"base": BASE, "epochs": EPOCHS, "lr": LR, "batch": BATCH, "hard_negatives": HARD_NEG, "train_pairs": len(train), "val_pairs": len(val), "before": before, "after": after, "tune_mrr_before": tune_before, "tune_mrr_after": tune_after}, f, indent=2)
print("saved", f"{OUT}/bge-m3-ft")
