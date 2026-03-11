import express from "express";
import { createServer as createViteServer } from "vite";
import Parser from 'rss-parser';
import OpenAI from 'openai';
import axios from 'axios';
import cron from 'node-cron';
import dotenv from 'dotenv';

dotenv.config();

// ── RSS parser（每個 feed 最多等 8 秒）────────────────────────────────────────
const parser = new Parser({ timeout: 8000 });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── 新聞來源：英文 5 個 + 繁中 3 個 ──────────────────────────────────────────
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
}

type NewsResultWithDate = NewsResult & { dateLabel: string };

interface CacheEntry {
  data: NewsResultWithDate;
  timestamp: number;
}

// ── 快取與並行防護 ────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 分鐘
let cache: CacheEntry | null = null;
let refreshPromise: Promise<NewsResultWithDate> | null = null;

// ── [後端] 帶 timeout 的 Promise 包裝 ────────────────────────────────────────
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout (${ms}ms): ${label}`)), ms)
    ),
  ]);
}

// ── [後端] Telegram HTML 安全逸脫（防止標籤破版）─────────────────────────────
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── 取得昨日（Asia/Taipei）的 UTC 時間範圍 ────────────────────────────────────
function getYesterdayRange(): { start: Date; end: Date; dateLabel: string } {
  const taipeiToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
  const startOfToday = new Date(`${taipeiToday}T00:00:00+08:00`);
  const start = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
  const end   = new Date(startOfToday.getTime() - 1);
  const dateLabel = start.toLocaleDateString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });
  return { start, end, dateLabel };
}

// ── RSS 並行抓取（僅保留昨日文章，每個 feed 帶 8 秒 timeout）─────────────────
async function fetchAllFeeds(start: Date, end: Date): Promise<NewsItem[]> {
  const results = await Promise.allSettled(
    RSS_URLS.map(url => withTimeout(parser.parseURL(url), 8000, url))
  );

  return results.flatMap((result, i) => {
    if (result.status === 'rejected') {
      console.error(`[RSS] 抓取失敗 ${RSS_URLS[i]}:`, result.reason?.message ?? result.reason);
      return [];
    }
    return result.value.items
      .filter(item => {
        const dateStr = item.isoDate ?? item.pubDate;
        if (!dateStr) return false;
        const d = new Date(dateStr);
        return !isNaN(d.getTime()) && d >= start && d <= end;
      })
      .slice(0, 10)
      .map(item => ({
        title: item.title,
        link: item.link,
        description: item.contentSnippet,
      }));
  });
}

// ── [前端] Telegram HTML 訊息格式化（parse_mode: HTML）───────────────────────
const CIRCLED_NUMS = ['①', '②', '③', '④', '⑤'];
const TELEGRAM_MESSAGE_LIMIT = 4096;

function formatTelegramMessage(data: NewsResultWithDate): string {
  const highlights = data.highlights
    .map((h, i) => [
      `${CIRCLED_NUMS[i] ?? `${i + 1}.`} <b>${escapeHtml(h.title)}</b>`,
      escapeHtml(h.summary),
      `<a href="${h.link}">閱讀全文 →</a>`,
    ].join('\n'))
    .join('\n\n');

  const msg = [
    `📰 <b>AI 新聞昨日回顧</b>`,
    `📅 ${escapeHtml(data.dateLabel)}`,
    ``,
    `🔥 <b>昨日頭條</b>`,
    escapeHtml(data.headline),
    ``,
    `📌 <b>重點新聞</b>`,
    ``,
    highlights,
    ``,
    `💡 <b>深度觀點</b>`,
    escapeHtml(data.insight),
    ``,
    `<i>🤖 AI 新聞主編整理｜每日 07:30 更新</i>`,
  ].join('\n');

  if (msg.length > TELEGRAM_MESSAGE_LIMIT) {
    console.warn(`[Telegram] 訊息超過 ${TELEGRAM_MESSAGE_LIMIT} 字元 (${msg.length})，截斷中`);
    return msg.slice(0, TELEGRAM_MESSAGE_LIMIT - 3) + '...';
  }
  return msg;
}

// ── [新聞主編] OpenAI 摘要：昨日 AI/科技新聞，純粹事實，零立場 ───────────────
async function doFetchAndSummarize(): Promise<NewsResultWithDate> {
  const { start, end, dateLabel } = getYesterdayRange();
  const allItems = await fetchAllFeeds(start, end);

  if (allItems.length === 0) {
    throw new Error(`[新聞摘要] 昨日（${dateLabel}）未找到任何新聞，略過推播`);
  }

  console.log(`[新聞] 昨日共取得 ${allItems.length} 則符合文章`);

  const newsContent = allItems
    .map(item => `Title: ${item.title}\nLink: ${item.link}\nDescription: ${item.description}`)
    .join('\n\n');

  const response = await withTimeout(
    openai.chat.completions.create({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `你是一位擁有 10 年經驗的資深 AI 新聞主編，以客觀、精準、零個人立場著稱。
