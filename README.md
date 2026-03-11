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
       ↓ deduplicateItems()：依 URL pathname 去除同事件重複
GPT-4o 分析（30s timeout）
       ↓  JSON: headline / headline_en + highlights(3~5, 含 tags / importance) + insight / insight_en
快取 30 分鐘（記憶體 + .news-cache.json 持久化）
       ↓
buildTelegramMessages()：inline keyboard + 智慧分段（> 4096 字元自動拆訊息）
       ↓
Telegram Bot sendMessage × N 個 Chat ID（指數退避重試，最多 3 次）
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
| 推播 | Telegram Bot API（HTML parse_mode + inline keyboard） |
| 排程 | node-cron（Asia/Taipei） |
| 部署 | Zeabur |
| 日誌 | 結構化 JSON log（log() 自製，含 level / msg / ts） |
| 快取 | 記憶體 + `.news-cache.json` 持久化（30 分鐘 TTL） |

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
OPENAI_API_KEY=          # OpenAI 金鑰（用於 GPT-4o 摘要）【必填，缺少會拒絕啟動】
TELEGRAM_BOT_TOKEN=      # BotFather 給的 Token
TELEGRAM_CHAT_ID=        # 支援逗號分隔多個目標：id1,id2,@channel
```

> **啟動驗證**：`OPENAI_API_KEY` 缺少時，服務會輸出 JSON 錯誤訊息並立即終止（`process.exit(1)`），不會等到推播時才報錯。

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
| `GET` | `/health` | 服務健康狀態（快取年齡、上次推播時間、版本號） |
| `GET` | `/api/news` | 取得結構化新聞摘要 JSON（含分類標籤、重要性評分、英文版） |
| `POST` | `/api/send-telegram` | 立即手動推播至 Telegram |
| `POST` | `/api/telegram-webhook` | Telegram Bot Webhook 入口（處理 `/start` 指令） |

**健康檢查範例：**
```bash
curl https://your-domain.zeabur.app/health
# 回傳：{"status":"ok","version":"1.4.0","cache":{"hit":true,"age_seconds":120,...},...}
```

**手動推播範例：**
```bash
curl -X POST https://your-domain.zeabur.app/api/send-telegram
```

**Webhook 設定（部署後執行一次）：**
```bash
curl "https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/setWebhook?url=https://your-domain.zeabur.app/api/telegram-webhook"
```

設定完成後，在 Telegram 向 Bot 傳送 `/start`，Bot 會即時回覆目前運作狀態（快取年齡、上次推播時間、下次排程時間）。

**`/api/news` 回應結構：**
```json
{
  "headline": "昨日中文頭條（25字以內）",
  "headline_en": "Yesterday's top headline in English",
  "highlights": [
    {
      "title": "新聞標題",
      "summary": "兩句話事實摘要",
      "link": "https://原始連結",
      "tags": ["大型模型", "應用"],
      "importance": 4
    }
  ],
  "insight": "跨新聞趨勢觀察（繁中，三句話）",
  "insight_en": "Cross-news trend analysis in English",
  "dateLabel": "2026年3月10日 星期二"
}
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

### v1.4 — 高優先與中優先項目全面落地
> 📰 **新聞主編** × 🎨 **前端工程師** × 🔧 **後端工程師**

**新聞主編：**
- 新增 `deduplicateItems()`：依 URL pathname 正規化去重，避免同事件多來源重複送入 GPT-4o
- GPT-4o prompt 新增 `tags[]` 欄位：從 8 個預設標籤中選擇，依主題分類每則新聞
- GPT-4o prompt 新增 `importance` 欄位（1–5）：依影響力評分並排序 highlights
- GPT-4o prompt 新增 `headline_en` / `insight_en`：同步輸出英文摘要，擴大受眾

**前端工程師：**
- 修正 Bug：`/api/send-line` → `/api/send-telegram`（LINE 按鈕從未正常運作）
- 按鈕更新：LINE 綠色 → Telegram 藍色（`#2AABEE`），標籤改為「推播至 Telegram」
- Telegram inline keyboard：`reply_markup` 為每則新聞附「閱讀全文」按鈕，取代裸 URL
- 訊息智慧分段：超過 4096 字元時依條目邊界拆成多則，而非強制截斷末尾
- 網頁暗黑模式：`DarkModeToggle` 元件，切換 `<html>.dark`，初始跟隨 `prefers-color-scheme`
- `index.css` 加入 `@custom-variant dark`，啟用 Tailwind v4 class-based dark mode
- 分類標籤 UI：`TagBadge` 彩色徽章（8 種色系對應 8 個標籤類別）
- 重要性評分 UI：`ImportanceStars` 元件，以 ★☆ 星等顯示於標題旁
- 英文摘要 UI：`headline_en` / `insight_en` 以斜體顯示於對應區塊下方

