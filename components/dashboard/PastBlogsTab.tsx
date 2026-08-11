'use client';

import { useEffect, useState } from 'react';
import { Loader2, CalendarSearch } from 'lucide-react';
import type { DailyBlog, ISODate } from '@/types/contracts';
import { getAvailableDates, getBlogByDate } from '@/lib/data/blogs';
import { getDayStatuses, type DayStatus } from '@/lib/data/activity';
import CalendarSidebar from './CalendarSidebar';
import BlogArticle from './BlogArticle';

/**
 * Tab 2: browse past blogs via the calendar; selecting a date renders that
 * day's blog. Selection is controlled by the parent so the header search can
 * jump straight to a specific date.
 */
export default function PastBlogsTab({
  selected,
  onSelect,
}: {
  selected: ISODate | null;
  onSelect: (date: ISODate) => void;
}) {
  const [dates, setDates] = useState<ISODate[]>([]);
  const [statusByDate, setStatusByDate] = useState<Record<ISODate, DayStatus>>({});
  const [blog, setBlog] = useState<DailyBlog | null>(null);
  const [resolvedFor, setResolvedFor] = useState<ISODate | null>(null);

  // Loading while the selected date hasn't been resolved yet (avoids
  // setState-in-effect; the fetch resolves `resolvedFor` in its callback).
  const loadingBlog = selected !== null && resolvedFor !== selected;

  useEffect(() => {
    void getAvailableDates().then((d) => {
      setDates(d);
      // Default to the most recent past day (skip today, which is the first entry).
      if (!selected) {
        const firstPast = d[1] ?? d[0] ?? null;
        if (firstPast) onSelect(firstPast);
      }
    });
    void getDayStatuses().then(setStatusByDate);
    // Run once on mount; parent owns `selected` thereafter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    void getBlogByDate(selected).then((b) => {
      if (cancelled) return;
      setBlog(b);
      setResolvedFor(selected);
    });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8 items-start">
      <div className="lg:col-span-1">
        <CalendarSidebar
          availableDates={dates}
          statusByDate={statusByDate}
          selectedDate={selected}
          onSelectDate={onSelect}
        />
      </div>

      <div className="lg:col-span-2">
        {loadingBlog ? (
          <div className="flex items-center justify-center py-24 text-zinc-400 gap-3">
            <Loader2 className="animate-spin" size={20} />
            <span className="font-semibold">Loading blog…</span>
          </div>
        ) : blog ? (
          <BlogArticle blog={blog} />
        ) : (
          <div className="bg-white rounded-3xl sm:rounded-[32px] p-8 sm:p-16 border border-zinc-100 shadow-card text-center space-y-3">
            <CalendarSearch size={32} className="text-zinc-300 mx-auto" />
            <p className="text-zinc-500 font-semibold">
              Pick a highlighted date to read that day&apos;s blog.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
