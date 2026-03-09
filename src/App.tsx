import { useState, useEffect } from 'react';

interface NewsData {
  summary: string;
  sources: { title: string; link: string }[];
}

export default function App() {
  const [news, setNews] = useState<NewsData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    fetch('/api/news')
      .then(res => res.json())
      .then(data => {
        setNews(data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  return (
    <div className="min-h-screen bg-zinc-50 p-8">
      <div className="max-w-3xl mx-auto">
        <header className="mb-10">
          <h1 className="text-4xl font-serif font-medium text-zinc-900 mb-2">每日 AI 新聞總結</h1>
          <p className="text-zinc-500">由資深 AI 主編為您整理的科技前沿觀點</p>
        </header>

        {loading ? (
          <div className="text-zinc-600">正在分析最新 AI 趨勢，請稍候...</div>
        ) : news ? (
          <article className="space-y-10">
            <div className="prose prose-zinc prose-lg max-w-none">
              <div className="whitespace-pre-wrap text-zinc-800 leading-relaxed">
                {news.summary}
              </div>
            </div>

            <section className="border-t border-zinc-200 pt-8">
              <h2 className="text-sm font-semibold text-zinc-900 uppercase tracking-wider mb-4">新聞來源</h2>
              <ul className="space-y-2">
                {news.sources.map((source, index) => (
                  <li key={index}>
                    <a 
                      href={source.link} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="group flex items-center text-indigo-600 transition-all duration-300 ease-out"
                    >
                      <span className="relative inline-block transition-transform duration-300 group-hover:translate-x-1">
                        {source.title}
                        <span className="absolute left-0 -bottom-0.5 h-px w-0 bg-indigo-600 transition-all duration-300 group-hover:w-full"></span>
                      </span>
                      <span className="ml-2 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                        →
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          </article>
        ) : (
          <div className="text-red-600">載入新聞失敗，請稍後再試。</div>
        )}
      </div>
    </div>
  );
}
