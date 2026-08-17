'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'motion/react';
import { User, Newspaper, History, BarChart3, Menu, X, Flame, Sparkles } from 'lucide-react';
import type { WeeklyStats, ISODate } from '@/types/contracts';
import { getActivity, computeWeeklyStats } from '@/lib/data/activity';
import { computeStreak } from '@/lib/data/streak';
import DailyBlogTab from './DailyBlogTab';
import PastBlogsTab from './PastBlogsTab';
import ActivityTab from './ActivityTab';
import SidebarActivityWidget from './SidebarActivityWidget';
import GlobalSearch from './GlobalSearch';

type TabKey = 'daily' | 'past' | 'activity' | 'roulette';

const TAB_HREFS: Record<TabKey, string> = {
  daily: '/dashboard',
  past: '/dashboard?tab=past',
  activity: '/dashboard?tab=activity',
  roulette: '/blog-roulette',
};

function tabFromLocation(
  pathname: string | null | undefined,
  tabParam: string | null,
): TabKey {
  if (pathname?.startsWith('/blog-roulette')) return 'roulette';
  if (tabParam === 'past') return 'past';
  if (tabParam === 'activity') return 'activity';
  return 'daily';
}

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'daily', label: 'Daily Blog', icon: <Newspaper size={18} /> },
  { key: 'past', label: 'Past Blogs', icon: <History size={18} /> },
  { key: 'activity', label: 'Activity Tracker', icon: <BarChart3 size={18} /> },
  { key: 'roulette', label: 'Blog Roulette', icon: <Sparkles size={18} /> },
];

/**
 * Full user-dashboard layout: a dark sidebar holding the brand, the four
 * vertical navigation tabs, the reading streak, and the weekly activity widget;
 * and a main area that renders the active tab. On mobile the sidebar becomes a
 * slide-in drawer. Shared by the dashboard hub, blog roulette, and `/preview`.
 */
