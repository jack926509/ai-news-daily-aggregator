import express from "express";
import { createServer as createViteServer } from "vite";
import Parser from 'rss-parser';
import OpenAI from 'openai';
import axios from 'axios';
import cron from 'node-cron';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

// ── [後端] 環境變數驗證（啟動時立即確認必填項，缺少則終止）──────────────────────
const REQUIRED_VARS = ['OPENAI_API_KEY'] as const;
const missingVars = REQUIRED_VARS.filter(k => !process.env[k]);
if (missingVars.length > 0) {
  process.stderr.write(JSON.stringify({
    level: 'fatal',
    msg: `缺少必填環境變數: ${missingVars.join(', ')}，請設定後重新啟動`,
    ts: new Date().toISOString(),
  }) + '\n');
  process.exit(1);
}

// ── [後端] 結構化日誌（JSON 格式，方便 Zeabur / Datadog 等工具收集與告警）──────
type LogLevel = 'debug' | 'info' | 'warn' | 'error';
function log(level: LogLevel, msg: string, extra: Record<string, unknown> = {}): void {
  const entry = { level, msg, ts: new Date().toISOString(), ...extra };
  (level === 'error' || level === 'warn' ? console.error : console.log)(JSON.stringify(entry));
}

// ── RSS parser ────────────────────────────────────────────────────────────────
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

// ── 分類標籤選項（[新聞主編] 提供給 GPT-4o 選擇）────────────────────────────────
const TAG_OPTIONS = ['大型模型', 'AI法規', '硬體', '應用', '研究', '產業動態', '開源', '資安'];

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
  tags: string[];      // [新聞主編] 分類標籤，如 ['大型模型', 'AI法規']
  importance: number;  // [新聞主編] 重要性評分 1–5
}

export interface NewsResult {
  headline: string;
  headline_en: string;  // [新聞主編] 多語言摘要：英文頭條
  highlights: NewsHighlight[];
  insight: string;
  insight_en: string;   // [新聞主編] 多語言摘要：英文深度觀點
}

type NewsResultWithDate = NewsResult & { dateLabel: string };

interface CacheEntry {
  data: NewsResultWithDate;
  timestamp: number;
}

// ── [後端] 持久化快取（服務重啟後不遺失，存於 .news-cache.json）────────────────
const CACHE_FILE = path.join(process.cwd(), '.news-cache.json');
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 分鐘

function loadCacheFromDisk(): CacheEntry | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const entry = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')) as CacheEntry;
    log('info', '[Cache] 從磁碟載入快取', {
      age_s: Math.floor((Date.now() - entry.timestamp) / 1000),
      valid: Date.now() - entry.timestamp < CACHE_TTL_MS,
    });
    return entry; // 即使過期仍載入，TTL 判斷交由 getNewsSummary 處理
  } catch {
    return null;
  }
}

function saveCacheToDisk(entry: CacheEntry): void {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(entry), 'utf-8');
  } catch (err) {
    log('warn', '[Cache] 磁碟寫入失敗', { error: String(err) });
  }
}

let cache: CacheEntry | null = loadCacheFromDisk();
let refreshPromise: Promise<NewsResultWithDate> | null = null;

// 推播狀態記錄（供 /health 端點使用）
let lastPushTime: string | null = null;
let lastPushSuccess: boolean | null = null;

