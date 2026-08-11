'use client';

import { Tag } from 'lucide-react';

export interface TopicCount {
  tag: string;
  count: number;
}

/** Horizontal bars showing which topics appear most across the user's blogs. */
export default function TopicMix({ topics }: { topics: TopicCount[] }) {
  const max = Math.max(1, ...topics.map((t) => t.count));

  return (
    <div className="bg-white rounded-[28px] p-7 border border-zinc-100 shadow-card">
      <h3 className="text-base font-black text-zinc-900 flex items-center gap-2 mb-1">
        <Tag size={16} className="text-brand" />
        Your topic mix
      </h3>
      <p className="text-xs text-zinc-400 font-medium mb-5">Across your delivered blogs</p>

      {topics.length === 0 ? (
        <p className="text-sm text-zinc-400 font-medium">No topics yet.</p>
      ) : (
        <div className="space-y-3">
          {topics.map((t) => (
            <div key={t.tag} className="space-y-1">
              <div className="flex items-center justify-between text-xs font-bold text-zinc-700">
                <span>{t.tag}</span>
                <span className="text-zinc-400 tabular-nums">{t.count}</span>
              </div>
              <div className="w-full h-2 rounded-full bg-zinc-100 overflow-hidden">
                <div
                  className="h-full bg-brand rounded-full transition-all"
                  style={{ width: `${(t.count / max) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
