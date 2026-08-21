'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  Settings,
  Bell,
  Home,
  ShieldCheck,
  Loader2,
  Trophy,
  CheckCircle2,
  Clock,
  Target,
  ArrowRight,
} from 'lucide-react';
import LogoutButton from '@/components/logout-button';
import DashboardHeaderBar from '@/components/dashboard/DashboardHeaderBar';

export default function PersonalLeaderboardPage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

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

      try {
        const res = await fetch('/api/quizzes/history');
        const data = await res.json();
        if (data.success) {
          setHistory(data.history);
        } else {
          setError(data.error);
        }
      } catch (err) {
        setError('Failed to load quiz history.');
      } finally {
        setLoading(false);
      }
    }
    getInitialData();
  }, [supabase, router]);

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-[#f8f9fa] flex flex-col items-center justify-center space-y-4">
        <Loader2 className="w-8 h-8 text-brand animate-spin" />
        <p className="text-zinc-500 font-medium">Loading your quiz history...</p>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-[#f8f9fa] flex">
      {/* Sidebar */}
      <aside className="w-72 bg-[#0a0a0a] text-white flex flex-col p-8 hidden md:flex border-r border-zinc-800 relative overflow-hidden shrink-0">
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
          <button
            onClick={() => router.push('/dashboard')}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-zinc-500 hover:text-white hover:bg-zinc-900 rounded-xl transition-all group cursor-pointer text-left"
          >
            <Home size={20} className="group-hover:scale-110 transition-transform" />
            <span className="font-medium text-sm">Morning Brief</span>
          </button>
          <button
            onClick={() => router.push('/dashboard/gatekeeper')}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-zinc-500 hover:text-white hover:bg-zinc-900 rounded-xl transition-all group cursor-pointer text-left"
          >
            <ShieldCheck size={20} className="group-hover:scale-110 transition-transform" />
            <span className="font-semibold text-sm">Blog Submissions</span>
          </button>
          <button
            onClick={() => router.push('/dashboard/quizzes')}
            className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all group bg-zinc-900/50 text-brand border border-brand/20 shadow-sm text-left"
          >
            <Trophy size={20} className="group-hover:scale-110 transition-transform" />
            <span className="font-semibold text-sm">My Quizzes</span>
          </button>
          
          <div className="h-4" />
          
          <button className="w-full flex items-center gap-3 px-4 py-3.5 text-zinc-500 hover:text-white hover:bg-zinc-900 rounded-xl transition-all group text-left">
            <Bell size={20} className="group-hover:rotate-12 transition-transform" />
            <span className="font-medium text-sm">Notifications</span>
          </button>
          <button className="w-full flex items-center gap-3 px-4 py-3.5 text-zinc-500 hover:text-white hover:bg-zinc-900 rounded-xl transition-all group text-left">
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
        <DashboardHeaderBar
          icon={<Trophy className="text-brand" />}
          title="Personal Leaderboard"
          user={user}
        />

        {/* Content Area */}
        <div className="p-10 flex-1 overflow-y-auto">
          <div className="max-w-5xl mx-auto">
            <div className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
              <div>
                <h2 className="text-3xl font-black text-zinc-900 tracking-tight mb-2">
                  My Quiz History
                </h2>
                <p className="text-zinc-500 text-base">
                  Track your learning progress, review past scores, and access your personal analytics across all Morning Briefing quizzes.
                </p>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <div className="bg-white px-5 py-3 rounded-2xl border border-zinc-200 shadow-sm flex items-center gap-3">
                  <div className="p-2 bg-brand/10 text-brand rounded-lg">
                    <Target size={18} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Total Taken</p>
                    <p className="text-xl font-black text-zinc-900">{history.length}</p>
                  </div>
                </div>
              </div>
            </div>

            {error && (
              <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-xl text-sm font-medium border border-red-100">
                {error}
              </div>
            )}

            {history.length === 0 ? (
              <div className="bg-white rounded-3xl p-16 text-center border border-zinc-200 shadow-sm">
                <div className="w-20 h-20 bg-zinc-50 text-zinc-300 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Trophy size={32} />
                </div>
                <h3 className="text-xl font-black text-zinc-900 mb-2">No Quizzes Taken Yet</h3>
                <p className="text-zinc-500 mb-8 max-w-sm mx-auto text-sm">
                  Generate your Morning Briefing and complete your first daily technical quiz to start building your streak!
                </p>
                <button 
                  onClick={() => router.push('/dashboard')}
                  className="px-6 py-3 bg-brand text-black font-bold uppercase tracking-wider text-xs rounded-xl shadow-brand hover:bg-brand/90 transition-colors"
                >
                  Go to Morning Brief
                </button>
              </div>
            ) : (
              <div className="grid gap-4">
                {history.map((quiz) => (
                  <div key={quiz.id} className="bg-white p-6 rounded-2xl border border-zinc-200 shadow-sm hover:shadow-md transition-shadow flex flex-col md:flex-row md:items-center justify-between gap-6 group">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                          {(() => {
                            const rawDate = quiz.completed_at || quiz.started_at;
                            if (!rawDate) return 'Recently';
                            const d = new Date(rawDate);
                            return Number.isNaN(d.getTime()) ? 'Recently' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
                          })()}
                        </span>
                        {quiz.status === 'completed' ? (
                          <span className="px-2 py-0.5 bg-emerald-50 text-emerald-600 border border-emerald-200 text-[10px] font-bold uppercase tracking-wider rounded-md flex items-center gap-1">
                            <CheckCircle2 size={10} /> Completed
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-amber-50 text-amber-600 border border-amber-200 text-[10px] font-bold uppercase tracking-wider rounded-md flex items-center gap-1">
                            <Clock size={10} /> In Progress
                          </span>
                        )}
                      </div>
                      <h3 className="text-lg font-bold text-zinc-900 line-clamp-1">{quiz.blog_title}</h3>
                    </div>

                    {quiz.status === 'completed' ? (
                      <div className="flex items-center gap-8 shrink-0 bg-zinc-50/50 p-4 rounded-xl border border-zinc-100">
                        <div>
                          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Score</p>
                          <p className="text-xl font-black text-brand">{quiz.score}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Accuracy</p>
                          <p className="text-xl font-black text-zinc-900">{quiz.percentage}%</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Time</p>
                          <p className="text-xl font-black text-zinc-900">
                            {Math.floor((quiz.time_taken_seconds || 0) / 60)}:{((quiz.time_taken_seconds || 0) % 60).toString().padStart(2, '0')}
                          </p>
                        </div>
                        <button 
                          onClick={() => router.push(`/dashboard/quiz/${quiz.blog_id}`)}
                          className="w-10 h-10 rounded-full bg-zinc-900 text-white flex items-center justify-center hover:bg-black transition-colors shrink-0"
                        >
                          <ArrowRight size={16} />
                        </button>
                      </div>
                    ) : (
                      <div className="shrink-0">
                        <button 
                          onClick={() => router.push(`/dashboard/quiz/${quiz.blog_id}`)}
                          className="px-6 py-3 bg-zinc-900 text-white font-bold rounded-xl text-sm hover:bg-black transition-colors shadow-sm"
                        >
                          Resume Quiz
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