**後端工程師：**
- 環境變數驗證：啟動時檢查 `OPENAI_API_KEY`，缺少輸出 JSON fatal 訊息並 `process.exit(1)`
- 結構化日誌：`log(level, msg, extra)` 統一輸出 JSON，取代所有 `console.log/error`
- 持久化快取：`saveCacheToDisk()` / `loadCacheFromDisk()` 讀寫 `.news-cache.json`
- 指數退避重試：`withRetry()` 包裝 Telegram sendMessage（最多 3 次，延遲 2s → 4s → 8s）
- 多目標推播：`TELEGRAM_CHAT_ID` 以逗號分隔，`pushTelegramNews()` 依序推送至所有目標
- 健康檢查端點：`GET /health` 回傳 `status / version / cache / last_push / sources_count`
- 版本號提升至 `1.4.0`

---

### v1.5 — Telegram `/start` 指令與 Webhook 支援
> 🔧 **後端工程師**

- 新增 `POST /api/telegram-webhook` 端點，接收 Telegram Bot 推送的 Update
- 解析 `/start` 指令（含 `@BotUsername` 後綴格式），回覆 bot 即時狀態訊息
- 狀態訊息包含：快取有效性與年齡、上次推播時間、下次排程時間（07:30）、新聞來源數量
- 新增 `TelegramUpdate` 介面，型別安全解析 Telegram Message 物件
- 回應先送 `200 OK` 再處理邏輯，防止 Telegram 因超時重複發送 Update
- 版本號提升至 `1.5.0`
- README 補充 Webhook 設定指令（`setWebhook` curl 範例）

---

## 未來優化方向

### 📰 新聞主編觀點

| 優先級 | 項目 | 狀態 | 說明 |
|--------|------|------|------|
| 高 | 新聞去重 | ✅ 已完成 | `deduplicateItems()` 依 URL pathname 去除同事件多來源重複 |
| 高 | 多語言摘要 | ✅ 已完成 | GPT-4o 同時輸出 `headline_en` / `insight_en`，網頁以斜體顯示 |
| 中 | 新聞分類標籤 | ✅ 已完成 | GPT-4o 從 8 個標籤選擇（大型模型/AI法規/硬體/應用/研究/產業動態/開源/資安） |
| 中 | 重要性評分 | ✅ 已完成 | GPT-4o 評 1–5 分，highlights 依此排序，網頁以星等顯示 |
| 低 | 周報／月報 | 待規劃 | 彙整一週／一月重大事件，提供更宏觀的產業脈絡 |
| 低 | 來源可信度標注 | 待規劃 | 標記來源媒體屬性（研究機構、商業媒體、廠商 PR），讓讀者判斷資訊性質 |

---

### 🎨 前端工程師觀點

| 優先級 | 項目 | 狀態 | 說明 |
|--------|------|------|------|
| 高 | Telegram inline keyboard | ✅ 已完成 | 每則新聞附「閱讀全文」按鈕（`reply_markup`），取代裸 URL |
| 高 | 網頁介面響應式優化 | ✅ 已完成 | 手機端排版、min-w-0 防文字溢出、flex 間距調整 |
| 中 | 訊息智慧分段 | ✅ 已完成 | 超過 4096 字元時依條目拆成多則訊息，而非強制截斷 |
| 中 | 網頁暗黑模式 | ✅ 已完成 | `DarkModeToggle` 元件，初始跟隨 `prefers-color-scheme`，可手動切換 |
| 低 | Telegram 頻道置頂訊息 | 待規劃 | 每次推播後自動釘選最新一則，讓訂閱者快速找到最新內容 |
| 低 | 訂閱確認訊息 | 待規劃 | 首次加入 Bot 時自動回覆歡迎說明與推播時間 |

---

### 🔧 後端工程師觀點

| 優先級 | 項目 | 狀態 | 說明 |
|--------|------|------|------|
| 高 | 推播失敗重試機制 | ✅ 已完成 | `withRetry()` 指數退避（2s / 4s / 8s，最多 3 次） |
| 高 | 持久化快取 | ✅ 已完成 | 快取寫入 `.news-cache.json`，服務重啟不丟失 |
| 高 | 結構化日誌 | ✅ 已完成 | `log()` 輸出 JSON 格式（level / msg / ts），取代 console.log |
| 中 | 環境變數驗證 | ✅ 已完成 | 啟動時檢查 `OPENAI_API_KEY`，缺少即 `process.exit(1)` |
| 中 | 健康檢查端點 | ✅ 已完成 | `GET /health` 回傳快取狀態、版本號、上次推播時間 |
| 中 | 多目標推播 | ✅ 已完成 | `TELEGRAM_CHAT_ID` 支援逗號分隔多個 ID |
| 低 | Telegram `/start` 指令 | ✅ 已完成 | Webhook 接收 `/start`，即時回覆 bot 狀態（快取、上次推播、排程時間） |
| 低 | 推播記錄資料庫 | 待規劃 | 記錄每次推播的時間、文章數、是否成功，提供 `/api/history` 端點查詢 |
| 低 | 單元測試 | 待規劃 | 針對 `escapeHtml`、`getYesterdayRange`、`deduplicateItems` 等純函式補充測試 |

---

*本專案持續演進中，歡迎依三角色框架提出改善建議。*
