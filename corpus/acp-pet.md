---
title: 🐣 acp-pet:會演出 coding agent 在幹嘛的桌寵
source: https://github.com/KJLavender/acp-pet/blob/main/README.zh-TW.md
acl: public
---

# 🐣 acp-pet:會演出 coding agent 在幹嘛的桌寵

[English](README.md) | **繁體中文**

住在桌面上的寵物,其實是一個 [ACP](https://agentclientprotocol.com) coding agent(Claude Code、Codex、Gemini…)的擬人化儀表板。牠不聊天、也不靠讀 log 猜——牠直接吃 agent 真實的 `session/update` 事件流,事件發生的當下就演給你看。預設的寵物是《蔚藍檔案》的ヒカリ和ノゾミ([見下方](#ヒカリ與ノゾミ));另外還有程式畫的小雞,任何 Codex 角色包也都能用。

<p align="center">
  <img src="docs/pets/hikari.gif" width="192" height="208" alt="ヒカリ Hikari">
  <img src="docs/pets/nozomi.gif" width="192" height="208" alt="ノゾミ Nozomi">
</p>
<p align="center"><img src="docs/showcase.png" width="100%" alt="ヒカリ和ノゾミ的每個動作,插畫版與像素版"></p>

內建的小雞:

![poses](docs/poses.png)

| agent 在做什麼 | 小雞在做什麼 |
|---|---|
| 思考 / 列計畫 | 💡 頭上冒燈泡、踱步 |
| `tool_call` read / search | 📖 翻書 |
| `tool_call` edit / delete / move | ⌨️ 瘋狂打字 |
| `tool_call` execute | 🔨 在鐵砧上敲榔頭 |
| `tool_call` fetch | 🔭 拿望遠鏡 |
| `request_permission` | 🪧 舉牌跑過來問你:**准 / 不准**(60 秒沒回就自動拒絕) |
| turn 成功 | 💛 開心跳 + 愛心(經驗值夠就 ✨ 升級) |
| turn 失敗 | 🤒 變灰、頭上烏雲下雨 |
| 權限被拒 / 被取消 | 😤 轉過去生悶氣 |
| 閒太久 | 💤 無聊打滾,然後睡著 |

上面再疊一層電子雞數值。**體力**每次 tool call 都會掉,睡覺時回復。**無聊值**閒置時上升,高到一定程度小雞會跑來討任務。每完成一個任務拿 **XP**,**連勝**有額外加成。內建小雞 Lv.3 長雞冠、Lv.5 戴皇冠。全部存在 `~/.acp-pet/`。

![features](docs/features.png)

## ヒカリ與ノゾミ

預設的兩隻寵物是《蔚藍檔案》的橘家雙胞胎:**ヒカリ(Hikari)**淡定、會在帽簷敬禮;**ノゾミ(Nozomi)**綁側馬尾、露虎牙笑。兩隻都完全用程式畫出來,沒有用任何生圖工具,而且各有兩種畫風,可以在右鍵 → 外表切換:

- **插畫風**(`hikari`、`nozomi`,預設):平滑的 Q 版插畫。`scripts/pets/draw_twins_hd.py` 先用 4 倍解析度畫每一張,再縮小去鋸齒,最後加上貼紙描邊。
- **像素風**(`hikari-pixel`、`nozomi-pixel`):`scripts/pets/draw_twins.py` 畫的 48×52 像素圖放大 4 倍,顯示時用銳利的最近鄰縮放。

最上方的預覽動畫是插畫版,會依序播完每一列動作,最後是轉頭看四周;像素版的預覽在 `docs/pets/*-pixel.gif`。

- 她們是 **Codex pet v2** 角色包(`pets/<id>/pet.json` + 8×11 格的 `spritesheet.webp`),跟 [awesome-codex-pet](https://github.com/legeling/awesome-codex-pet) 同一個格式,也都通過該專案官方的 `validate_atlas.py`,沒有任何錯誤。
- v2 角色包有 16 個看的方向,所以閒著時寵物會**轉頭看你的滑鼠**。
- Codex 也能用:`npm run pets:install-codex` 會把她們複製到 `~/.codex/pets/`,再到 Codex 設定裡選。
- 改了腳本想重畫:`npm run pets:draw`(需要 Python + Pillow)。
- 這是同人二創,詳見 [ASSETS-LICENSE.md](ASSETS-LICENSE.md):角色版權屬於 NEXON Games / Yostar,sprite 僅限非商業使用。

## 快速開始

```bash
npm install
npm run demo      # 腳本示範,不需要 agent
npm start         # 正式版
```

- **單擊**小雞摸摸牠,**雙擊**餵任務,**拖曳**移動位置。
- **右鍵**(或托盤圖示)開選單:示範、外表、日記、睡覺、新增寵物、比賽、大小、置頂、唸出台詞、自由走動、離開。
- 任務框可以輸入:

| 輸入 | 會發生什麼 |
|---|---|
| `修好那個壞掉的測試` | 送給真的 agent |
| `/demo`、`/fail` | 腳本演出:一次成功、一次失敗 |
| `/flow 第一步 >> 第二步 >> 第三步` | **接力賽**:同一個 session 裡一棒接一棒跑,有「第 2/3 棒」徽章;哪一棒失敗就停 |

## 多寵物與比賽

選單 →「**新增一隻寵物**」會在桌面多放一隻。每隻都有自己的 agent、workspace、外表和存檔。選單 →「**比賽**」把同一個任務同時丟給所有閒著的寵物,最先完成的拿 🏆 和 15 點額外 XP,其他的生悶氣。想讓不同 agent 互相比(Claude vs Codex),就在設定檔裡給每隻填不同的 `agent`。

## 在桌面上生活

像經典的 [Shimeji](https://kilkakon.com/shimeji/) 一樣,你在忙別的事時,寵物不會只是站著:

- 沿著螢幕底部**走來走去**,高度維持在你放的位置。
- 兩隻都閒著時,會**走到對方旁邊聊天**(ヒカリ和ノゾミ有專屬的雙胞胎對話)。
- 滑鼠靠近時,偶爾會**轉向你打招呼**。
- 偶爾會**自言自語**。

工作中、舉牌問你時、被拖曳時,以及你把她放好之後的 1 分鐘內,她都會乖乖待著;滑鼠停在她身上時也不會走開。右鍵 →「**自由走動・互動**」可以整個關掉(設定檔的 `"wander": false`)。

## 外表(換膚)

選單 →「**外表**」可以換寵物的樣子,共三種:

1. **內建外表**:ヒカリ和ノゾミ(見上方),加上程式畫的小雞五種配色:小黃雞、雪白鴨、薄荷史萊姆、櫻花雞、夜貓。小雞版附有手畫道具(書、鍵盤、榔頭…)。
2. **自己的圖片**:在 `~/.acp-pet/skins/` 開一個資料夾(選單 → 外表 →「打開外表資料夾」),每個動作放一張圖。PNG、GIF(會動的也可以)、WebP、JPG 都行。只有 `idle` 是必要的,缺的動作會自動退回:

   ```
   ~/.acp-pet/skins/my-cat/
   ├── idle.gif        ← 必要
   ├── working.gif     ← 想、讀、打字、敲榔頭、望遠鏡都會用這張
   ├── happy.png       ← 升級也用這張
   ├── sick.png        ← 生悶氣也用這張
   ├── reading.png     ← 用動作名稱命名就會蓋過退回規則(動作名見上表)
   └── skin.json       ← 選填:{ "name": "我的貓", "pixelated": true }
   ```

   圖片外表沒有手畫的道具,所以寵物會顯示一個徽章(📖 ⌨️ 🔨 🪧 …),再加上跳、抖、搖的動態,讓你看得出牠在做什麼。
3. **Codex 角色包**:把角色包資料夾(`pet.json` + 每格 192×208 的 spritesheet;v1 是 8×9 格,v2 是 8×11 格)丟進 `~/.acp-pet/skins/` 就能直接用。[awesome-codex-pet](https://github.com/legeling/awesome-codex-pet) 或 [OpenPet](https://github.com/dengyie/OpenPet) 上幾百隻寵物都能拿來套,v2 的還會轉頭看你的滑鼠。

每次打開選單都會重新掃描資料夾,新放的外表不用重開就會出現。超過 8 MB 的圖、指到外表資料夾外面的路徑一律拒絕。

## 設定

第一次啟動會產生 `~/.acp-pet/config.json`:

```json
{
  "pets": [
    { "id": "pet1", "name": "ヒカリ", "agent": "claude", "workspace": "C:\\Users\\you\\acp-pet-workspace", "skin": "hikari" }
  ],
  "permissionTimeoutSec": 60,
  "scale": 1,
  "alwaysOnTop": true,
  "tts": false,
  "wander": true
}
```

- `agent` 填任何 [acpx 支援的 agent 名稱](https://github.com/openclaw/acpx),該 agent 要先裝好並登入。用 `claude` 的話,acpx 會自動抓 `@agentclientprotocol/claude-agent-acp` adapter。
- `scale`(75%–200%)、`alwaysOnTop`(永遠在最上層)、`tts`(唸出台詞)、`wander`(自己走動、聊天)也都可以從選單改。
- v0.1 的設定檔(`{ "agent", "workspace" }`)會自動轉成新格式。

## 🔒 安全

acpx **不是沙箱**,所以桌寵自己加了幾道護欄:

- **權限預設拒絕(Fail-Closed)**:read、search、think 自動放行。其他動作(edit、execute、fetch…)都要你點**准**,超時沒回就當作拒絕。
- 關掉 acpx 的 client 端 fs/terminal callback,讓 `request_permission`(也就是小雞舉的牌子)成為唯一的關卡。
- 每隻寵物的 `workspace` 都必須是專用資料夾。家目錄、磁碟根目錄、`~/.ssh`、`~/.aws`、`~/.gnupg`、`~/.config`、`~/.acp-pet` 一律拒絕。
- 接力賽是在寵物自己的 session 上跑,不用 acpx 的 `FlowRunner`,因為 `FlowRunner` 沒有權限 callback,會繞過舉牌這一關。
- 要真正隔離,請讓 agent 跑在獨立使用者或容器裡。

## 架構

```
acpx runtime ─ AcpRuntimeEvent ─▶ AcpEventNormalizer ─ PetEvent ─▶ PetBrain ─ PetSnapshot ─▶ renderer(sprite / 外表)
      ▲                                                                ▲
      └──── onPermissionRequest ──▶ PermissionGate ──── 舉牌 ──────────┘ ◀── 准 / 不准
```

| 檔案 | 職責 |
|---|---|
| `src/core/acp-source.ts` | **唯一碰 acpx 的檔案**(acpx 還沒 1.0,對接集中在一處) |
| `src/core/brain.ts` | 狀態機 + 事件 → 動作映射表 + 電子雞數值;不讀系統時鐘、行為可重現 |
| `src/core/permission.ts` | 預設拒絕、有超時的權限關卡 |
| `src/core/controller.ts` | 把一隻寵物串起來,也負責接力賽;不依賴 Electron |
| `src/core/race.ts` | 比賽裁判 |
| `src/core/ambient.ts` | 桌面生活:決定下一步誰散步、誰聊天、誰跟你打招呼 |
| `src/core/skins.ts` | 載入外表:配色、圖片資料夾、Codex 角色包(v1 和 v2) |
| `src/core/look.ts` | v2 看游標:游標角度 → 16 張畫面中的一張 |
| `pets/` | 內建角色包:ヒカリ和ノゾミ,插畫版與像素版 |
| `scripts/pets/draw_twins_hd.py` | 畫插畫版ヒカリ和ノゾミ的 spritesheet |
| `scripts/pets/draw_twins.py` | 畫像素版,也定義兩種畫風共用的動畫列 |
| `src/core/fake-source.ts` | `/demo`、`/fail` 的腳本 |
| `src/main/` | Electron:每隻寵物一個透明、可點穿的視窗,托盤、選單、設定 |
| `src/renderer/` | 零素材像素 sprite、外表繪製、對話氣泡、權限牌子、TTS |

## 測試

```bash
npm test          # 123 個單元 + 整合測試
npm run smoke     # 真的開 Electron:所有動作、所有外表、ヒカリ和ノゾミ加上看游標、150% 大小、TTS、接力賽、兩隻比賽、自己散步聊天(30 項檢查,截圖存在 smoke-out/)
ACP_PET_LIVE=1 npx vitest run test/live.test.ts   # 在暫存資料夾驅動真的 agent:一次任務 + 兩棒接力(會用到額度)
```

## 致謝 / 參考

- [acpx](https://github.com/openclaw/acpx):ACP runtime
- [qq-slime-pet](https://github.com/DTSFO/qq-slime-pet):零素材 canvas 像素 sprite、點穿判定的做法
- [Shimeji](https://kilkakon.com/shimeji/):會自己在桌面上走動、生活的桌寵始祖
- [awesome-codex-pet](https://github.com/legeling/awesome-codex-pet):Codex pet v2 規格與 `validate_atlas.py`
- [OpenPet](https://github.com/dengyie/OpenPet):Codex 角色包的格式
- [codex-has-a-pet-too](https://github.com/ChenxiChu001/codex-has-a-pet-too)、[miku-on-desktop](https://github.com/thunguo/miku-on-desktop):啟發這個專案的其他 agent 桌寵

## 授權

程式碼:MIT。ヒカリ和ノゾミ的 sprite 是蔚藍檔案的同人二創,僅限非商業使用,詳見 [ASSETS-LICENSE.md](ASSETS-LICENSE.md)。
