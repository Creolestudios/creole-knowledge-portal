'use client';

import { useEffect, useState } from 'react';
import { Loader2, Activity, CheckCircle, XCircle, MinusCircle, Flame } from 'lucide-react';

export default function ActivityTab({ user }: { user: any }) {
  const [records, setRecords] = useState<any[]>([]);
  const [streak, setStreak] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchActivity() {
      try {
        const res = await fetch('/api/activity');
        if (res.ok) {
          const data = await res.json();
          setRecords(data.records || []);
          setStreak(data.streak || 0);
        }
      } catch (e) {
        console.error('Error fetching activity:', e);
      } finally {
        setLoading(false);
      }
    }
    
    if (user) fetchActivity();
  }, [user]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-zinc-400 gap-3">
        <Loader2 className="animate-spin" size={20} />
        <span className="font-semibold">Loading your activity...</span>
      </div>
    );
  }

  const formatDuration = (seconds: number) => {
    if (!seconds) return '—';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  };

  const formatDay = (date: string) => {
    return new Date(date).toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="space-y-8">
      {/* Streak banner */}
      <div className="bg-gradient-to-r from-zinc-950 to-zinc-900 rounded-[28px] p-7 border border-zinc-800 flex items-center gap-5">
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Simple 14-day Reading Trend Chart */}
        <div className="bg-white rounded-[32px] p-8 border border-zinc-100 shadow-card">
          <h3 className="text-lg font-black text-zinc-900 mb-6">14-Day Reading Trend</h3>
          <div className="flex items-end gap-2 h-40">
            {/* Mock chart bars or empty state if no records */}
            {records.length === 0 ? (
              <div className="w-full h-full flex items-center justify-center text-zinc-400 text-sm">
                No data available
              </div>
            ) : (
              records.slice(0, 14).reverse().map((r, i) => {
                const maxSecs = Math.max(...records.map(x => x.read_seconds || 0), 60);
                const height = `${((r.read_seconds || 0) / maxSecs) * 100}%`;
                return (
                  <div key={i} className="flex-1 flex flex-col justify-end group relative h-full">
                    <div 
                      className="bg-brand/60 rounded-t-sm w-full transition-all group-hover:bg-brand"
                      style={{ height: height || '2px' }}
                    />
                    <div className="opacity-0 group-hover:opacity-100 absolute -top-8 left-1/2 -translate-x-1/2 bg-black text-white text-[10px] py-1 px-2 rounded whitespace-nowrap transition-opacity pointer-events-none z-10">
                      {formatDuration(r.read_seconds)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Basic Reading Heatmap representation */}
        <div className="bg-white rounded-[32px] p-8 border border-zinc-100 shadow-card">
          <h3 className="text-lg font-black text-zinc-900 mb-6">Consistency Heatmap</h3>
          <div className="grid grid-cols-12 gap-1.5 h-40 content-start">
             {Array.from({ length: 84 }).map((_, i) => (
                <div key={i} className="aspect-square rounded-[3px] bg-zinc-100" />
             ))}
             {/* Using a static mock grid since exact dates calculation is complex for a mock without full logic */}
             <div className="col-span-12 mt-2 text-xs text-zinc-400 text-center">
               (Heatmap visualization requires full history data)
             </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-[32px] p-8 border border-zinc-100 shadow-card">
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
              {records.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-zinc-500 font-medium">No activity recorded yet.</td>
                </tr>
              ) : records.map((r, idx) => (
                <tr key={idx} className="hover:bg-zinc-50/60">
                  <td className="px-5 py-4 font-bold text-zinc-900">{formatDay(r.date)}</td>
                  <td className="px-5 py-4 text-zinc-600 font-semibold tabular-nums">
                    {formatDuration(r.read_seconds)}
                  </td>
                  <td className="px-5 py-4">
                    {!r.quiz_taken ? (
                      <span className="inline-flex items-center gap-1.5 text-zinc-400 font-semibold text-xs">
                        <MinusCircle size={14} /> Skipped
                      </span>
                    ) : r.quiz_score === r.quiz_total ? (
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
                    {r.quiz_taken ? `${r.quiz_score}/${r.quiz_total}` : '—'}
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
