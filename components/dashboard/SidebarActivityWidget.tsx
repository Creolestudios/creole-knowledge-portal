'use client';

import { BarChart3, CalendarCheck, ClipboardCheck } from 'lucide-react';
import type { WeeklyStats } from '@/types/contracts';

/**
 * Compact weekly activity summary styled for the dark sidebar. Shows days read,
 * quizzes submitted, and the correct/wrong split for the briefing days (Mon-Fri)
 * in the trailing week.
 */
export default function SidebarActivityWidget({ stats }: { stats: WeeklyStats | null }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4">
      <h3 className="text-[10px] font-extrabold uppercase tracking-widest text-zinc-500 flex items-center gap-2">
        <BarChart3 size={13} className="text-brand" />
        This Week
      </h3>

      {!stats ? (
        <div className="h-16 rounded-lg bg-zinc-800/40 animate-pulse" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-xl bg-zinc-800/40 border border-zinc-800 p-3">
              <div className="flex items-center gap-1.5 text-[9px] font-extrabold uppercase tracking-widest text-zinc-500 mb-1">
                <CalendarCheck size={11} /> Days
              </div>
              <p className="text-xl font-black text-white tabular-nums leading-none">
                {stats.daysRead}
                <span className="text-zinc-600 text-sm font-bold">/{stats.briefingDays}</span>
              </p>
            </div>
            <div className="rounded-xl bg-zinc-800/40 border border-zinc-800 p-3">
              <div className="flex items-center gap-1.5 text-[9px] font-extrabold uppercase tracking-widest text-zinc-500 mb-1">
                <ClipboardCheck size={11} /> Quizzes
              </div>
              <p className="text-xl font-black text-white tabular-nums leading-none">
                {stats.quizzesSubmitted}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[10px] font-bold">
              <span className="text-green-400">{stats.correctPct}% right</span>
              <span className="text-red-400">{stats.wrongPct}% wrong</span>
            </div>
            <div className="w-full h-2 rounded-full overflow-hidden bg-zinc-800 flex">
              <div
                className="h-full bg-green-500 transition-all"
                style={{ width: `${stats.correctPct}%` }}
              />
              <div
                className="h-full bg-red-400 transition-all"
                style={{ width: `${stats.wrongPct}%` }}
              />
            </div>
            {stats.quizzesSubmitted === 0 && (
              <p className="text-[10px] text-zinc-600 font-medium pt-0.5">No quizzes yet.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
