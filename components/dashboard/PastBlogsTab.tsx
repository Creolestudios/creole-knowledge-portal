'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { CalendarSearch, Loader2, Calendar, CalendarDays } from 'lucide-react';
import { PremiumMarkdownRenderer } from './PremiumMarkdownRenderer';
import { isBriefingDay, localDateKey } from '@/lib/data/streak';
import { hasPassedQuiz } from '@/lib/quizzes/scoring';

type PastBlog = {
  title?: string;
  content?: string;
  digest_date?: string;
  published_at?: string;
  estimated_read_minutes?: number;
};

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

function isQuizCompletedForDate(
  activities: Record<string, any>,
  dateStr: string,
): boolean {
  return Boolean(activities[dateStr]?.quiz_taken);
}

/** Same pass rule as Activity Tracker / quiz submit (≥3 correct). */
function isQuizPassedForDate(
  activities: Record<string, any>,
  dateStr: string,
): boolean {
  const activity = activities[dateStr];
  if (!activity?.quiz_taken) return false;
  if (typeof activity.quiz_passed === 'boolean') return activity.quiz_passed;
  return hasPassedQuiz(Number(activity.quiz_score) || 0);
}

/**
 * Same day: past-blog entry only after quiz is completed.
 * From the next day onward: blog is visible even if quiz was missed (shown red).
 */
function isPastBlogVisibleOnCalendar(
  dateStr: string,
  activities: Record<string, any>,
  todayKey: string,
): boolean {
  if (!dateStr) return false;
  if (dateStr === todayKey) {
    return isQuizCompletedForDate(activities, dateStr);
  }
  return dateStr < todayKey;
}

function isSameDayQuizLocked(
  dateStr: string,
  activities: Record<string, any>,
  todayKey: string,
): boolean {
  return dateStr === todayKey && !isQuizCompletedForDate(activities, dateStr);
}

