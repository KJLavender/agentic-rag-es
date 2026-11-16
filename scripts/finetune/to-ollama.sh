#!/usr/bin/env bash
# 把 train.py 輸出的 HF 模型轉成 GGUF，註冊成 Ollama 模型（預設名稱 bge-m3-ft），之後用 EMBED_MODEL=bge-m3-ft 就會用它。
#
#   bash scripts/finetune/to-ollama.sh
#
# 需要：.cache/ft-venv（train.py 的環境）、llama.cpp 原始碼裡的 convert_hf_to_gguf.py（LLAMA_CPP_SRC）、
# 可以執行 ollama 的環境（這台機器的 Ollama 跑在 WSL，所以透過 wsl 呼叫）。
set -euo pipefail

SRC=${LLAMA_CPP_SRC:-.cache/llama/llama.cpp-b11972}
MODEL_DIR=${MODEL_DIR:-.cache/ft/bge-m3-ft}
NAME=${OLLAMA_NAME:-bge-m3-ft}
GGUF=$MODEL_DIR.f16.gguf
PY=.cache/ft-venv/Scripts/python.exe
[ -x "$PY" ] || PY=.cache/ft-venv/bin/python

# XLM-RoBERTa 的轉檔要 sentencepiece 的原始詞表；sentence-transformers 存檔時不一定會帶，從 base 模型補
if [ ! -f "$MODEL_DIR/sentencepiece.bpe.model" ]; then
  BASE_SP=$("$PY" -c "from huggingface_hub import hf_hub_download as d; print(d('BAAI/bge-m3', 'sentencepiece.bpe.model'))")
  cp "$BASE_SP" "$MODEL_DIR/"
fi

PYTHONIOENCODING=utf-8 "$PY" "$SRC/convert_hf_to_gguf.py" "$MODEL_DIR" --outfile "$GGUF" --outtype f16

# 跟 Ollama 官方 bge-m3 一樣只有 FROM，pooling / normalize 寫在 GGUF metadata 裡
printf 'FROM %s\n' "$(basename "$GGUF")" > "$MODEL_DIR.Modelfile"
if command -v ollama >/dev/null 2>&1; then
  (cd "$(dirname "$GGUF")" && ollama create "$NAME" -f "$(basename "$MODEL_DIR").Modelfile")
else
  WIN_DIR=$(cd "$(dirname "$GGUF")" && pwd -W 2>/dev/null || pwd)
  WSL_DIR=$(wsl -- wslpath -a "$WIN_DIR" | tr -d '\r')
  MSYS_NO_PATHCONV=1 wsl -- bash -lc "cd '$WSL_DIR' && ollama create '$NAME' -f '$(basename "$MODEL_DIR").Modelfile'"
fi
echo "Ollama 模型 $NAME 已建立：EMBED_MODEL=$NAME"
