import Parser from 'rss-parser';
import OpenAI from 'openai';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const parser = new Parser();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const RSS_URLS = [
  "https://techcrunch.com/category/artificial-intelligence/feed/",
  "https://venturebeat.com/category/ai/feed/",
  "https://www.technologyreview.com/topic/artificial-intelligence/feed",
  "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
  "https://www.wired.com/feed/tag/ai/latest/rss",
  "https://technews.tw/category/cutting-edge/ai/feed/",
  "https://www.ithome.com.tw/rss",
  "https://udn.com/rssfeed/news/2/6644?ch=news",
];

interface NewsItem {
  title: string | undefined;
  link: string | undefined;
  description: string | undefined;
}

interface NewsHighlight {
  title: string;
  summary: string;
  link: string;
}

interface NewsResult {
  headline: string;
  highlights: NewsHighlight[];
  insight: string;
  sources: { title: string; link: string }[];
}

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

async function fetchAndSummarizeNews(): Promise<void> {
  // 並行抓取所有 RSS feeds
  console.log('並行抓取 RSS feeds...');
  const results = await Promise.allSettled(
    RSS_URLS.map(url => parser.parseURL(url))
  );

  const allItems: NewsItem[] = results.flatMap((result, i) => {
    if (result.status === 'rejected') {
      console.error(`Error fetching ${RSS_URLS[i]}:`, result.reason);
      return [];
    }
    return result.value.items.slice(0, 3).map(item => ({
      title: item.title,
      link: item.link,
      description: item.contentSnippet,
    }));
  });

  console.log(`共取得 ${allItems.length} 則新聞，正在摘要...`);

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
  "insight": "今日 AI 趨勢深度觀察（3句話，點出跨新聞的共同脈絡或重要轉折，純粹資訊性）",
  "sources": [{"title": "新聞標題", "link": "原始連結"}]
}

規則：
- highlights 包含 3 至 5 則最重要新聞，依重要性排序
- 所有 link 必須直接取自輸入，不可自行生成
- 語氣中立、資訊導向，不使用聳動標題`,
      },
      { role: "user", content: `請分析以下新聞：\n\n${newsContent}` },
    ],
  });

  const data = JSON.parse(response.choices[0].message.content || '{}') as NewsResult;

  // 終端機輸出
  console.log('\n─────────── 每日 AI 新聞總結 ───────────');
  console.log(`🔥 頭條：${data.headline}`);
  console.log('\n📌 重點新聞：');
  data.highlights.forEach((h, i) => {
    console.log(`  ${i + 1}. ${h.title}`);
    console.log(`     ${h.summary}`);
  });
  console.log(`\n💡 觀點：${data.insight}`);
  console.log('─────────────────────────────────────\n');

  // 若設定了 LINE 環境變數，自動推播
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const userId = process.env.LINE_USER_ID;

  if (token && userId) {
    console.log('推播至 LINE...');
    await axios.post(
      'https://api.line.me/v2/bot/message/push',
      { to: userId, messages: [{ type: 'text', text: formatLineMessage(data) }] },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
    );
    console.log('LINE 推播成功');
  } else {
    console.log('（未設定 LINE_CHANNEL_ACCESS_TOKEN / LINE_USER_ID，略過推播）');
  }
}

fetchAndSummarizeNews().catch(console.error);
