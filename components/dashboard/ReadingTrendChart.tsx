'use client';

import type { ActivityRecord } from '@/types/contracts';

const DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Vertical bar chart of reading minutes over the last 14 days (no chart lib). */
export default function ReadingTrendChart({ records }: { records: ActivityRecord[] }) {
  const byDate = new Map(records.map((r) => [r.date, r.readSeconds]));

  const today = new Date();
  const days = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(today.getTime() - (DAYS - 1 - i) * DAY_MS);
    return { date: d, minutes: Math.round((byDate.get(iso(d)) ?? 0) / 60) };
  });

  const max = Math.max(20, ...days.map((d) => d.minutes));

  return (
    <div className="bg-white rounded-[28px] p-7 border border-zinc-100 shadow-card">
      <h3 className="text-base font-black text-zinc-900 mb-1">Minutes read</h3>
      <p className="text-xs text-zinc-400 font-medium mb-5">Last 14 days</p>

      <div className="flex justify-between gap-1.5 h-40">
        {days.map(({ date, minutes }) => (
          <div key={iso(date)} className="flex-1 h-full flex flex-col items-center gap-2 group">
            <div className="w-full flex-1 flex items-end">
              <div
                className="w-full rounded-t-md bg-brand/80 group-hover:bg-brand transition-all min-h-[2px]"
                style={{ height: `${(minutes / max) * 100}%` }}
                title={`${iso(date)}: ${minutes} min`}
              />
            </div>
            <span className="text-[9px] text-zinc-400 font-bold tabular-nums">
              {date.getDate()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