export default function PastBlogsTab({
  selected,
  onSelect,
  user,
  profile,
}: {
  selected?: string | null;
  onSelect?: (date: string | null) => void;
  user?: { email?: string; user_metadata?: { full_name?: string } } | null;
  profile?: { full_name?: string } | null;
} = {}) {
  const [selectedDate, setSelectedDate] = useState<string | null>(selected || null);
  const [blog, setBlog] = useState<PastBlog | null>(null);
  const [blogs, setBlogs] = useState<PastBlog[]>([]);
  const [loading, setLoading] = useState(false);
  const [activities, setActivities] = useState<Record<string, any>>({});

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

  const todayKey = localDateKey(new Date());

  /** Visible past blogs: quiz done today, or any prior day (missed quiz → red). */
  const visibleBlogs = useMemo(
    () =>
      blogs.filter((item) => {
        const key = toDateKey(item.digest_date || item.published_at);
        return key && isPastBlogVisibleOnCalendar(key, activities, todayKey);
      }),
    [blogs, activities, todayKey],
  );

  const blogDates = useMemo(
    () =>
      new Set(
        visibleBlogs
          .map((item) => toDateKey(item.digest_date || item.published_at))
          .filter(Boolean),
      ),
    [visibleBlogs],
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
    const loadActivities = async () => {
      try {
        const res = await fetch('/api/activity');
        if (!res.ok) return;
        const data = await res.json();
        const activityMap: Record<string, any> = {};
        data.records?.forEach((r: any) => {
          activityMap[r.date] = r;
        });
        setActivities(activityMap);
      } catch (err) {
        console.error(err);
      }
    };
    void load();
    void loadActivities();
  }, []);

  const fetchBlogForDate = useCallback(async (dateStr: string) => {
    setLoading(true);
    try {
      // Same day without quiz: do not show in Past Blogs at all.
      if (isSameDayQuizLocked(dateStr, activities, todayKey)) {
        setBlog(null);
        return;
      }
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
  }, [activities, todayKey]);

  useEffect(() => {
    if (!selected) return;
    queueMicrotask(() => {
      setSelectedDate(selected);
      void fetchBlogForDate(selected);
    });
  }, [selected, activities, fetchBlogForDate]);

  useEffect(() => {
    if (selected || selectedDate || visibleBlogs.length === 0) return;
    const key = toDateKey(visibleBlogs[0].digest_date || visibleBlogs[0].published_at);
    if (!key) return;
    const [yearNum, monthNum, dayNum] = key.split('-').map(Number);
    queueMicrotask(() => {
      setCurrentDate(new Date(yearNum, monthNum - 1, dayNum));
      setSelectedDate(key);
      onSelect?.(key);
      void fetchBlogForDate(key);
    });
  }, [visibleBlogs, selected, selectedDate, onSelect, activities, fetchBlogForDate]);

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
            <span className="text-zinc-300">S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span className="text-zinc-300">S</span>
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
                } else if (!isBriefingDay(cellDate) && !hasBlog) {
                  bgClass = 'bg-zinc-100 text-zinc-400 cursor-not-allowed';
                } else {
                  isClickable = true;
                  if (hasBlog) {
                    const activity = activities[dateStr];
                    const isQuizTaken = Boolean(activity?.quiz_taken);
                    const passedQuiz = isQuizPassedForDate(activities, dateStr);

                    if (passedQuiz) {
                      bgClass = 'bg-green-500 text-white hover:bg-green-600 cursor-pointer shadow-sm';
                    } else if (isQuizTaken) {
                      bgClass = 'bg-blue-500 text-white hover:bg-blue-600 cursor-pointer shadow-sm';
                    } else {
                      // Prior day, quiz never completed → red (available from next day).
                      bgClass = 'bg-red-500 text-white hover:bg-red-600 cursor-pointer shadow-sm';
                    }
                  } else {
                    bgClass = 'bg-zinc-50 text-zinc-500 hover:bg-zinc-100 cursor-pointer';
                  }
                }

                if (isSelected) {
                  bgClass += ' scale-110 shadow-md font-black z-10 border-2 border-zinc-900';
                }
              }

              return (
                <div
                  key={idx}
                  role={isClickable ? 'button' : undefined}
                  title={
                    day !== null && !isBriefingDay(new Date(year, month, day)) && !isClickable
                      ? 'No briefing on weekends'
                      : undefined
                  }
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

        <div className="bg-white rounded-[32px] p-6 border border-zinc-100 shadow-card space-y-3">
          <h4 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-3">Activity Legend</h4>
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 rounded bg-green-500 flex-shrink-0 shadow-sm"></div>
            <span className="text-xs font-bold text-zinc-700">Mastered (Passed Quiz)</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 rounded bg-blue-500 flex-shrink-0 shadow-sm"></div>
            <span className="text-xs font-bold text-zinc-700">Completed quiz (practice)</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 rounded bg-red-500 flex-shrink-0 shadow-sm"></div>
            <span className="text-xs font-bold text-zinc-700">Missed quiz</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-4 h-4 rounded bg-zinc-100 border border-zinc-200 flex-shrink-0"></div>
            <span className="text-xs font-bold text-zinc-700">Weekend (No Briefing)</span>
          </div>
        </div>
      </div>

      <div className="lg:col-span-2">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-zinc-400 gap-3">
            <Loader2 className="animate-spin" size={20} />
            <span className="font-semibold">Loading blog...</span>
          </div>
        ) : blog ? (
          <div className="space-y-6">
            <div className="mb-2 space-y-1">
              <p className="text-sm font-bold text-zinc-500 tracking-wide">
                Welcome,{' '}
                {(
                  profile?.full_name ||
                  user?.user_metadata?.full_name ||
                  user?.email?.split('@')[0] ||
                  'there'
                ).trim() || 'there'}
              </p>
              <h1 className="text-2xl sm:text-3xl font-black text-zinc-900 tracking-tight">
                Morning Briefing
              </h1>
            </div>
            <div className="bg-white rounded-[32px] p-10 border border-zinc-100 shadow-card">
            <h2 className="text-3xl font-black text-zinc-900 tracking-tight leading-tight mb-3">
              {blog.title}
            </h2>
            <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-400 mb-8 flex items-center gap-2">
              <CalendarDays size={14} />
              Fetched {formatFetchedLabel(toDateKey(blog.digest_date || blog.published_at || selectedDate))}
              {blog.estimated_read_minutes != null && (
                <>
                  <span className="text-zinc-300">·</span>
                  {Math.max(1, Math.round(Number(blog.estimated_read_minutes)))} min read
                </>
              )}
            </p>
            <PremiumMarkdownRenderer content={blog.content || ''} />
            </div>
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
