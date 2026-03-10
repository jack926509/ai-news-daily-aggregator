import express from "express";
import { createServer as createViteServer } from "vite";
import Parser from 'rss-parser';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const parser = new Parser();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const RSS_URLS = [
  "https://techcrunch.com/category/artificial-intelligence/feed/",
  "https://venturebeat.com/category/ai/feed/",
  "https://www.technologyreview.com/topic/artificial-intelligence/feed",
  "https://technews.tw/category/cutting-edge/ai/feed/",
  "https://www.ithome.com.tw/rss"
];

interface NewsItem {
  title: string | undefined;
  link: string | undefined;
  description: string | undefined;
}

interface NewsResult {
  summary: string;
  sources: { title: string; link: string }[];
}

interface CacheEntry {
  data: NewsResult;
  timestamp: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 分鐘
let cache: CacheEntry | null = null;

async function fetchAllFeeds(): Promise<NewsItem[]> {
  const results = await Promise.allSettled(
    RSS_URLS.map(url => parser.parseURL(url))
  );

  return results.flatMap((result, i) => {
    if (result.status === 'rejected') {
      console.error(`Error fetching ${RSS_URLS[i]}:`, result.reason);
      return [];
    }
    return result.value.items.slice(0, 2).map(item => ({
      title: item.title,
      link: item.link,
      description: item.contentSnippet
    }));
  });
}

async function getNewsSummary(): Promise<NewsResult> {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    console.log('Returning cached news summary');
    return cache.data;
  }

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
        content: `你是一位擁有 10 年經驗的資深 AI 新聞主編。請將用戶提供的 AI/科技新聞綜合分析，並整理成一份簡潔的每日報告。
        請輸出 JSON 格式，包含以下欄位：
        {
          "summary": "包含核心摘要與重點新聞分析的繁體中文報告",
          "sources": [{"title": "新聞標題", "link": "原始連結"}]
        }
        請確保報告語氣專業、易讀，並確保來源連結準確。`
      },
      { role: "user", content: `請分析以下新聞：\n\n${newsContent}` }
    ],
  });

  const result = JSON.parse(response.choices[0].message.content || '{}') as NewsResult;
  cache = { data: result, timestamp: Date.now() };
  return result;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.get("/api/news", async (req, res) => {
    try {
      const result = await getNewsSummary();
      res.json(result);
    } catch (error) {
      console.error('Error summarizing news with OpenAI:', error);
      res.status(500).json({ error: 'Failed to summarize news' });
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