任務：從以下昨日新聞中，篩選並分析與 AI、機器學習、大型語言模型、科技產業直接相關的內容，產出結構化 JSON 報告（繁體中文）。

輸出格式：
{
  "headline": "昨日最重要的一句話頭條（含核心事件與影響，25字以內）",
  "highlights": [
    {
      "title": "新聞標題（15字以內，精準描述事件）",
      "summary": "純粹事實摘要，兩句話，禁止主觀形容詞與評價性語言",
      "link": "原始連結（必須直接取自輸入資料，不可修改或自行生成）"
    }
  ],
  "insight": "跨新聞趨勢觀察，三句話，點出共同脈絡或產業轉折，純資訊，無推薦立場"
}

規則：
- 僅選取與 AI／機器學習／LLM／科技產業直接相關的新聞
- highlights 包含 3 至 5 則最重要新聞，依重要性排序
- 所有 link 必須直接取自輸入，不可自行生成或推測
- 語氣中立、資訊導向，不使用聳動或情緒化標題
- summary 每句以事實陳述開頭，不加「值得注意」「令人矚目」等主觀語`,
        },
        { role: "user", content: `請分析以下昨日新聞：\n\n${newsContent}` },
      ],
    }),
    30000,
    'OpenAI chat.completions'
  );

  // [後端] 安全解析 OpenAI 回應，防止空值或格式錯誤導致 crash
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('[OpenAI] 回應內容為空');

  let parsed: NewsResult;
  try {
    parsed = JSON.parse(content) as NewsResult;
  } catch {
    throw new Error('[OpenAI] 回應 JSON 解析失敗');
  }

  return { ...parsed, dateLabel };
}

// ── 快取層（含並行防護）──────────────────────────────────────────────────────
async function getNewsSummary(): Promise<NewsResultWithDate> {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    console.log('[Cache] 命中快取');
    return cache.data;
  }

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

// ── [後端] Telegram 推播核心 ─────────────────────────────────────────────────
async function pushTelegramNews(forceRefresh = false): Promise<void> {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    throw new Error('未設定 TELEGRAM_BOT_TOKEN 或 TELEGRAM_CHAT_ID');
  }

  if (forceRefresh) {
    cache = null;
    refreshPromise = null;
  }

  const data = await getNewsSummary();
  const text = formatTelegramMessage(data);

  try {
    await withTimeout(
      axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true }, // 關閉連結預覽，避免多張卡片
      }),
      10000,
      'Telegram sendMessage'
    );
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error('[Telegram] API 錯誤:', {
        status: error.response?.status,
        body: error.response?.data,
        message: error.message,
      });
    }
    throw error;
  }
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

  // POST /api/send-telegram — 手動推播至 Telegram
  app.post("/api/send-telegram", async (_req, res) => {
    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
      res.status(503).json({
        error: 'Telegram 功能未設定，請配置 TELEGRAM_BOT_TOKEN 與 TELEGRAM_CHAT_ID',
      });
      return;
    }

    try {
      await pushTelegramNews();
      console.log('[Telegram] 手動推播成功');
      res.json({ success: true });
    } catch (error) {
      console.error('[Telegram] 手動推播失敗:', error);
      res.status(500).json({ error: '發送 Telegram 訊息失敗' });
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

  // ── 每日 07:30 (Asia/Taipei) 自動推播 Telegram ───────────────────────────
  cron.schedule('30 7 * * *', async () => {
    console.log('[Cron] 每日 Telegram 推播啟動...');
    try {
      await pushTelegramNews(true);
      console.log('[Cron] Telegram 推播成功');
    } catch (error) {
      console.error('[Cron] Telegram 推播失敗:', error);
    }
  }, { timezone: 'Asia/Taipei' });

  console.log('[Cron] 已排程：每日 07:30 (Asia/Taipei) 自動推播 Telegram');
}

startServer();
