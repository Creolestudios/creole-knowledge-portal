'use client';

import { useEffect, useState } from 'react';
import { Loader2, Activity, CheckCircle, XCircle, MinusCircle, Flame } from 'lucide-react';
import type { ActivityRecord } from '@/types/contracts';
import { getActivity } from '@/lib/data/activity';
import { computeStreak } from '@/lib/data/streak';
import { getBlogIndex } from '@/lib/data/blogs';
import ReadingHeatmap from './ReadingHeatmap';
import ReadingTrendChart from './ReadingTrendChart';
import TopicMix, { type TopicCount } from './TopicMix';

function formatDuration(seconds: number): string {
  if (seconds === 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function formatDay(date: string): string {
  return new Date(date).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Activity tracker dashboard: reading streak, a 14-day reading-time chart, a
 * 12-week consistency heatmap, the topic mix, and the detailed day-by-day log.
 * The compact weekly summary lives in the sidebar (`SidebarActivityWidget`).
 */
export default function ActivityTab() {
  const [records, setRecords] = useState<ActivityRecord[] | null>(null);
  const [streak, setStreak] = useState(0);
  const [topics, setTopics] = useState<TopicCount[]>([]);

  useEffect(() => {
    void getActivity().then((data) => {
      setRecords(data);
      setStreak(computeStreak(data));
    });
    void getBlogIndex().then((index) => {
      const counts = new Map<string, number>();
      for (const b of index) {
        for (const tag of b.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
      setTopics(
        Array.from(counts, ([tag, count]) => ({ tag, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 6)
      );
    });
  }, []);

  if (!records) {
    return (
      <div className="flex items-center justify-center py-24 text-zinc-400 gap-3">
        <Loader2 className="animate-spin" size={20} />
        <span className="font-semibold">Loading your activity…</span>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Streak banner */}
      <div className="bg-gradient-to-r from-zinc-950 to-zinc-900 rounded-3xl sm:rounded-[28px] p-5 sm:p-7 border border-zinc-800 flex items-center gap-4 sm:gap-5">
        <div className="w-14 h-14 rounded-2xl bg-brand/10 border border-brand/20 flex items-center justify-center text-brand shrink-0">
          <Flame size={28} />
        </div>
        <div>
          <p className="text-3xl font-black text-white tabular-nums leading-none">
            {streak} day{streak === 1 ? '' : 's'}
          </p>
          <p className="text-zinc-400 text-sm font-medium mt-1">
            {streak > 0 ? 'Reading streak — keep it going!' : 'Read today to start a streak.'}
          </p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
        <ReadingTrendChart records={records} />
        <TopicMix topics={topics} />
      </div>

      <ReadingHeatmap records={records} />

      <div className="bg-white rounded-3xl sm:rounded-[32px] p-5 sm:p-8 border border-zinc-100 shadow-card">
        <h2 className="text-xl font-black text-zinc-900 flex items-center gap-2 mb-6">
          <Activity size={20} className="text-brand" />
          Daily Activity
        </h2>

        <div className="overflow-x-auto rounded-2xl border border-zinc-100">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="bg-zinc-50 text-[10px] uppercase tracking-widest text-zinc-400 font-extrabold">
                <th className="text-left px-5 py-3">Date</th>
                <th className="text-left px-5 py-3">Read time</th>
                <th className="text-left px-5 py-3">Quiz</th>
                <th className="text-right px-5 py-3">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {records.map((r) => (
                <tr key={r.date} id={`activity-row-${r.date}`} className="hover:bg-zinc-50/60">
                  <td className="px-5 py-4 font-bold text-zinc-900">{formatDay(r.date)}</td>
                  <td className="px-5 py-4 text-zinc-600 font-semibold tabular-nums">
                    {formatDuration(r.readSeconds)}
                  </td>
                  <td className="px-5 py-4">
                    {!r.quizTaken ? (
                      <span className="inline-flex items-center gap-1.5 text-zinc-400 font-semibold text-xs">
                        <MinusCircle size={14} /> Skipped
                      </span>
                    ) : r.quizScore === r.quizTotal ? (
                      <span className="inline-flex items-center gap-1.5 text-green-600 font-semibold text-xs">
                        <CheckCircle size={14} /> Perfect
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-amber-600 font-semibold text-xs">
                        <XCircle size={14} /> Partial
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4 text-right font-black text-zinc-900 tabular-nums">
                    {r.quizTaken ? `${r.quizScore}/${r.quizTotal}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
