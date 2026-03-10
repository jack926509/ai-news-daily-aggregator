import { useState, useEffect } from 'react';

interface NewsHighlight {
  title: string;
  summary: string;
  link: string;
}

interface NewsData {
  headline: string;
  highlights: NewsHighlight[];
  insight: string;
  sources: { title: string; link: string }[];
}

type LineStatus = 'idle' | 'sending' | 'success' | 'error';

// ── Skeleton Loader ────────────────────────────────────────────────────────────
function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse bg-zinc-200 rounded-xl ${className}`} />;
}

function LoadingSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-28" />
      <div className="space-y-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
      <Skeleton className="h-24" />
    </div>
  );
}

// ── LINE 發送按鈕 ──────────────────────────────────────────────────────────────
function LineButton({ status, onClick }: { status: LineStatus; onClick: () => void }) {
  const styles: Record<LineStatus, string> = {
    idle: 'bg-[#06C755] text-white hover:bg-[#05b34c] active:scale-95',
    sending: 'bg-[#06C755]/60 text-white cursor-not-allowed',
    success: 'bg-green-100 text-green-700',
    error: 'bg-red-100 text-red-700',
  };
  const labels: Record<LineStatus, string> = {
    idle: '發送至 LINE',
    sending: '傳送中...',
    success: '✓ 已發送',
    error: '發送失敗',
  };

  return (
    <button
      onClick={onClick}
      disabled={status === 'sending'}
      className={`shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${styles[status]}`}
    >
      {labels[status]}
    </button>
  );
}

// ── 主元件 ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [news, setNews] = useState<NewsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lineStatus, setLineStatus] = useState<LineStatus>('idle');

  useEffect(() => {
    fetch('/api/news')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: NewsData) => setNews(data))
      .catch(err => {
        console.error(err);
        setError('載入新聞失敗，請稍後再試。');
      })
      .finally(() => setLoading(false));
  }, []);

  const sendToLine = () => {
    setLineStatus('sending');
    fetch('/api/send-line', { method: 'POST' })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setLineStatus('success');
        setTimeout(() => setLineStatus('idle'), 3000);
      })
      .catch(err => {
        console.error(err);
        setLineStatus('error');
        setTimeout(() => setLineStatus('idle'), 3000);
      });
  };

  const today = new Date().toLocaleDateString('zh-TW', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });

  return (
    <div className="min-h-screen bg-zinc-50 px-4 py-8 md:px-8">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* ── 頁首 ─────────────────────────────────────────────────────────── */}
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">每日 AI 新聞</h1>
            <p className="text-xs text-zinc-400 mt-1">{today} · 由資深 AI 主編整理</p>
          </div>
          {news && <LineButton status={lineStatus} onClick={sendToLine} />}
        </header>

        {/* ── 內容區 ───────────────────────────────────────────────────────── */}
        {loading ? (
          <LoadingSkeleton />
        ) : error ? (
          <div className="bg-red-50 border border-red-100 text-red-600 rounded-2xl p-5 text-sm">
            {error}
          </div>
        ) : news ? (
          <>
            {/* 今日頭條 */}
            <section className="bg-zinc-900 text-white rounded-2xl p-6">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">
                🔥 今日頭條
              </p>
              <p className="text-base font-semibold leading-snug">{news.headline}</p>
            </section>

            {/* 重點新聞 */}
            <section className="bg-white rounded-2xl border border-zinc-100 overflow-hidden">
              <div className="px-5 py-3 border-b border-zinc-100">
                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                  📌 重點新聞
                </p>
              </div>
              <ul className="divide-y divide-zinc-100">
                {news.highlights.map((item, i) => (
                  <li key={i} className="px-5 py-4 flex gap-3">
                    {/* 編號 */}
                    <span className="shrink-0 w-5 h-5 mt-0.5 rounded-full bg-indigo-50 text-indigo-500 text-[10px] font-bold flex items-center justify-center">
                      {i + 1}
                    </span>
                    {/* 內容 */}
                    <div className="space-y-1 min-w-0">
                      <p className="text-sm font-semibold text-zinc-900 leading-snug">
                        {item.title}
                      </p>
                      <p className="text-sm text-zinc-500 leading-relaxed">
                        {item.summary}
                      </p>
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-600 transition-colors"
                      >
                        閱讀全文 →
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {/* 深度觀點 */}
            <section className="bg-indigo-50 rounded-2xl p-5">
              <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-2">
                💡 深度觀點
              </p>
              <p className="text-sm text-zinc-700 leading-relaxed">{news.insight}</p>
            </section>

            {/* 新聞來源 */}
            <section>
              <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-3">
                新聞來源
              </p>
              <ul className="space-y-2">
                {news.sources.map((s, i) => (
                  <li key={i}>
                    <a
                      href={s.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-zinc-500 hover:text-indigo-600 transition-colors block truncate"
                    >
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
