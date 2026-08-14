'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import type { ISODate } from '@/types/contracts';
import type { DayStatus } from '@/lib/data/activity';

function toISO(year: number, month: number, day: number): ISODate {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Per-status cell colours: green = read + quiz passed, orange = partial,
// red = not attempted. Selected adds a ring on top of the status colour.
const STATUS_STYLES: Record<DayStatus, string> = {
  completed: 'bg-green-100 text-green-700 hover:bg-green-200',
  partial: 'bg-amber-100 text-amber-700 hover:bg-amber-200',
  missed: 'bg-red-100 text-red-600 hover:bg-red-200',
};

const LEGEND: { status: DayStatus; dot: string; label: string }[] = [
  { status: 'completed', dot: 'bg-green-500', label: 'Read + quiz passed' },
  { status: 'partial', dot: 'bg-amber-500', label: 'Partial (read or low quiz)' },
  { status: 'missed', dot: 'bg-red-500', label: 'Not attempted' },
];

/**
 * Month calendar. Dates that have a blog (from `availableDates`) are clickable
 * and coloured by their engagement status (`statusByDate`); selecting one
 * raises `onSelectDate`.
 */
export default function CalendarSidebar({
  availableDates,
  statusByDate,
  selectedDate,
  onSelectDate,
}: {
  availableDates: ISODate[];
  statusByDate: Record<ISODate, DayStatus>;
  selectedDate: ISODate | null;
  onSelectDate: (date: ISODate) => void;
}) {
  const available = new Set(availableDates);
  const initial = selectedDate ? new Date(selectedDate) : new Date();
  const [view, setView] = useState({ year: initial.getFullYear(), month: initial.getMonth() });

  const firstDay = new Date(view.year, view.month, 1).getDay();
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const monthLabel = new Date(view.year, view.month, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  const cells: (number | null)[] = [
    ...new Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const shift = (delta: number) => {
    setView((v) => {
      const d = new Date(v.year, v.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  return (
    <div className="bg-white rounded-[28px] p-6 border border-zinc-100 shadow-card">
      <div className="flex items-center justify-between mb-5">
        <h3 className="flex items-center gap-2 text-sm font-black text-zinc-900">
          <CalendarDays size={16} className="text-brand" />
          {monthLabel}
        </h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            id="calendar-prev-month"
            onClick={() => shift(-1)}
            className="w-8 h-8 rounded-lg border border-zinc-200 flex items-center justify-center text-zinc-500 hover:bg-zinc-50 transition-all cursor-pointer"
            aria-label="Previous month"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            id="calendar-next-month"
            onClick={() => shift(1)}
            className="w-8 h-8 rounded-lg border border-zinc-200 flex items-center justify-center text-zinc-500 hover:bg-zinc-50 transition-all cursor-pointer"
            aria-label="Next month"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-2">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div
            key={i}
            className="text-center text-[10px] font-extrabold text-zinc-400 uppercase py-1"
          >
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, idx) => {
          if (day === null) return <div key={idx} />;
          const iso = toISO(view.year, view.month, day);
          const hasBlog = available.has(iso);
          const isSelected = iso === selectedDate;
          // Available days always carry a status (default "missed" if no record).
          const status: DayStatus = statusByDate[iso] ?? 'missed';
          return (
            <button
              type="button"
              key={idx}
              id={`calendar-day-${iso}`}
              disabled={!hasBlog}
              onClick={() => onSelectDate(iso)}
              className={`aspect-square rounded-xl text-xs font-bold flex items-center justify-center transition-all ${
                hasBlog
                  ? `${STATUS_STYLES[status]} cursor-pointer ${
                      isSelected ? 'ring-2 ring-zinc-900 ring-offset-1' : ''
                    }`
                  : 'text-zinc-300 cursor-default'
              }`}
            >
              {day}
            </button>
          );
        })}
      </div>

      <div className="mt-5 space-y-1.5">
        {LEGEND.map((item) => (
          <p
            key={item.status}
            className="text-[11px] text-zinc-500 font-medium flex items-center gap-2"
          >
            <span className={`w-3 h-3 rounded ${item.dot} inline-block shrink-0`} />
            {item.label}
          </p>
        ))}
      </div>
    </div>
  );
}
