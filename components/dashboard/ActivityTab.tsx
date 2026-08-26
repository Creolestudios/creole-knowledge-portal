'use client';

import { useEffect, useState } from 'react';
import { Loader2, Activity, CheckCircle, XCircle, MinusCircle, Flame } from 'lucide-react';

export default function ActivityTab({ user }: { user?: any }) {
  const [records, setRecords] = useState<any[]>([]);
  const [streak, setStreak] = useState(0);
  const [loading, setLoading] = useState(true);
  const [displayLimit, setDisplayLimit] = useState(15);

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
    if (!seconds) return '0s';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m === 0) return `${s}s`;
    return `${m}m ${s}s`;
  };

  const formatDay = (dateStr: string) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="space-y-8">
      {/* Streak banner */}
      <div className="bg-gradient-to-r from-zinc-950 to-zinc-900 rounded-[28px] p-7 border border-zinc-800 flex items-center gap-5 shadow-lg">
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

      {/* Daily Activity Table */}
      <div className="bg-white rounded-[32px] p-8 border border-zinc-100 shadow-card">
        <h2 className="text-xl font-black text-zinc-900 flex items-center gap-2 mb-6">
          <Activity size={20} className="text-brand" />
          Daily Activity Log
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
              ) : records.slice(0, displayLimit).map((r, idx) => (
                <tr key={idx} className="hover:bg-zinc-50/60 transition-colors">
                  <td className="px-5 py-4 font-bold text-zinc-900">{formatDay(r.date)}</td>
                  <td className="px-5 py-4 text-zinc-600 font-semibold tabular-nums">
                    {r.read_seconds ? formatDuration(r.read_seconds) : '—'}
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
        
        {records.length > displayLimit && (
          <div className="mt-6 flex justify-center">
            <button 
              onClick={() => setDisplayLimit(prev => prev + 15)}
              className="px-6 py-2.5 bg-zinc-950 hover:bg-zinc-800 text-white rounded-full text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer shadow-md"
            >
              Load Older Activity
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
