---
title: MCP Security Lab — Breach-to-Fix 練習紀錄
source: https://github.com/KJLavender/mcp-security-lab/blob/main/README.zh-TW.md
acl: public
---

# MCP Security Lab — Breach-to-Fix 練習紀錄

[English](README.md) | **繁體中文**

針對 [PawelKozy/mcp-breach-to-fix-labs](https://github.com/PawelKozy/mcp-breach-to-fix-labs) 的 9 個 MCP 漏洞情境：
逐題重現攻擊、自己寫修補、用協定層（直接送 MCP `tools/call`，不經過 AI）的 pytest 回歸測試驗證。

> 本 repo **不包含** lab 原始碼（上游沒有 LICENSE）。只有：我的修補（`mine/`）、測試（`tests/`）、筆記與啟停腳本。
> 需要時 `mine/` 會在容器內 `import server as upstream` 重用官方的種子資料，而不是複製程式碼。

## 結構

| 路徑 | 內容 |
|---|---|
| `mine/labNN/server.py` | 我的修補版 MCP server |
| `mine/lab04/readonly_role.sql` | Lab 04 的主控制點：DB 唯讀角色 |
| `tests/test_labNN_*.py` | 每題的回歸測試（漏洞版要被打穿、修補版要擋住、正常功能要保留） |
| `labctl.sh` | 在 WSL 用 docker 啟停所有 lab（vulnerable / 官方 secure / mine 三版，只綁 127.0.0.1） |
| `inspector_repro.sh` | 用 MCP Inspector CLI 重現每題核心攻擊，原始回應存 `evidence/inspector/` |
| `runtests.sh` / `run_all.sh` | 在拋棄式容器裡跑 pytest／一鍵重建 + 測試 + 收掉 |
| `NOTES.md` | 每題筆記：攻擊面、根因、我的修法、官方差異、takeaway |

## 怎麼跑

```bash
git clone https://github.com/PawelKozy/mcp-breach-to-fix-labs ~/mcp-labs/mcp-breach-to-fix-labs
./run_all.sh -v          # 重建全部容器 → pytest → 收掉容器
KEEP_UP=1 ./run_all.sh   # 跑完保留容器，方便用 MCP Inspector 手動戳
```

每個測試都對三個 target 跑：

- `vulnerable`：攻擊必須成功（證明漏洞存在、測試有效）
- `secure`（官方修補）與 `mine`（我的修補）：攻擊必須被擋，且正常功能仍可用
- 標成 `xfail(strict)` 的是**官方 secure 仍有的缺口**：secure 預期失敗、mine 必須通過

測試結果見 [NOTES.md](NOTES.md#測試結果)。