// ── [後端] 帶 timeout 的 Promise 包裝 ────────────────────────────────────────
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout (${ms}ms): ${label}`)), ms)
    ),
  ]);
}

// ── [後端] 指數退避重試（推播失敗時使用，最多 3 次：2s / 4s / 8s）──────────────
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  label = 'operation',
): Promise<T> {
  let delay = 2000;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt > maxRetries) throw err;
      log('warn', `[Retry] ${label} 失敗，${delay / 1000}s 後重試`, {
        attempt, maxRetries, error: String(err),
      });
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }
  }
  throw new Error(`${label} exceeded max retries`); // unreachable
}

// ── [後端] Telegram HTML 安全逸脫（防止標籤破版）────────────────────────────────
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

// ── [新聞主編] 新聞去重（依 URL pathname 正規化，避免同一事件多來源重複）─────────
function deduplicateItems(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  return items.filter(item => {
    let key = '';
    if (item.link) {
      try {
        const url = new URL(item.link);
        key = `${url.hostname}${url.pathname}`.toLowerCase().replace(/\/$/, '');
      } catch {
        key = item.link;
      }
    } else if (item.title) {
      key = item.title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '').slice(0, 30);
    }
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── RSS 並行抓取（僅保留昨日文章，每個 feed 帶 8 秒 timeout）─────────────────
async function fetchAllFeeds(start: Date, end: Date): Promise<NewsItem[]> {
  const results = await Promise.allSettled(
    RSS_URLS.map(url => withTimeout(parser.parseURL(url), 8000, url))
  );

  const items = results.flatMap((result, i) => {
    if (result.status === 'rejected') {
      log('error', '[RSS] 抓取失敗', { url: RSS_URLS[i], error: result.reason?.message ?? String(result.reason) });
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

  // [新聞主編] 去除重複文章
  const deduped = deduplicateItems(items);
  log('info', '[RSS] 抓取完成', { raw: items.length, after_dedup: deduped.length });
  return deduped;
}

// ── [前端] Telegram 訊息建構（inline keyboard + 智慧分段推送）────────────────────
const CIRCLED_NUMS = ['①', '②', '③', '④', '⑤'];
const TELEGRAM_LIMIT = 4096;

interface TelegramPayload {
  text: string;
  reply_markup?: {
    inline_keyboard: { text: string; url: string }[][];
  };
}

function buildTelegramMessages(data: NewsResultWithDate): TelegramPayload[] {
  const highlightsText = data.highlights
    .map((h, i) => {
      const tags = h.tags?.length ? ` ｜${h.tags.slice(0, 2).join('・')}` : '';
      const score = h.importance ? ` ${'⭐'.repeat(Math.min(h.importance, 5))}` : '';
      return [
        `${CIRCLED_NUMS[i] ?? `${i + 1}.`} <b>${escapeHtml(h.title)}</b>`,
        escapeHtml(tags + score),
        escapeHtml(h.summary),
      ].filter(Boolean).join('\n');
    })
    .join('\n\n');

  const mainText = [
    `📰 <b>AI 新聞昨日回顧</b>`,
    `📅 ${escapeHtml(data.dateLabel)}`,
    ``,
    `🔥 <b>昨日頭條</b>`,
    escapeHtml(data.headline),
    ``,
    `📌 <b>重點新聞</b>`,
    ``,
    highlightsText,
    ``,
    `💡 <b>深度觀點</b>`,
    escapeHtml(data.insight),
    ``,
    `<i>🤖 AI 新聞主編整理｜每日 07:30 更新</i>`,
  ].join('\n');

  // [前端] inline keyboard：每則新聞一個「閱讀全文」按鈕
  const inline_keyboard = data.highlights.map((h, i) => [{
    text: `${CIRCLED_NUMS[i] ?? `${i + 1}.`} 閱讀全文`,
    url: h.link,
  }]);

  // 未超過限制 → 單訊息 + inline keyboard
  if (mainText.length <= TELEGRAM_LIMIT) {
    return [{ text: mainText, reply_markup: { inline_keyboard } }];
  }

  // [前端] 超過限制 → 智慧分段：依新聞條目拆成多則訊息
  log('warn', '[Telegram] 訊息超過限制，啟動分段推送', { length: mainText.length });
  const messages: TelegramPayload[] = [];

  messages.push({
    text: [
      `📰 <b>AI 新聞昨日回顧</b>`,
      `📅 ${escapeHtml(data.dateLabel)}`,
      ``,
      `🔥 <b>昨日頭條</b>`,
      escapeHtml(data.headline),
    ].join('\n'),
  });

  data.highlights.forEach((h, i) => {
    const tags = h.tags?.length ? ` ｜${h.tags.slice(0, 2).join('・')}` : '';
    const score = h.importance ? ` ${'⭐'.repeat(Math.min(h.importance, 5))}` : '';
    messages.push({
      text: [
        `${CIRCLED_NUMS[i] ?? `${i + 1}.`} <b>${escapeHtml(h.title)}</b>`,
        escapeHtml(tags + score),
        escapeHtml(h.summary),
      ].filter(Boolean).join('\n'),
      reply_markup: { inline_keyboard: [[{ text: '閱讀全文 →', url: h.link }]] },
    });
  });

  messages.push({
    text: [
      `💡 <b>深度觀點</b>`,
      escapeHtml(data.insight),
      ``,
      `<i>🤖 AI 新聞主編整理｜每日 07:30 更新</i>`,
    ].join('\n'),
  });

  return messages;
}

// ── [新聞主編] OpenAI 摘要：昨日 AI/科技新聞，含分類標籤與重要性評分 ──────────────
async function doFetchAndSummarize(): Promise<NewsResultWithDate> {
  const { start, end, dateLabel } = getYesterdayRange();
  const allItems = await fetchAllFeeds(start, end);

  if (allItems.length === 0) {
    throw new Error(`[新聞摘要] 昨日（${dateLabel}）未找到任何新聞，略過推播`);
  }

  log('info', '[新聞] 送入 GPT-4o 分析', { count: allItems.length, dateLabel });

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
任務：從以下昨日新聞中，篩選並分析與 AI、機器學習、大型語言模型、科技產業直接相關的內容，產出結構化 JSON 報告。

可用分類標籤（tags）僅限從以下選擇：${TAG_OPTIONS.join('、')}

輸出格式：
{
  "headline": "昨日最重要的一句話頭條（繁體中文，含核心事件與影響，25字以內）",
  "headline_en": "Yesterday's top headline in English (under 15 words)",
  "highlights": [
    {
      "title": "新聞標題（15字以內，精準描述事件）",
      "summary": "純粹事實摘要，兩句話，禁止主觀形容詞與評價性語言",
      "link": "原始連結（必須直接取自輸入資料，不可修改或自行生成）",
      "tags": ["分類標籤1"],
      "importance": 4
    }
  ],
  "insight": "跨新聞趨勢觀察（繁體中文），三句話，點出共同脈絡或產業轉折，純資訊，無推薦立場",
  "insight_en": "Cross-news trend analysis in English, three sentences, factual and neutral"
}

規則：
- 僅選取與 AI／機器學習／LLM／科技產業直接相關的新聞
- highlights 包含 3 至 5 則最重要新聞，依 importance 由高到低排序
- importance 評分標準：5=全球重大突破，4=產業重要進展，3=值得關注，2=一般資訊，1=背景資訊
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

// ── 快取層（含並行防護 + 持久化）────────────────────────────────────────────────
async function getNewsSummary(): Promise<NewsResultWithDate> {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    log('info', '[Cache] 命中快取', { age_s: Math.floor((Date.now() - cache.timestamp) / 1000) });
    return cache.data;
  }

  if (refreshPromise) {
    log('info', '[Cache] 等待進行中的更新...');
    return refreshPromise;
  }

  refreshPromise = doFetchAndSummarize()
    .then(result => {
      const entry: CacheEntry = { data: result, timestamp: Date.now() };
      cache = entry;
      saveCacheToDisk(entry); // [後端] 持久化寫入磁碟
      return result;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

// ── [後端] Telegram 推播核心（多目標 + 指數退避重試）──────────────────────────────
async function pushTelegramNews(forceRefresh = false): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  // [後端] 多目標推播：支援逗號分隔多個 Chat ID
  const chatIds = (process.env.TELEGRAM_CHAT_ID ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);

  if (!token || chatIds.length === 0) {
    throw new Error('未設定 TELEGRAM_BOT_TOKEN 或 TELEGRAM_CHAT_ID');
  }

  if (forceRefresh) {
    cache = null;
    refreshPromise = null;
  }

  const data = await getNewsSummary();
  const payloads = buildTelegramMessages(data);

  for (const chatId of chatIds) {
    for (const payload of payloads) {
      // [後端] 指數退避重試（最多 3 次：2s / 4s / 8s）
      await withRetry(
        () => withTimeout(
          axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
            chat_id: chatId,
            text: payload.text,
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
            ...(payload.reply_markup ? { reply_markup: payload.reply_markup } : {}),
          }),
          10000,
          `Telegram sendMessage → ${chatId}`
        ),
        3,
        `Telegram → ${chatId}`,
      );
    }
    log('info', '[Telegram] 推播成功', { chatId, messages: payloads.length });
  }

  lastPushTime = new Date().toISOString();
  lastPushSuccess = true;
}

// ── Express 伺服器 ────────────────────────────────────────────────────────────
async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // [後端] GET /health — 服務健康狀態（供 Zeabur 監控探針使用）
  app.get('/health', (_req, res) => {
    const now = Date.now();
    const cacheAge = cache ? Math.floor((now - cache.timestamp) / 1000) : null;
    res.json({
      status: 'ok',
      version: '1.4.0',
      cache: {
        hit: cache !== null,
        age_seconds: cacheAge,
        expires_in_seconds: cache
          ? Math.max(0, Math.floor((CACHE_TTL_MS - (now - cache.timestamp)) / 1000))
          : null,
      },
      last_push: lastPushTime,
      last_push_success: lastPushSuccess,
      sources_count: RSS_URLS.length,
    });
  });

  // GET /api/news — 取得結構化新聞摘要
  app.get('/api/news', async (_req, res) => {
    try {
      const result = await getNewsSummary();
      res.json(result);
    } catch (error) {
      log('error', '[API] /api/news 錯誤', { error: String(error) });
      res.status(500).json({ error: '新聞摘要失敗，請稍後再試' });
    }
  });

  // POST /api/send-telegram — 手動推播至 Telegram
  app.post('/api/send-telegram', async (_req, res) => {
    if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
      res.status(503).json({
        error: 'Telegram 功能未設定，請配置 TELEGRAM_BOT_TOKEN 與 TELEGRAM_CHAT_ID',
      });
      return;
    }

    try {
      await pushTelegramNews();
      log('info', '[Telegram] 手動推播成功');
      res.json({ success: true });
    } catch (error) {
      log('error', '[Telegram] 手動推播失敗', { error: String(error) });
      lastPushSuccess = false;
      res.status(500).json({ error: '發送 Telegram 訊息失敗' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
  }

  app.listen(PORT, '0.0.0.0', () => {
    log('info', `Server running on http://localhost:${PORT}`);
  });

  // ── 每日 07:30 (Asia/Taipei) 自動推播 Telegram ───────────────────────────
  cron.schedule('30 7 * * *', async () => {
    log('info', '[Cron] 每日 Telegram 推播啟動...');
    try {
      await pushTelegramNews(true);
      log('info', '[Cron] Telegram 推播成功');
    } catch (error) {
      log('error', '[Cron] Telegram 推播失敗', { error: String(error) });
    }
  }, { timezone: 'Asia/Taipei' });

  log('info', '[Cron] 已排程：每日 07:30 (Asia/Taipei) 自動推播 Telegram');
}

startServer();
