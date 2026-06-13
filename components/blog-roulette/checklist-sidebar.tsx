'use client';

import { CheckCircle2, XCircle } from 'lucide-react';
import type { CheckpointResult } from '@/lib/blog-roulette/validators';

interface Props {
  result: CheckpointResult;
}

export default function ChecklistSidebar({ result }: Props) {
  return (
    <div className="bg-white rounded-[28px] p-7 border border-zinc-100 shadow-card sticky top-6">
      <h3 className="text-sm font-black text-zinc-900 mb-4 tracking-tight uppercase">
        Pre-Submit Checklist
      </h3>
      <ul className="space-y-3">
        {result.checks.map((c) => (
          <li key={c.name} className="flex items-start gap-3">
            {c.pass ? (
              <CheckCircle2
                size={18}
                className="text-emerald-500 shrink-0 mt-0.5"
              />
            ) : (
              <XCircle size={18} className="text-zinc-300 shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <p
                className={`text-xs font-bold ${c.pass ? 'text-emerald-700' : 'text-zinc-600'}`}
              >
                {c.label}
              </p>
              {c.detail && (
                <p className="text-[10px] text-zinc-400 font-medium mt-0.5">
                  {c.detail}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>

      <div
        className={`mt-6 px-4 py-3 rounded-xl text-center text-xs font-bold uppercase tracking-widest border ${
          result.passed
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : 'bg-zinc-50 text-zinc-500 border-zinc-200'
        }`}
      >
        {result.passed ? 'Ready to Submit' : 'Keep Going'}
      </div>
    </div>
  );
}
