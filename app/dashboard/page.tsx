'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { 
  LogOut, 
  User, 
  LayoutDashboard, 
  Settings, 
  Bell, 
  Search,
  Home,
  UserCircle,
  Loader2
} from 'lucide-react';
import LogoutButton from '@/components/logout-button';
import { motion, AnimatePresence } from 'motion/react';

export default function DashboardPage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    async function getInitialData() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/');
        return;
      }
      setUser(user);
      setLoading(false);
    }
    getInitialData();
  }, [supabase, router]);

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center space-y-4">
        <Loader2 className="w-8 h-8 text-brand animate-spin" />
        <p className="text-zinc-500 font-medium">Loading your portal...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa] flex">
      {/* Sidebar */}
      <aside className="w-72 bg-[#0a0a0a] text-white flex flex-col p-8 hidden md:flex border-r border-zinc-800 relative overflow-hidden">
        {/* Subtle background glow for sidebar */}
        <div className="absolute top-0 left-0 w-full h-32 bg-brand/5 blur-[60px] pointer-events-none" />
        
        <div className="flex items-center gap-3 mb-12 relative z-10">
          <div className="w-10 h-10 bg-brand rounded-lg flex items-center justify-center shadow-brand">
            <span className="text-black font-black text-xl">C</span>
          </div>
          <div>
            <span className="font-bold text-lg block leading-none">Creole</span>
            <span className="text-[10px] text-brand uppercase tracking-widest font-bold">Portal</span>
          </div>
        </div>

        <nav className="flex-1 space-y-1 relative z-10">
          <button 
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all group bg-zinc-900/50 text-brand border border-brand/20 shadow-sm"
          >
            <Home size={20} />
            <span className="font-semibold text-sm">Morning Brief</span>
          </button>

          <div className="h-4" /> {/* Spacer */}

          <button className="w-full flex items-center gap-3 px-4 py-3.5 text-zinc-500 hover:text-white hover:bg-zinc-900 rounded-xl transition-all group">
            <Bell size={20} className="group-hover:rotate-12 transition-transform" />
            <span className="font-medium text-sm">Notifications</span>
          </button>
          <button className="w-full flex items-center gap-3 px-4 py-3.5 text-zinc-500 hover:text-white hover:bg-zinc-900 rounded-xl transition-all group">
            <Settings size={20} className="group-hover:rotate-90 transition-transform" />
            <span className="font-medium text-sm">Settings</span>
          </button>
        </nav>

        <div className="pt-8 border-t border-zinc-800 relative z-10">
          <LogoutButton variant="sidebar" />
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-20 bg-white border-b border-zinc-200 px-10 flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center gap-4 flex-1">
            <div className="relative w-full max-w-md">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
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
                <p className="text-sm font-bold text-zinc-900 leading-tight capitalize">{user.email?.split('@')[0]}</p>
                <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">{user.email?.split('@')[1]}</p>
              </div>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center border bg-zinc-50 border-zinc-200 text-zinc-600">
                <User size={20} />
              </div>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="p-10 flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto">
            <div className="mb-12">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-brand/10 border border-brand/20 rounded-full text-brand text-[10px] font-bold uppercase tracking-widest mb-4">
                <div className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
                Live Network Feed
              </div>
              <h1 id="dashboard-welcome" className="text-4xl font-black text-zinc-900 tracking-tight mb-3">Your Morning Briefing</h1>
              <p className="text-zinc-500 text-lg">Welcome back! Here&apos;s what&apos;s trending in your knowledge network today.</p>
            </div>

            {/* Recommendations Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-white border border-zinc-100 rounded-[32px] p-8 shadow-card hover:shadow-[0_20px_50px_rgba(0,0,0,0.08)] transition-all group cursor-pointer border-b-4 border-b-transparent hover:border-b-brand">
                  <div className="w-14 h-14 bg-zinc-50 rounded-2xl mb-8 flex items-center justify-center text-zinc-400 group-hover:bg-brand/10 group-hover:text-brand transition-colors">
                    <LayoutDashboard size={28} />
                  </div>
                  <h3 className="text-2xl font-extrabold text-zinc-900 mb-3 group-hover:text-brand transition-colors">Recommendation {i}</h3>
                  <p className="text-zinc-500 mb-8 leading-relaxed text-sm">
                    High-impact industry research and internal blog highlights analyzed for your specific role within the team.
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">4 min read</span>
                    <div className="h-1 flex-1 mx-4 bg-zinc-100 rounded-full overflow-hidden">
                      <div className="h-full bg-brand w-1/4 group-hover:w-full transition-all duration-1000" />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* CTA Banner */}
            <div className="mt-16 p-10 bg-[#0a0a0a] rounded-[48px] text-white flex flex-col lg:flex-row items-center justify-between gap-10 border border-zinc-800 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-brand/10 blur-[100px] pointer-events-none" />
              <div className="relative z-10 text-center lg:text-left">
                <h2 className="text-3xl font-black mb-3">Ready for the deep dive?</h2>
                <p className="text-zinc-400 text-lg max-w-md italic tracking-wide">
                  &quot;Knowledge is the most powerful resource when shared within a team.&quot;
                </p>
              </div>
              <button className="px-10 py-5 bg-brand text-black font-black rounded-2xl shadow-brand hover:bg-brand-hover hover:scale-105 transition-all text-sm uppercase tracking-widest relative z-10 shrink-0">
                Open Full Daily Briefing
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

