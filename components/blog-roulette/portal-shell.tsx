'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  Bell,
  Settings,
  PenSquare,
  Search,
  User,
} from 'lucide-react';
import LogoutButton from '@/components/logout-button';

interface PortalShellProps {
  children: React.ReactNode;
  userName?: string;
  userEmail?: string;
}

export default function PortalShell({
  children,
  userName,
  userEmail,
}: PortalShellProps) {
  const pathname = usePathname();
  const isBlogRoulette = pathname?.startsWith('/blog-roulette');

  return (
    <div className="min-h-screen bg-[#f8f9fa] dark:bg-zinc-950 flex">
      <aside className="w-72 bg-white dark:bg-[#0a0a0a] text-zinc-900 dark:text-white flex-col p-8 hidden md:flex border-r border-zinc-200 dark:border-zinc-800 relative overflow-hidden shrink-0 sticky top-0 h-screen">
        <div className="absolute top-0 left-0 w-full h-32 bg-brand/5 blur-[60px] pointer-events-none" />

        <div className="flex items-center gap-3 mb-12 relative z-10">
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

        <nav className="flex-1 space-y-1 relative z-10">
          <Link
            href="/dashboard"
            className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all group text-left ${
              !isBlogRoulette
                ? 'bg-zinc-100 dark:bg-zinc-900/50 text-brand border border-brand/20 shadow-sm'
                : 'text-zinc-500 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-900'
            }`}
          >
            <Home size={20} />
            <span className="font-semibold text-sm">Morning Brief</span>
          </Link>

          <Link
            href="/blog-roulette"
            className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all group text-left ${
              isBlogRoulette
                ? 'bg-zinc-100 dark:bg-zinc-900/50 text-brand border border-brand/20 shadow-sm'
                : 'text-zinc-500 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-900'
            }`}
          >
            <PenSquare size={20} />
            <span className="font-semibold text-sm">Blog Roulette</span>
          </Link>

          <div className="h-4" />

          <button className="w-full flex items-center gap-3 px-4 py-3.5 text-zinc-500 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-xl transition-all group text-left">
            <Bell size={20} className="group-hover:rotate-12 transition-transform" />
            <span className="font-medium text-sm">Notifications</span>
          </button>
          <button className="w-full flex items-center gap-3 px-4 py-3.5 text-zinc-500 dark:text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-900 rounded-xl transition-all group text-left">
            <Settings size={20} className="group-hover:rotate-90 transition-transform" />
            <span className="font-medium text-sm">Settings</span>
          </button>
        </nav>

        <div className="pt-8 border-t border-zinc-200 dark:border-zinc-800 relative z-10">
          <LogoutButton variant="sidebar" />
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="h-20 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-10 flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center gap-4 flex-1">
            <div className="relative w-full max-w-md">
              <Search
                className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400"
                size={16}
              />
              <input
                type="text"
                placeholder="Search portal resources..."
                className="w-full pl-12 pr-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand text-sm transition-all"
              />
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-4">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-bold text-zinc-900 leading-tight capitalize">
                  {userName ?? userEmail?.split('@')[0] ?? 'Author'}
                </p>
                <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">
                  {userEmail?.split('@')[1] ?? 'creole'}
                </p>
              </div>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center border bg-zinc-50 border-zinc-200 text-zinc-600">
                <User size={20} />
              </div>
            </div>
          </div>
        </header>

        <div className="p-10 flex-1 overflow-y-auto">{children}</div>
      </main>
    </div>
  );
}
