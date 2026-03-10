import Parser from 'rss-parser';
import OpenAI from 'openai';

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

async function fetchAndSummarizeNews() {
  const results = await Promise.allSettled(
    RSS_URLS.map(url => {
      console.log(`Fetching news from: ${url}`);
      return parser.parseURL(url);
    })
  );

  const allItems: NewsItem[] = results.flatMap((result, i) => {
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

  const newsContent = allItems
    .map(item => `Title: ${item.title}\nLink: ${item.link}\nDescription: ${item.description}`)
    .join('\n\n');

  console.log('Summarizing news into Traditional Chinese...');

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "你是一位擁有 10 年經驗的資深 AI 新聞主編。請將用戶提供的 AI/科技新聞綜合分析，並整理成一份簡潔的每日報告（繁體中文）。" },
      { role: "user", content: `請分析以下新聞：\n\n${newsContent}` }
    ],
  });

  console.log('--- 每日 AI 新聞總結 ---');
  console.log(response.choices[0].message.content);
}

fetchAndSummarizeNews().catch(console.error);
