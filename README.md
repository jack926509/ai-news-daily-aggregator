# 每日 AI 新聞聚合系統

自動收集昨日 AI／科技新聞、透過 GPT-4o 萃取重點，每日 07:30（台北時間）推播至 Telegram。

---

## 目錄

- [系統架構](#系統架構)
- [技術棧](#技術棧)
- [新聞來源](#新聞來源)
- [環境變數](#環境變數)
- [本地開發](#本地開發)
- [Zeabur 部署](#zeabur-部署)
- [API 端點](#api-端點)
- [修改歷程](#修改歷程)
- [未來優化方向](#未來優化方向)

---

## 系統架構

```
RSS Feeds (8 個來源)
       ↓ 每個 feed 抓最多 10 篇，篩選「昨日」文章
fetchAllFeeds(start, end)
       ↓
GPT-4o 分析（30s timeout）
       ↓  JSON: headline + highlights(3~5) + insight
快取 30 分鐘（防重複打 OpenAI）
       ↓
Telegram Bot sendMessage（HTML 格式，關閉 link preview）
  排程：每日 07:30 Asia/Taipei
  手動：POST /api/send-telegram
```

---

## 技術棧

| 層級 | 技術 |
|------|------|
| 前端 | React、Vite、Tailwind CSS |
| 後端 | Express.js、Node.js（TypeScript） |
| AI 摘要 | OpenAI GPT-4o |
| RSS 解析 | rss-parser |
| 推播 | Telegram Bot API（HTML parse_mode） |
| 排程 | node-cron（Asia/Taipei） |
| 部署 | Zeabur |

---

## 新聞來源

| 來源 | 語言 | 類型 |
|------|------|------|
| TechCrunch AI | 英文 | AI 專區 |
| VentureBeat AI | 英文 | AI 專區 |
| MIT Technology Review AI | 英文 | 深度報導 |
| The Verge AI | 英文 | 科技媒體 |
| Wired AI | 英文 | 科技媒體 |
| TechNews 科技新報 AI | 繁中 | AI 專區 |
| iThome | 繁中 | 科技媒體 |
| 聯合新聞網科技 | 繁中 | 科技版 |

---

## 環境變數

在 `.env`（本地）或 Zeabur 環境變數設定以下三個必填項：

```env
OPENAI_API_KEY=          # OpenAI 金鑰（用於 GPT-4o 摘要）
TELEGRAM_BOT_TOKEN=      # BotFather 給的 Token
TELEGRAM_CHAT_ID=        # 個人 ID、群組 ID（負數）或頻道 @username
```

### 取得 Telegram 設定值

**Bot Token**：在 Telegram 搜尋 `@BotFather` → `/newbot` → 取得 Token

**Chat ID**：
- 個人：搜尋 `@userinfobot`，它會回傳你的 `id`
- 群組：把 Bot 加入群組後傳一則訊息 → 開啟 `https://api.telegram.org/bot{TOKEN}/getUpdates` → 找 `"chat":{"id":-xxxxxxxxx}`
- 頻道：把 Bot 設為管理員 → Chat ID 用 `@頻道username` 或負數 ID

---

## 本地開發

```bash
# 安裝相依套件
npm install

# 建立 .env 並填入環境變數
cp .env.example .env

# 啟動開發伺服器（含 Vite HMR）
npm run dev
```

開啟 `http://localhost:3000` 查看介面。

---

## Zeabur 部署

1. **綁定子網域**：Zeabur 控制台 → 網路 → **+ 綁定 Zeabur 子網域**，輸入想要的名稱
2. **設定環境變數**：Zeabur → 環境變數，填入上方三個必填項
3. **推送程式碼**：推送至 GitHub，Zeabur 自動重新部署

---

## API 端點

| 方法 | 路徑 | 說明 |
|------|------|------|
| `GET` | `/api/news` | 取得結構化新聞摘要 JSON |
| `POST` | `/api/send-telegram` | 立即手動推播至 Telegram |

**手動推播範例：**
```bash
curl -X POST https://your-domain.zeabur.app/api/send-telegram
```

---

## 修改歷程

### v1.0 — 初始版本
> 建立基本 RSS 聚合與 OpenAI 摘要功能

- 從 5 個 RSS 來源（英文 5）抓取最新文章
- GPT-4o 分析並產出 `headline / highlights / insight` JSON 結構
- Express 提供 `/api/news` 端點
- 基礎 React 前端呈現

---

### v1.1 — 推播平台：LINE → Telegram
> 🔧 **後端工程師**：整合 Telegram Bot API，移除所有 LINE 相關程式碼

- 移除 `LINE_CHANNEL_ACCESS_TOKEN`、`LINE_USER_ID`、`LINE_CHANNEL_SECRET` 等依賴
- 改用 Telegram Bot API `sendMessage` 端點
- 新增 `POST /api/send-telegram` 手動推播端點
- 移除 LINE Webhook 路由（`/api/webhook`、`/callback`）

---

### v1.2 — 昨日新聞篩選
> 📰 **新聞主編**：確保推播內容為前一整日的完整新聞，而非即時快訊

- 新增 `getYesterdayRange()`：以 `Asia/Taipei` 時區精確計算昨日 00:00:00 ～ 23:59:59
- `fetchAllFeeds` 加入日期過濾，以 `isoDate` / `pubDate` 為準
- 每個 feed 掃描上限從 3 篇提升至 10 篇，確保有足夠昨日文章
- 若昨日完全無文章，提前拋錯不呼叫 OpenAI，避免無意義費用
- `formatTelegramMessage` 標題改顯示「昨日回顧」與正確昨日日期

---

### v1.3 — 三角色全面審查
> 📰 **新聞主編** × 🎨 **前端工程師** × 🔧 **後端工程師**

**新聞主編：**
- 修正 prompt 中「今日最重要」→「昨日最重要」
- 新增 AI 相關性過濾規則：「僅選取與 AI／ML／LLM／科技產業直接相關的新聞」
- 明確禁止 summary 使用「值得注意」「令人矚目」等評價性語言
- 新增英文來源：The Verge AI、Wired AI；新增繁中來源：聯合新聞網

**前端工程師：**
- 切換至 `parse_mode: HTML`，支援 `<b>` 粗體標題、`<i>` 斜體說明
- 連結改為 `<a href="...">閱讀全文 →</a>`，不再顯示裸 URL
- 新增 `link_preview_options: { is_disabled: true }`，防止多篇新聞產生多個預覽卡片
- 新增 `escapeHtml()` 處理 `&`、`<`、`>` 防止 HTML 格式破版

**後端工程師：**
- 新增 `withTimeout()` 通用包裝，套用至 RSS（8s）、OpenAI（30s）、Telegram API（10s）
- `choices[0]?.message?.content` 加 optional chaining，空值提前拋出明確錯誤
- `JSON.parse` 包 `try-catch`，格式錯誤時拋出可讀訊息而非 crash
- RSS 失敗 log 加入 `error.message` 提升可觀測性

---

## 未來優化方向

### 📰 新聞主編觀點

| 優先級 | 項目 | 說明 |
|--------|------|------|
| 高 | 新聞去重 | 同一事件被多個來源報導時，合併為一則，避免重複 |
| 高 | 多語言摘要 | 同時輸出繁中與英文版本，擴大受眾 |
| 中 | 新聞分類標籤 | 自動標記「大型模型」「AI 法規」「硬體」「應用」等類別，方便讀者快篩 |
| 中 | 重要性評分 | 讓 GPT-4o 對每則新聞標注影響力評分（1-5），輔助排序依據透明化 |
| 低 | 周報／月報 | 彙整一週／一月重大事件，提供更宏觀的產業脈絡 |
| 低 | 來源可信度標注 | 標記來源媒體屬性（研究機構、商業媒體、廠商 PR），讓讀者判斷資訊性質 |

---

### 🎨 前端工程師觀點

| 優先級 | 項目 | 說明 |
|--------|------|------|
| 高 | Telegram inline keyboard | 為每則新聞加上「閱讀原文」按鈕（`InlineKeyboardButton`），取代文字連結，點擊體驗更直覺 |
| 高 | 網頁介面響應式優化 | 手機端卡片排版、字體大小、連結點擊區域優化 |
| 中 | 訊息分段推送 | 若內容超過 4096 字元，智慧斷點拆成多則訊息，而非強制截斷 |
| 中 | 網頁暗黑模式 | 配合 Tailwind dark mode，偵測系統設定自動切換 |
| 低 | Telegram 頻道置頂訊息 | 每次推播後自動釘選最新一則，讓訂閱者快速找到最新內容 |
| 低 | 訂閱確認訊息 | 首次加入 Bot 時自動回覆歡迎說明與推播時間 |

---

### 🔧 後端工程師觀點

| 優先級 | 項目 | 說明 |
|--------|------|------|
| 高 | 推播失敗重試機制 | Telegram API 失敗時加入指數退避重試（最多 3 次），避免單次網路抖動導致漏送 |
| 高 | 持久化快取 | 目前快取存於記憶體，服務重啟即失效；改用 Redis 或本地 JSON 持久化，避免重啟後重複打 OpenAI |
| 高 | 結構化日誌 | 改用 `pino` 或 `winston` 輸出 JSON 格式 log，方便 Zeabur / Datadog 等工具收集與告警 |
| 中 | 環境變數驗證 | 啟動時驗證所有必填變數是否存在，缺少時立即終止並輸出清楚錯誤，而非等到推播才發現 |
| 中 | 健康檢查端點 | 新增 `GET /health`，回傳快取狀態、上次推播時間、版本號，供 Zeabur 監控探針使用 |
| 中 | 多目標推播 | `TELEGRAM_CHAT_ID` 改為支援逗號分隔多個 ID，一次推送至多個頻道或群組 |
| 低 | 推播記錄資料庫 | 記錄每次推播的時間、文章數、是否成功，提供 `/api/history` 端點查詢 |
| 低 | 單元測試 | 針對 `escapeHtml`、`getYesterdayRange`、`formatTelegramMessage` 等純函式補充測試 |

---

*本專案持續演進中，歡迎依三角色框架提出改善建議。*
