import express from "express";
import { createServer as createViteServer } from "vite";
import Parser from 'rss-parser';
import OpenAI from 'openai';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const parser = new Parser();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── 【新聞主編】擴充多元來源：英文 5 個 + 繁中 3 個 ──────────────────────────
const RSS_URLS = [
  // 英文來源
  "https://techcrunch.com/category/artificial-intelligence/feed/",
  "https://venturebeat.com/category/ai/feed/",
  "https://www.technologyreview.com/topic/artificial-intelligence/feed",
  "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
  "https://www.wired.com/feed/tag/ai/latest/rss",
  // 繁體中文來源
  "https://technews.tw/category/cutting-edge/ai/feed/",
  "https://www.ithome.com.tw/rss",
  "https://udn.com/rssfeed/news/2/6644?ch=news",
];

// ── 型別定義 ──────────────────────────────────────────────────────────────────
interface NewsItem {
  title: string | undefined;
  link: string | undefined;
  description: string | undefined;
}

export interface NewsHighlight {
  title: string;
  summary: string;
  link: string;
}

export interface NewsResult {
  headline: string;
  highlights: NewsHighlight[];
  insight: string;
  sources: { title: string; link: string }[];
}

interface CacheEntry {
  data: NewsResult;
  timestamp: number;
}

// ── 快取與並行防護 ────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 分鐘
let cache: CacheEntry | null = null;
let refreshPromise: Promise<NewsResult> | null = null; // 防止同時多次打 OpenAI

// ── RSS 並行抓取 ──────────────────────────────────────────────────────────────
async function fetchAllFeeds(): Promise<NewsItem[]> {
  const results = await Promise.allSettled(
    RSS_URLS.map(url => parser.parseURL(url))
  );

  return results.flatMap((result, i) => {
    if (result.status === 'rejected') {
      console.error(`[RSS] 抓取失敗 ${RSS_URLS[i]}:`, result.reason);
      return [];
    }
    return result.value.items.slice(0, 3).map(item => ({
      title: item.title,
      link: item.link,
      description: item.contentSnippet,
    }));
  });
}

// ── 【新聞主編】LINE 訊息格式化 ───────────────────────────────────────────────
function formatLineMessage(data: NewsResult): string {
  const today = new Date().toLocaleDateString('zh-TW', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });

  const highlights = data.highlights
    .map((h, i) => `${i + 1}. ${h.title}\n   ${h.summary}\n   🔗 ${h.link}`)
    .join('\n\n');

  return [
    `📰 每日 AI 新聞報告`,
    `📅 ${today}`,
    ``,
    `🔥 今日頭條`,
    data.headline,
    ``,
    `📌 重點新聞`,
    highlights,
    ``,
    `💡 深度觀點`,
    data.insight,
    ``,
    `─────────────────`,
    `由 AI 新聞主編整理 | 每日更新`,
  ].join('\n');
}

// ── OpenAI 摘要（含結構化 prompt）────────────────────────────────────────────
async function doFetchAndSummarize(): Promise<NewsResult> {
  const allItems = await fetchAllFeeds();
  const newsContent = allItems
    .map(item => `Title: ${item.title}\nLink: ${item.link}\nDescription: ${item.description}`)
    .join('\n\n');

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `你是一位擁有 10 年經驗的資深 AI 新聞主編，以客觀、精準、零個人立場著稱。
任務：分析當日 AI/科技新聞，產出結構化 JSON 報告（繁體中文）。

輸出格式：
{
  "headline": "今日最重要的一句話頭條（含核心事件與影響，20字以內）",
  "highlights": [
    {
      "title": "新聞標題（15字以內，精準）",
      "summary": "客觀事實摘要（2句話，不加主觀評論）",
      "link": "原始連結（必須直接取自輸入資料）"
    }
  ],
  "insight": "今日 AI 趨勢深度觀察（3句話，點出跨新聞的共同脈絡或重要轉折，純粹資訊性，不帶個人觀點）",
  "sources": [{"title": "新聞標題", "link": "原始連結"}]
}

規則：
- highlights 包含 3 至 5 則最重要新聞，依重要性排序
- 所有 link 必須直接取自輸入，不可自行生成或推測
- 語氣中立、資訊導向，不使用聳動標題`,
      },
      { role: "user", content: `請分析以下新聞：\n\n${newsContent}` },
    ],
  });

  return JSON.parse(response.choices[0].message.content || '{}') as NewsResult;
}

// ── 快取層（含並行防護）──────────────────────────────────────────────────────
async function getNewsSummary(): Promise<NewsResult> {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    console.log('[Cache] 命中快取');
    return cache.data;
  }

  // 若已有進行中的 refresh，直接等待同一個 Promise，避免重複呼叫 OpenAI
  if (refreshPromise) {
    console.log('[Cache] 等待進行中的更新...');
    return refreshPromise;
  }

  refreshPromise = doFetchAndSummarize()
    .then(result => {
      cache = { data: result, timestamp: Date.now() };
      return result;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

// ── Express 伺服器 ────────────────────────────────────────────────────────────
async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // GET /api/news — 取得結構化新聞摘要
  app.get("/api/news", async (_req, res) => {
    try {
      const result = await getNewsSummary();
      res.json(result);
    } catch (error) {
      console.error('[API] /api/news 錯誤:', error);
      res.status(500).json({ error: '新聞摘要失敗，請稍後再試' });
    }
  });

  // POST /api/send-line — 推播至 LINE
  app.post("/api/send-line", async (_req, res) => {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const userId = process.env.LINE_USER_ID;

    if (!token || !userId) {
      res.status(503).json({
        error: 'LINE 功能未設定，請在 .env 中配置 LINE_CHANNEL_ACCESS_TOKEN 與 LINE_USER_ID',
      });
      return;
    }

    try {
      const data = await getNewsSummary();
      const text = formatLineMessage(data);

      await axios.post(
        'https://api.line.me/v2/bot/message/push',
        { to: userId, messages: [{ type: 'text', text }] },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      console.log('[LINE] 推播成功');
      res.json({ success: true });
    } catch (error) {
      console.error('[LINE] 推播失敗:', error);
      res.status(500).json({ error: '發送 LINE 訊息失敗' });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
