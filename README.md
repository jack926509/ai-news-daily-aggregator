# 每日 AI 新聞總結系統 (Daily AI News Summary System)

這是一個全端應用程式，旨在自動化收集、分析並呈現最新的 AI 與科技新聞。透過整合多個 RSS 來源，並利用 OpenAI 的強大分析能力，為您產出簡潔、專業的每日繁體中文新聞報告。

## 🚀 主要功能

*   **自動化 RSS 聚合**：定期從多個權威科技新聞來源抓取最新內容。
*   **AI 智慧總結**：利用 OpenAI (GPT-4o) 將繁雜的新聞資訊提煉為結構化的每日報告。
*   **現代化 UI**：提供乾淨、易讀的網頁介面，並具備互動式連結效果。
*   **全自動化排程**：透過 GitHub Actions 實現每日自動更新，無需人工介入。

## 🛠 技術棧

*   **前端**: React, Vite, Tailwind CSS
*   **後端**: Express.js
*   **自動化**: GitHub Actions, RSS-Parser
*   **AI 模型**: OpenAI (GPT-4o)

## 📋 新聞來源

本系統目前聚合以下來源的 AI/科技新聞：

1.  [TechCrunch (AI)](https://techcrunch.com/category/artificial-intelligence/feed/)
2.  [VentureBeat (AI)](https://venturebeat.com/category/ai/feed/)
3.  [MIT Technology Review (AI)](https://www.technologyreview.com/topic/artificial-intelligence/feed)
4.  [TechNews 科技新報 (AI)](https://technews.tw/category/cutting-edge/ai/feed/)
5.  [iThome (RSS)](https://www.ithome.com.tw/rss)

## 🚀 本地開發與測試

### 1. 安裝相依套件
```bash
npm install
```

### 2. 設定環境變數
在本地開發時，請在專案根目錄建立 `.env` 檔案，並填入您的 OpenAI API 金鑰：
```env
OPENAI_API_KEY=your_openai_api_key_here
```

### 3. 啟動開發伺服器
```bash
npm run dev
```
啟動後，請訪問 `http://localhost:3000` 查看介面。

## ☁️ GitHub 部署與自動化設定

本專案已配置 GitHub Actions，可實現每日自動更新。

### 1. 設定 GitHub Secrets
為了讓自動化腳本能正常運作，請在您的 GitHub 儲存庫設定中新增以下 Secret：

*   **Settings > Secrets and variables > Actions > New repository secret**
*   名稱: `OPENAI_API_KEY`
*   值: 您的 OpenAI API 金鑰

### 2. GitHub Actions 自動化
專案已包含 `.github/workflows/daily-news.yml`。推送到 GitHub 後，系統將會依照設定的排程自動執行新聞抓取與總結任務。

---

*本專案由 AI 輔助開發，旨在提升資訊獲取效率。*
