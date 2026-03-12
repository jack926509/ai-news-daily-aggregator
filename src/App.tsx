import React, { useState, useEffect } from 'react';

interface NewsHighlight {
  title: string;
  summary: string;
  link: string;
  tags?: string[];      // [新聞主編] 分類標籤
  importance?: number;  // [新聞主編] 重要性評分 1–5
}

interface NewsData {
  headline: string;
  headline_en?: string;  // [新聞主編] 英文頭條
  highlights: NewsHighlight[];
  insight: string;
  insight_en?: string;   // [新聞主編] 英文深度觀點
  dateLabel: string;
}

type TelegramStatus = 'idle' | 'sending' | 'success' | 'error';

// ── Skeleton Loader ───────────────────────────────────────────────────────────
function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse bg-zinc-200 dark:bg-zinc-700 rounded-xl ${className}`} />;
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

// ── [新聞主編] 分類標籤色系對應 ───────────────────────────────────────────────
const TAG_COLORS: Record<string, string> = {
  '大型模型': 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  'AI法規':   'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  '硬體':     'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  '應用':     'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  '研究':     'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  '產業動態': 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300',
  '開源':     'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  '資安':     'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
};

const TagBadge: React.FC<{ tag: string }> = ({ tag }) => {
  const color = TAG_COLORS[tag] ?? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${color}`}>
      {tag}
    </span>
  );
}

// ── [新聞主編] 重要性星等顯示 ─────────────────────────────────────────────────
function ImportanceStars({ score }: { score: number }) {
  const filled = Math.min(Math.max(Math.round(score), 1), 5);
  return (
    <span className="text-[10px] text-amber-400 shrink-0" title={`重要性 ${filled}/5`}>
      {'★'.repeat(filled)}{'☆'.repeat(5 - filled)}
    </span>
  );
}

// ── [前端] Telegram 推播按鈕 ─────────────────────────────────────────────────
function TelegramButton({ status, onClick }: { status: TelegramStatus; onClick: () => void }) {
  const styles: Record<TelegramStatus, string> = {
    idle:    'bg-[#2AABEE] text-white hover:bg-[#229ED9] active:scale-95',
    sending: 'bg-[#2AABEE]/60 text-white cursor-not-allowed',
    success: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
    error:   'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  };
  const labels: Record<TelegramStatus, string> = {
    idle:    '推播至 Telegram',
    sending: '傳送中...',
    success: '✓ 已推播',
    error:   '推播失敗',
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

// ── [前端] 暗黑模式切換按鈕 ──────────────────────────────────────────────────
function DarkModeToggle({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="w-8 h-8 rounded-full flex items-center justify-center text-sm text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
      title={dark ? '切換淺色模式' : '切換深色模式'}
    >
      {dark ? '☀' : '🌙'}
    </button>
  );
}

// ── 主元件 ────────────────────────────────────────────────────────────────────
export default function App() {
  const [news, setNews] = useState<NewsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus>('idle');
  // [前端] 暗黑模式：初始值跟隨系統設定
  const [dark, setDark] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  // [前端] 切換 dark class 至 <html>，驅動 Tailwind dark: variant
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

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

  // [前端] 修正：呼叫正確的 /api/send-telegram 端點（非 /api/send-line）
  const sendToTelegram = () => {
    setTelegramStatus('sending');
    fetch('/api/send-telegram', { method: 'POST' })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setTelegramStatus('success');
        setTimeout(() => setTelegramStatus('idle'), 3000);
      })
      .catch(err => {
        console.error(err);
        setTelegramStatus('error');
        setTimeout(() => setTelegramStatus('idle'), 3000);
      });
  };

  const dateLabel = news?.dateLabel ?? new Date().toLocaleDateString('zh-TW', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 px-4 py-8 md:px-8 transition-colors duration-200">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* ── 頁首 ─────────────────────────────────────────────────────────── */}
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 tracking-tight">
              每日 AI 新聞
            </h1>
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
              {dateLabel} · 由資深 AI 主編整理
            </p>
          </div>
          {/* [前端] 暗黑模式切換 + Telegram 推播按鈕 */}
          <div className="flex items-center gap-2 shrink-0 pt-0.5">
            <DarkModeToggle dark={dark} onToggle={() => setDark(d => !d)} />
            {news && <TelegramButton status={telegramStatus} onClick={sendToTelegram} />}
          </div>
        </header>

        {/* ── 內容區 ───────────────────────────────────────────────────────── */}
        {loading ? (
          <LoadingSkeleton />
        ) : error ? (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800 text-red-600 dark:text-red-400 rounded-2xl p-5 text-sm">
            {error}
          </div>
        ) : news ? (
          <>
            {/* 昨日頭條 */}
            <section className="bg-zinc-900 dark:bg-zinc-800 text-white rounded-2xl p-6">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">
                🔥 昨日頭條
              </p>
              <p className="text-base font-semibold leading-snug">{news.headline}</p>
              {/* [新聞主編] 多語言摘要：英文頭條 */}
              {news.headline_en && (
                <p className="text-xs text-zinc-400 mt-2 leading-relaxed italic">
                  {news.headline_en}
                </p>
              )}
            </section>

            {/* 重點新聞 */}
            <section className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
              <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800">
                <p className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-widest">
                  📌 重點新聞
                </p>
              </div>
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {news.highlights.map((item, i) => (
                  <li key={i} className="px-5 py-4 flex gap-3">
                    {/* 編號 */}
                    <span className="shrink-0 w-5 h-5 mt-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-500 dark:text-indigo-400 text-[10px] font-bold flex items-center justify-center">
                      {i + 1}
                    </span>
                    {/* 內容 */}
                    <div className="space-y-1.5 min-w-0">
                      {/* [新聞主編] 標題 + 重要性評分 */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 leading-snug">
                          {item.title}
                        </p>
                        {item.importance !== undefined && (
                          <ImportanceStars score={item.importance} />
                        )}
                      </div>
                      {/* [新聞主編] 分類標籤 */}
                      {item.tags && item.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {item.tags.map((tag: string, idx: number) => <TagBadge key={idx} tag={tag} />)}
                        </div>
                      )}
                      <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
                        {item.summary}
                      </p>
                      <a
                        href={item.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors"
                      >
                        閱讀全文 →
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {/* 深度觀點 */}
            <section className="bg-indigo-50 dark:bg-indigo-950/40 rounded-2xl p-5">
              <p className="text-[10px] font-bold text-indigo-400 dark:text-indigo-500 uppercase tracking-widest mb-2">
                💡 深度觀點
              </p>
              <p className="text-sm text-zinc-700 dark:text-zinc-300 leading-relaxed">
                {news.insight}
              </p>
              {/* [新聞主編] 多語言摘要：英文深度觀點 */}
              {news.insight_en && (
                <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-2 leading-relaxed italic">
                  {news.insight_en}
                </p>
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
