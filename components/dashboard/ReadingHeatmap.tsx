'use client';

import type { ActivityRecord } from '@/types/contracts';

const WEEKS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

// Read-time → intensity level (0–4) → colour.
const LEVEL_COLORS = [
  'bg-zinc-100',
  'bg-green-200',
  'bg-green-300',
  'bg-green-400',
  'bg-green-600',
];

function levelFor(seconds: number): number {
  if (seconds <= 0) return 0;
  if (seconds < 300) return 1; // < 5 min
  if (seconds < 600) return 2; // < 10 min
  if (seconds < 1200) return 3; // < 20 min
  return 4; // 20 min+
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** GitHub-style heatmap of reading consistency over the last 12 weeks. */
export default function ReadingHeatmap({ records }: { records: ActivityRecord[] }) {
  const byDate = new Map(records.map((r) => [r.date, r.readSeconds]));

  // Build columns of 7 days each, ending today, aligned so the last column ends
  // on today and earlier columns are full weeks before it.
  const today = new Date();
  const end = new Date(today.getTime());
  const totalDays = WEEKS * 7;
  const start = new Date(end.getTime() - (totalDays - 1) * DAY_MS);

  const columns: Date[][] = [];
  for (let w = 0; w < WEEKS; w += 1) {
    const col: Date[] = [];
    for (let d = 0; d < 7; d += 1) {
      col.push(new Date(start.getTime() + (w * 7 + d) * DAY_MS));
    }
    columns.push(col);
  }

  return (
    <div className="bg-white rounded-[28px] p-7 border border-zinc-100 shadow-card">
      <h3 className="text-base font-black text-zinc-900 mb-1">Reading consistency</h3>
      <p className="text-xs text-zinc-400 font-medium mb-5">Last 12 weeks</p>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {columns.map((col, ci) => (
          <div key={ci} className="flex flex-col gap-1">
            {col.map((day) => {
              const future = day.getTime() > today.getTime();
              const level = future ? -1 : levelFor(byDate.get(iso(day)) ?? 0);
              return (
                <div
                  key={iso(day)}
                  title={`${iso(day)}: ${Math.round((byDate.get(iso(day)) ?? 0) / 60)} min`}
                  className={`w-3.5 h-3.5 rounded-[3px] ${
                    level === -1 ? 'bg-transparent' : LEVEL_COLORS[level]
                  }`}
                />
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-1.5 mt-4 text-[10px] text-zinc-400 font-bold">
        <span>Less</span>
        {LEVEL_COLORS.map((c, i) => (
          <span key={i} className={`w-3 h-3 rounded-[3px] ${c}`} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
