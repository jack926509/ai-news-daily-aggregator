# AI 新聞日報 — 每日自動聚合系統

自動收集昨日 AI／科技新聞，透過 GPT-4o 篩選重點，依排程推播至 Telegram。

---

## 目錄

- [系統架構](#系統架構)
- [技術棧](#技術棧)
- [新聞來源](#新聞來源)
- [環境變數](#環境變數)
- [本地開發](#本地開發)
- [Zeabur 部署](#zeabur-部署)
- [API 端點](#api-端點)
- [Telegram 報告範例](#telegram-報告範例)
- [修改歷程](#修改歷程)
- [未來優化方向](#未來優化方向)

---

## 系統架構

```
RSS Feeds (8 個來源)
       ↓ 每個 feed 最多 10 篇，篩選「昨日」文章
fetchAllFeeds(start, end)
       ↓ deduplicateItems()：依 URL pathname 去重
       ↓ 昨日無文章 → fetchLatestFeeds() 備援
GPT-4o 分析（60s timeout）
       ↓ JSON: headline/headline_en + highlights(3~5, tags/importance) + insight/insight_en
快取（同一台北日期內有效，記憶體 + .news-cache.json 持久化）
       ↓
buildTelegramMessages()：結構化排版 + inline keyboard + 智慧分段
       ↓
Telegram Bot sendMessage × N 個 Chat ID（指數退避重試 ×3）
  排程：CRON_SCHEDULE 環境變數（預設 0 8 * * * → 每日 08:00 台北時間）
  手動：POST /api/send-telegram（需 API_SECRET 認證）
```

---

## 技術棧

| 層級 | 技術 |
|------|------|
| 前端 | React、Vite、Tailwind CSS |
| 後端 | Express.js、Node.js（TypeScript） |
| AI 摘要 | OpenAI GPT-4o（JSON mode） |
| RSS 解析 | rss-parser（8s timeout per feed） |
| 推播 | Telegram Bot API（HTML parse_mode + inline keyboard） |
| 排程 | node-cron（可透過 `CRON_SCHEDULE` 環境變數自訂） |
| 部署 | Zeabur |
| 日誌 | 結構化 JSON log（level / msg / ts） |
| 快取 | 記憶體 + `.news-cache.json` 持久化（每日台北日期失效） |

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

```env
# ── 必填 ─────────────────────────────────────────────────
OPENAI_API_KEY=sk-...           # OpenAI 金鑰（缺少會拒絕啟動）
TELEGRAM_BOT_TOKEN=123456:ABC   # BotFather 給的 Token
TELEGRAM_CHAT_ID=123456789      # 支援逗號分隔多目標：id1,id2,@channel

# ── 選填 ─────────────────────────────────────────────────
CRON_SCHEDULE=0 8 * * *         # 排程 cron 表達式（預設每日 08:00 台北時間）
API_SECRET=your-secret          # 保護 /api/send-telegram 端點
```

> **啟動驗證**：`OPENAI_API_KEY` 缺少時，服務輸出 JSON fatal 訊息並立即終止（`process.exit(1)`）。

### 取得 Telegram 設定值

**Bot Token**：Telegram 搜尋 `@BotFather` → `/newbot` → 取得 Token

**Chat ID**：
- 個人：搜尋 `@userinfobot`，回傳你的 `id`
- 群組：把 Bot 加入群組後傳訊息 → 開啟 `https://api.telegram.org/bot{TOKEN}/getUpdates` → 找 `"chat":{"id":-xxxxxxxxx}`
- 頻道：把 Bot 設為管理員 → 用 `@頻道username` 或負數 ID

---

## 本地開發

```bash
npm install
cp .env.example .env   # 填入環境變數
npm run dev             # 啟動開發伺服器（含 Vite HMR）
```

開啟 `http://localhost:3000` 查看介面。

---

## Zeabur 部署

1. **綁定子網域**：Zeabur 控制台 → 網路 → 綁定 Zeabur 子網域
2. **設定環境變數**：填入上方必填項 + 選填項
3. **推送程式碼**：推送至 GitHub，Zeabur 自動重新部署

---

## API 端點

| 方法 | 路徑 | 認證 | 說明 |
|------|------|------|------|
| `GET` | `/health` | — | 服務健康狀態（快取、排程、版本） |
| `GET` | `/api/news` | — | 結構化新聞摘要 JSON |
| `POST` | `/api/send-telegram` | `API_SECRET` | 手動推播至 Telegram |
| `POST` | `/api/telegram-webhook` | — | Telegram Bot Webhook（`/start`） |

**健康檢查：**
```bash
curl https://your-domain.zeabur.app/health
# {"status":"ok","version":"2.0.0","schedule":"0 8 * * *","cache":{...},...}
```

**手動推播（含認證）：**
```bash
curl -X POST -H "Authorization: Bearer YOUR_API_SECRET" \
  https://your-domain.zeabur.app/api/send-telegram
```

**Webhook 設定（部署後執行一次）：**
```bash
curl "https://api.telegram.org/bot{TOKEN}/setWebhook?url=https://your-domain.zeabur.app/api/telegram-webhook"
```

---

## Telegram 報告範例

### 每日新聞推播

```
┌─────────────────────────┐
  📰  AI 新聞日報
  📅  2026年3月11日 星期三
└─────────────────────────┘
━━━━━━━━━━━━━━━━━━━━━━━━━
🔥 頭條

GPT-5 正式發布，效能全面超越前代
GPT-5 officially launched with major performance gains
━━━━━━━━━━━━━━━━━━━━━━━━━
📌 重點新聞

1. OpenAI 發布 GPT-5 模型
   🧠大型模型 📈產業動態  [▓▓▓▓▓] 5/5
   OpenAI 正式推出第五代大型語言模型。基準測試顯示...

2. Meta 開源新視覺基礎模型
   🌐開源 🔬研究  [▓▓▓▓░] 4/5
   Meta 釋出視覺基礎模型 SAM-3。開發者可免費下載...

3. 歐盟 AI 法案正式生效
   ⚖️AI法規  [▓▓▓▓░] 4/5
   歐盟人工智慧法案今日起全面實施。高風險 AI 系統...
━━━━━━━━━━━━━━━━━━━━━━━━━
💡 趨勢觀察

大型模型競爭進入新階段，OpenAI 與 Meta 分別...
Major model competition enters a new phase...
─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
🤖 AI 新聞主編｜8 個來源｜每日 08:00 更新
```

**設計特色：**
- 📐 Box-drawing 框線分區，結構清晰
- 📊 重要性進度條 `[▓▓▓▓░]` 直觀呈現評分
- 🏷️ 分類標籤搭配 Emoji（🧠🔬⚖️📱🔧📈🌐🛡️）
- 🌐 中英雙語頭條與趨勢觀察
- 📎 兩欄 Inline Keyboard 快速跳轉原文
- 📄 超過 4096 字元時自動依條目智慧分段

### `/start` 狀態回覆

```
┌─────────────────────────┐
  🤖  AI 新聞 Bot
└─────────────────────────┘

📊 系統狀態
├ 快取：✅ 有效（120s 前更新）
├ 上次推播：2026/3/12 上午8:00:05
├ 排程：每日 08:00（台北時間）
└ 新聞來源：8 個
```

---

## 修改歷程

### v1.0 — 初始版本

- 從 5 個 RSS 來源抓取最新文章
- GPT-4o 分析產出 `headline / highlights / insight` JSON
- Express 提供 `/api/news` 端點
- 基礎 React 前端

---

### v1.1 — LINE → Telegram

- 移除所有 LINE SDK 相關程式碼
- 改用 Telegram Bot API `sendMessage`
- 新增 `POST /api/send-telegram`

---

### v1.2 — 昨日新聞篩選

- `getYesterdayRange()`：Asia/Taipei 時區計算昨日範圍
- `fetchAllFeeds` 加入日期過濾
- 每個 feed 掃描上限提升至 10 篇
- 無昨日文章時提前拋錯避免無意義 API 費用

---

### v1.3 — 三角色全面審查

- **新聞主編**：修正 prompt 時態、新增 AI 相關性過濾、新增 3 個來源（The Verge AI / Wired AI / 聯合新聞網）
- **前端**：切換至 HTML parse_mode、inline 連結、停用預覽卡片、`escapeHtml()` 防破版
- **後端**：`withTimeout()` 統一 timeout、OpenAI 回應防禦性處理、RSS 錯誤可觀測性

---

### v1.4 — 高優先與中優先項目全面落地

- **新聞主編**：`deduplicateItems()` URL 去重、分類標籤（8 類）、重要性評分（1–5）、中英雙語摘要
- **前端**：Telegram inline keyboard、智慧分段（>4096 字元）、暗黑模式、分類標籤 UI（TagBadge）、星等顯示
- **後端**：啟動驗證、結構化日誌、持久化快取、指數退避重試、多目標推播、健康檢查端點

---

### v1.5 — Telegram `/start` 與 Webhook

- `POST /api/telegram-webhook` 接收 Telegram Update
- `/start` 指令即時回覆 bot 狀態
- `TelegramUpdate` 型別定義
- 先回 200 再處理避免重複觸發

---

### v2.0 — 報告系統優化與 Telegram UX 重設計

> 全面優化部署品質、快取策略、安全性與推播視覺體驗

**清理與重構：**
- 刪除遺留 `src/scripts/dailyNews.ts`（已過時的 LINE 版本）
- 移除未使用依賴：`@google/genai`、`better-sqlite3`、`motion`、`lucide-react`
- 修正 `package.json` name（`react-example` → `ai-news-daily-aggregator`）
- 更新 `metadata.json` 描述
- 清理 `vite.config.ts`（移除 Gemini key 注入與 HMR 開關）
- 新增完整 `.env.example`

**排程可配置：**
- 新增 `CRON_SCHEDULE` 環境變數（預設 `0 8 * * *`）
- 加入 cron 表達式驗證，無效時自動降級為預設值

**API 安全：**
- `POST /api/send-telegram` 支援 `API_SECRET` 認證（Bearer token 或 query param）

**快取策略升級：**
- 從 30 分鐘固定 TTL 改為**每日失效**（同一台北日期內有效）
- 避免同一天重複呼叫 GPT-4o，降低 API 費用

**效能調整：**
- GPT-4o timeout 從 30s → 60s，避免大量文章時超時

**Telegram UX/UI 全面重設計：**
- Box-drawing 框線區隔各段落（`┌──┐ └──┘ ━━━ ─ ─`）
- 重要性進度條 `[▓▓▓▓░]` 取代重複星星 emoji
- 分類標籤 Emoji 映射（🧠🔬⚖️📱🔧📈🌐🛡️）
- Inline keyboard 改為兩欄排列，更緊湊
- 中英雙語頭條與趨勢觀察完整呈現
- 備援模式時顯示提示（⚠️ 昨日無新聞）
- `/start` 狀態回覆使用 tree-style 排版（├ └）

**Bug 修正：**
- 修復 `App.tsx` 中 `TagBadge` 的 TypeScript `key` prop 錯誤

---

## 未來優化方向

### 📰 新聞主編

| 優先級 | 項目 | 狀態 | 說明 |
|--------|------|------|------|
| 高 | 新聞來源名稱標注 | 待規劃 | prompt 新增 `source` 欄位，保留原始媒體名稱 |
| 低 | 周報／月報 | 待規劃 | 彙整一週／月重大事件 |
| 低 | 來源可信度標注 | 待規劃 | 標記媒體屬性（研究機構/商業/廠商 PR） |

### 🎨 前端

| 優先級 | 項目 | 狀態 | 說明 |
|--------|------|------|------|
| 中 | 暗黑模式偏好持久化 | 待規劃 | `localStorage("theme")` 儲存選擇 |
| 中 | 錯誤重試按鈕 | 待規劃 | error state 顯示重新載入按鈕 |
| 低 | 頁尾快取資訊列 | 待規劃 | 顯示資料更新時間與版本號 |
| 低 | 頻道置頂訊息 | 待規劃 | 推播後自動釘選最新一則 |

### 🔧 後端

| 優先級 | 項目 | 狀態 | 說明 |
|--------|------|------|------|
| 高 | Webhook Secret Token | 待規劃 | 驗證 `X-Telegram-Bot-Api-Secret-Token` 防偽造 |
| 中 | TELEGRAM_BOT_TOKEN 啟動驗證 | 待規劃 | 統一 fail-fast 行為 |
| 中 | `/api/news?force=1` 強制刷新 | 待規劃 | 跳過快取取得最新資料 |
| 低 | Graceful Shutdown | 待規劃 | 監聽 SIGTERM/SIGINT 等待任務完成 |
| 低 | 推播記錄資料庫 | 待規劃 | `/api/history` 查詢推播歷史 |
| 低 | 單元測試 | 待規劃 | 純函式測試覆蓋 |

---

*本專案持續演進中，歡迎提出改善建議。*
