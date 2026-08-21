'use client';

import { useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import {
  Sparkles,
  Loader2,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Minus,
  Hash,
} from 'lucide-react';
import LogoutButton from '@/components/logout-button';
import DashboardShell from '@/components/dashboard/DashboardShell';
import type {
  KeywordSuggestion,
  TrendDirection,
} from '@/lib/blog-roulette/types';

function TrendIcon({ d }: { d: TrendDirection }) {
  if (d === 'rising')
    return <TrendingUp size={14} className="text-emerald-500" />;
  if (d === 'falling')
    return <TrendingDown size={14} className="text-red-500" />;
  return <Minus size={14} className="text-zinc-400" />;
}

function trendLabel(d: TrendDirection) {
  if (d === 'rising') return 'Rising';
  if (d === 'falling') return 'Falling';
  return 'Stable';
}

function NewBlogPageContent() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [suggestions, setSuggestions] = useState<KeywordSuggestion[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [creating, setCreating] = useState(false);

  async function handleSuggest() {
    if (title.trim().length < 5) return;
    setFetching(true);
    setSuggestions([]);
    try {
      const res = await fetch('/api/blog-roulette/seo-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (res.ok) {
        const data = await res.json();
        setSuggestions(data.suggestions ?? []);
      }
    } finally {
      setFetching(false);
    }
  }

  function toggleKeyword(kw: string) {
    setSelected((s) =>
      s.includes(kw) ? s.filter((k) => k !== kw) : [...s, kw],
    );
  }

  async function handleCreate() {
    if (title.trim().length < 10) {
      alert('Title must be at least 10 characters.');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/blog-roulette', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, keywords: selected, suggestions }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error ?? 'Failed to create blog.');
        return;
      }
      const data = await res.json();
      router.push(`/blog-roulette/${data.id}/edit`);
    } finally {
      setCreating(false);
    }
  }

  const primary = suggestions.filter((s) => s.type === 'primary');
  const longTail = suggestions.filter((s) => s.type === 'long_tail');

  return (
    <DashboardShell
      displayName="Author"
      displayDomain="creole"
      footer={<LogoutButton variant="sidebar" />}
    >
      <div className="max-w-4xl mx-auto">
        <div className="mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-brand/10 border border-brand/20 rounded-full text-brand text-[10px] font-bold uppercase tracking-widest mb-4">
            <Sparkles size={10} />
            New Blog
          </div>
          <h1 className="text-4xl font-black text-zinc-900 tracking-tight mb-3">
            Start with a title
          </h1>
          <p className="text-zinc-500 text-base">
            We&apos;ll suggest SEO-friendly keywords from Google Autocomplete +
            trend direction from Google Trends. Pick what fits.
          </p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-[32px] p-10 border border-zinc-100 shadow-card mb-8"
        >
          <label
            htmlFor="title"
            className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2"
          >
            Blog Title
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Building Multi-Region Auth with Supabase + Next.js"
            className="w-full px-4 py-3.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent transition-all text-zinc-900 placeholder:text-zinc-300 text-lg font-medium"
          />

          <button
            onClick={handleSuggest}
            disabled={fetching || title.trim().length < 5}
            className="mt-5 px-6 py-3 bg-zinc-900 hover:bg-zinc-800 text-white font-bold rounded-xl transition-all flex items-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {fetching ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Sparkles size={16} className="text-brand" />
            )}
            Suggest Keywords
          </button>
        </motion.div>

        {suggestions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-[32px] p-10 border border-zinc-100 shadow-card mb-8"
          >
            <h2 className="text-xl font-black text-zinc-900 mb-6 flex items-center gap-2">
              <Hash size={20} className="text-brand" />
              Keyword Suggestions
            </h2>

            {primary.length > 0 && (
              <div className="mb-8">
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-3">
                  Primary picks
                </p>
                <div className="flex flex-wrap gap-2">
                  {primary.map((s) => (
                    <button
                      key={s.keyword}
                      onClick={() => toggleKeyword(s.keyword)}
                      className={`px-4 py-2.5 rounded-xl border text-sm font-bold transition-all flex items-center gap-2 ${
                        selected.includes(s.keyword)
                          ? 'bg-brand text-black border-brand shadow-brand'
                          : 'bg-zinc-50 text-zinc-700 border-zinc-200 hover:border-brand/40'
                      }`}
                    >
                      <span>{s.keyword}</span>
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest opacity-80">
                        <TrendIcon d={s.trend_direction} />
                        {trendLabel(s.trend_direction)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {longTail.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-3">
                  Long-tail variants
                </p>
                <div className="flex flex-wrap gap-2">
                  {longTail.map((s) => (
                    <button
                      key={s.keyword}
                      onClick={() => toggleKeyword(s.keyword)}
                      className={`px-3.5 py-2 rounded-xl border text-xs font-semibold transition-all ${
                        selected.includes(s.keyword)
                          ? 'bg-brand text-black border-brand'
                          : 'bg-white text-zinc-600 border-zinc-200 hover:border-brand/40'
                      }`}
                    >
                      {s.keyword}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p className="text-[11px] text-zinc-400 mt-6 italic">
              Trend direction = relative search interest over last 90 days
              (Google Trends). No fake difficulty score.
            </p>
          </motion.div>
        )}

        <div className="flex justify-end">
          <button
            onClick={handleCreate}
            disabled={creating || title.trim().length < 10}
            className="px-8 py-4 bg-brand hover:bg-brand-hover text-black font-black rounded-2xl shadow-brand transition-all flex items-center gap-2 text-sm uppercase tracking-widest disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <>
                Continue to Editor
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </div>
      </div>
    </DashboardShell>
  );
}

export default function NewBlogPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-brand animate-spin" />
      </div>
    }>
      <NewBlogPageContent />
    </Suspense>
  );
}
