'use client';

import { useState, useEffect } from 'react';
import { CalendarSearch, Loader2, Calendar, CalendarDays } from 'lucide-react';
import { PremiumMarkdownRenderer } from './PremiumMarkdownRenderer';

type PastBlog = {
  title?: string;
  content?: string;
  digest_date?: string;
  published_at?: string;
};

function localDateKey(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toDateKey(value?: string | null): string {
  if (!value) return '';
  const day = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (day) return day[1];
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10);
  return localDateKey(parsed);
}

function formatFetchedLabel(dateKey: string): string {
  const today = localDateKey(new Date());
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = localDateKey(yesterdayDate);
  if (dateKey === today) return 'Today';
  if (dateKey === yesterday) return 'Yesterday';
  return dateKey;
}

export default function PastBlogsTab({
  selected,
  onSelect,
}: {
  selected?: string | null;
  onSelect?: (date: string | null) => void;
} = {}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(selected || null);
  const [blog, setBlog] = useState<PastBlog | null>(null);
  const [blogs, setBlogs] = useState<PastBlog[]>([]);
  const [loading, setLoading] = useState(false);

  const [currentDate, setCurrentDate] = useState(new Date());
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  const firstDayIndex = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const daysArray: (number | null)[] = [];
  for (let i = 0; i < firstDayIndex; i++) daysArray.push(null);
  for (let i = 1; i <= totalDays; i++) daysArray.push(i);

  const blogDates = new Set(
    blogs.map((item) => toDateKey(item.digest_date || item.published_at)).filter(Boolean)
  );

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/digests/past');
        if (!res.ok) return;
        const data = await res.json();
        setBlogs(data.blogs || []);
      } catch (err) {
        console.error(err);
      }
    };
    void load();
  }, []);

  const fetchBlogForDate = async (dateStr: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/digests/past?date=${dateStr}`);
      if (res.ok) {
        const data = await res.json();
        setBlog(data.blog || null);
      } else {
        setBlog(null);
      }
    } catch (err) {
      console.error(err);
      setBlog(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!selected) return;
    queueMicrotask(() => {
      setSelectedDate(selected);
      void fetchBlogForDate(selected);
    });
  }, [selected]);

  useEffect(() => {
    if (selected || selectedDate || blogs.length === 0) return;
    const key = toDateKey(blogs[0].digest_date || blogs[0].published_at);
    if (!key) return;
    const [yearNum, monthNum, dayNum] = key.split('-').map(Number);
    queueMicrotask(() => {
      setCurrentDate(new Date(yearNum, monthNum - 1, dayNum));
      setSelectedDate(key);
      onSelect?.(key);
      void fetchBlogForDate(key);
    });
  }, [blogs, selected, selectedDate, onSelect]);

  const handleSelectDate = async (day: number) => {
    const cell = new Date(year, month, day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (cell > today) return;
    const dateStr = localDateKey(cell);
    setSelectedDate(dateStr);
    onSelect?.(dateStr);
    await fetchBlogForDate(dateStr);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8 items-start">
      <div className="lg:col-span-1 space-y-4">
        <div className="bg-white rounded-[32px] p-6 border border-zinc-100 shadow-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-black text-zinc-900 flex items-center gap-2">
              <Calendar size={16} className="text-brand" />
              Past Briefings
            </h3>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentDate(new Date(year, month - 1, 1))}
                className="p-1 hover:bg-zinc-50 border rounded text-zinc-600 transition-colors cursor-pointer text-[10px] font-bold"
              >
                &lt;
              </button>
              <span className="text-[10px] font-bold text-zinc-700 min-w-[70px] text-center">
                {monthNames[month]} {year}
              </span>
              <button
                onClick={() => setCurrentDate(new Date(year, month + 1, 1))}
                className="p-1 hover:bg-zinc-50 border rounded text-zinc-600 transition-colors cursor-pointer text-[10px] font-bold"
              >
                &gt;
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[9px] font-extrabold text-zinc-400 uppercase tracking-wider mb-2">
            <span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>
          </div>

          <div className="grid grid-cols-7 gap-1">
            {daysArray.map((day, idx) => {
              let bgClass = 'bg-transparent text-transparent pointer-events-none';
              let isClickable = false;

              if (day !== null) {
                const cellDate = new Date(year, month, day);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const dateStr = localDateKey(cellDate);
                const isSelected = selectedDate === dateStr;
                const hasBlog = blogDates.has(dateStr);

                if (cellDate > today) {
                  bgClass = 'bg-zinc-50 text-zinc-300 border border-zinc-100';
                } else {
                  isClickable = true;
                  bgClass = hasBlog
                    ? 'bg-brand/10 text-brand border border-brand/20 hover:bg-brand/20 cursor-pointer'
                    : 'bg-zinc-50 text-zinc-500 border border-zinc-100 hover:bg-zinc-100 cursor-pointer';
                }

                if (isSelected) {
                  bgClass += ' ring-2 ring-brand ring-offset-1 font-black';
                }
              }

              return (
                <div
                  key={idx}
                  role={isClickable ? 'button' : undefined}
                  tabIndex={isClickable ? 0 : undefined}
                  onClick={() => isClickable && day && handleSelectDate(day)}
                  onKeyDown={(e) => {
                    if (isClickable && day && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      void handleSelectDate(day);
                    }
                  }}
                  className={`aspect-square flex items-center justify-center text-[10px] font-semibold rounded transition-all duration-150 ${bgClass}`}
                >
                  {day}
                </div>
              );
            })}
          </div>
        </div>

        {blogs.length > 0 && (
          <div className="bg-white rounded-[32px] p-5 border border-zinc-100 shadow-card space-y-2">
            {blogs.map((item, idx) => {
              const key = toDateKey(item.digest_date || item.published_at);
              return (
                <button
                  key={`${key}-${idx}`}
                  type="button"
                  onClick={() => {
                    if (!key) return;
                    setSelectedDate(key);
                    onSelect?.(key);
                    void fetchBlogForDate(key);
                  }}
                  className={`w-full text-left rounded-2xl px-3 py-2 border transition-colors ${
                    selectedDate === key ? 'border-brand bg-brand/10' : 'border-zinc-100 hover:bg-zinc-50'
                  }`}
                >
                  <p className="text-xs font-black text-zinc-900 truncate">{item.title || 'Morning Briefing'}</p>
                  <p id="past-blog-fetched-date" className="text-[10px] font-bold text-zinc-400 mt-1">
                    Fetched {formatFetchedLabel(key)}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="lg:col-span-2">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-zinc-400 gap-3">
            <Loader2 className="animate-spin" size={20} />
            <span className="font-semibold">Loading blog...</span>
          </div>
        ) : blog ? (
          <div className="bg-white rounded-[32px] p-10 border border-zinc-100 shadow-card">
            <h2 className="text-3xl font-black text-zinc-900 tracking-tight leading-tight mb-3">
              {blog.title}
            </h2>
            <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-400 mb-8 flex items-center gap-2">
              <CalendarDays size={14} />
              Fetched {formatFetchedLabel(toDateKey(blog.digest_date || blog.published_at || selectedDate))}
            </p>
            <PremiumMarkdownRenderer content={blog.content || ''} />
          </div>
        ) : (
          <div className="bg-white rounded-[32px] p-8 sm:p-16 border border-zinc-100 shadow-card text-center space-y-3">
            <CalendarSearch size={32} className="text-zinc-300 mx-auto" />
            <p className="text-zinc-500 font-semibold">
              Pick a highlighted date from the calendar to read that day&apos;s past briefing.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