export default function DashboardShell({
  displayName,
  displayDomain,
  footer,
  user,
  profile,
  children,
}: {
  displayName: string;
  displayDomain: string;
  footer: ReactNode;
  user?: any;
  profile?: any;
  children?: ReactNode;
}) {
  const mockUser = {
    id: 'b632b1ab-71e5-48ca-ab5d-b431c4e65004',
    email: 'priyadhanani125@gmail.com',
  };
  const mockProfile = {
    primary_tech_stack: ['Next.js', 'React', 'TypeScript'],
  };
  const activeUser = user || mockUser;
  const activeProfile = profile || mockProfile;
  const [previewTab, setPreviewTab] = useState<TabKey>('daily');
  const [stats, setStats] = useState<WeeklyStats | null>(null);
  const [streak, setStreak] = useState(0);
  const [pastDate, setPastDate] = useState<ISODate | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isPreview = Boolean(pathname?.startsWith('/preview'));
  const active: TabKey = isPreview
    ? previewTab
    : tabFromLocation(pathname, searchParams.get('tab'));

  // Refresh stats + streak on tab change so the sidebar reflects reading time /
  // quiz results logged while on the Daily tab.
  useEffect(() => {
    void getActivity().then((data) => {
      setStats(computeWeeklyStats(data));
      setStreak(computeStreak(data));
    });
  }, [active]);

  // Restore a past-blog date from the query string after a cross-page jump.
  const dateFromQuery = searchParams.get('date') as ISODate;
  if (dateFromQuery && dateFromQuery !== pastDate) {
    setPastDate(dateFromQuery);
  }

  const onSearchPick = (date: ISODate) => {
    setPastDate(date);
    setMobileOpen(false);
    if (isPreview) {
      setPreviewTab('past');
      return;
    }
    router.push(`/dashboard?tab=past&date=${encodeURIComponent(date)}`);
  };

  const onContentScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const max = el.scrollHeight - el.clientHeight;
    setProgress(max > 0 ? (el.scrollTop / max) * 100 : 0);
  };

  return (
    <div className="h-screen overflow-hidden bg-[#f8f9fa] flex">
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      {/* Sidebar — static on desktop, slide-in drawer on mobile. Fixed full
          height so its footer (sign out / preview badge) is always visible. */}
      <aside
        className={`w-72 h-screen bg-[#0a0a0a] text-white flex flex-col p-7 border-r border-zinc-800 overflow-hidden shrink-0 z-40 transition-transform fixed inset-y-0 left-0 md:relative md:inset-auto md:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="absolute top-0 left-0 w-full h-32 bg-brand/5 blur-[60px] pointer-events-none" />

        <div className="flex items-center justify-between mb-10 relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-brand rounded-lg flex items-center justify-center shadow-brand">
              <span className="text-black font-black text-xl">C</span>
            </div>
            <div>
              <span className="font-bold text-lg block leading-none">Creole</span>
              <span className="text-[10px] text-brand uppercase tracking-widest font-bold">
                Portal
              </span>
            </div>
          </div>
          <button
            type="button"
            id="sidebar-close"
            onClick={() => setMobileOpen(false)}
            className="md:hidden text-zinc-400 hover:text-white cursor-pointer"
            aria-label="Close menu"
          >
            <X size={22} />
          </button>
        </div>

        {/* Vertical tab navigation */}
        <nav aria-label="Dashboard sections" className="space-y-1.5 relative z-10">
          {TABS.map((tab) => {
            const isActive = active === tab.key;
            return (
              <Link
                href={TAB_HREFS[tab.key]}
                key={tab.key}
                id={`dashboard-tab-${tab.key}`}
                aria-current={isActive ? 'page' : undefined}
                onClick={(e) => {
                  setMobileOpen(false);
                  if (isPreview && tab.key !== 'roulette') {
                    e.preventDefault();
                    setPreviewTab(tab.key);
                  }
                }}
                className="relative w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-colors text-left cursor-pointer"
              >
                {isActive && (
                  <motion.span
                    layoutId="sidebar-active-tab"
                    className="absolute inset-0 bg-zinc-900/60 border border-brand/20 rounded-xl shadow-sm"
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  />
                )}
                <span
                  className={`relative z-10 flex items-center gap-3 ${
                    isActive ? 'text-brand' : 'text-zinc-500'
                  }`}
                >
                  {tab.icon}
                  <span className="font-semibold text-sm">{tab.label}</span>
                </span>
              </Link>
            );
          })}
        </nav>

        {/* Reading streak */}
        <div className="mt-6 relative z-10 flex items-center gap-3 px-4 py-3 rounded-xl bg-zinc-900/40 border border-zinc-800">
          <Flame size={18} className="text-brand shrink-0" />
          <div>
            <p className="text-sm font-black text-white leading-none tabular-nums">
              {streak} day{streak === 1 ? '' : 's'}
            </p>
            <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mt-0.5">
              Reading streak
            </p>
          </div>
        </div>

        {/* Activity tracker widget, below the third tab */}
        <div className="mt-4 relative z-10">
          <SidebarActivityWidget stats={stats} />
        </div>

        {/* Footer (logout / preview badge) */}
        <div className="mt-auto pt-6 border-t border-zinc-800 relative z-10">{footer}</div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden min-h-0">
        <header className="h-20 bg-white border-b border-zinc-200 px-5 md:px-10 flex items-center justify-between gap-3 relative z-20">
          <button
            type="button"
            id="sidebar-open"
            onClick={() => setMobileOpen(true)}
            className="md:hidden text-zinc-600 hover:text-zinc-900 cursor-pointer shrink-0"
            aria-label="Open menu"
          >
            <Menu size={24} />
          </button>

          <div className="flex items-center gap-4 flex-1">
            <GlobalSearch onPick={onSearchPick} />
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-4">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-bold text-zinc-900 leading-tight capitalize">
                  {displayName}
                </p>
                <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">
                  {displayDomain}
                </p>
              </div>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center border bg-zinc-50 border-zinc-200 text-zinc-600">
                <User size={20} />
              </div>
            </div>
          </div>

          {/* Reading progress bar */}
          <div className="absolute bottom-0 left-0 h-0.5 w-full bg-transparent">
            <div
              className="h-full bg-brand transition-[width] duration-150"
              style={{ width: `${progress}%` }}
            />
          </div>
        </header>

        <div className="p-5 md:p-10 flex-1 overflow-y-auto min-h-0" onScroll={onContentScroll}>
          <div className="max-w-6xl mx-auto">
            {active !== 'roulette' && (
              <div className="mb-10">
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-brand/10 border border-brand/20 rounded-full text-brand text-[10px] font-bold uppercase tracking-widest mb-4">
                  <div className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
                  AI Factory Digest
                </div>
                <h1
                  id="dashboard-welcome"
                  className="text-2xl sm:text-3xl md:text-4xl font-black text-zinc-900 tracking-tight mb-3"
                >
                  Your Learning Hub
                </h1>
                <p className="text-zinc-500 text-sm sm:text-base">
                  Welcome back! Your personalized morning blog, past reading history, and progress —
                  all in one place.
                </p>
              </div>
            )}

            {active === 'daily' && <DailyBlogTab user={activeUser} profile={activeProfile} />}
            {active === 'past' && <PastBlogsTab selected={pastDate} onSelect={setPastDate} />}
            {active === 'activity' && <ActivityTab user={activeUser} />}
            {active === 'roulette' && children}
          </div>
        </div>
      </main>
    </div>
  );
}
