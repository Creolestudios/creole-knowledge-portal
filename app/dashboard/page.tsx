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
  Loader2,
  Sparkles,
  RefreshCw,
  BookOpen,
  CheckCircle,
  ExternalLink,
  Clock,
  Code,
  Calendar,
  History,
  Activity
} from 'lucide-react';
import LogoutButton from '@/components/logout-button';
import { motion, AnimatePresence } from 'motion/react';
import DailyBlogTab from '@/components/dashboard/DailyBlogTab';
import PastBlogsTab from '@/components/dashboard/PastBlogsTab';
import ActivityTab from '@/components/dashboard/ActivityTab';
import { MOCK_USER, isMockUserAllowed } from '@/lib/dev/mock-user';

interface MarkdownBlock {
  type: 'code' | 'h1' | 'h2' | 'h3' | 'li' | 'blockquote' | 'empty' | 'p';
  content: string;
}

// A high-fidelity, zero-dependency Markdown renderer
function PremiumMarkdownRenderer({ content }: { content: string }) {
  const lines = content.split('\n');
  const blocks: MarkdownBlock[] = [];
  let inCodeBlock = false;
  let codeLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        inCodeBlock = false;
        blocks.push({ type: 'code', content: codeLines.join('\n') });
        codeLines = [];
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    if (trimmed.startsWith('# ')) {
      blocks.push({ type: 'h1', content: trimmed.substring(2) });
    } else if (trimmed.startsWith('## ')) {
      blocks.push({ type: 'h2', content: trimmed.substring(3) });
    } else if (trimmed.startsWith('### ')) {
      blocks.push({ type: 'h3', content: trimmed.substring(4) });
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      blocks.push({ type: 'li', content: trimmed.substring(2) });
    } else if (trimmed.startsWith('> ')) {
      blocks.push({ type: 'blockquote', content: trimmed.substring(2) });
    } else if (trimmed === '') {
      blocks.push({ type: 'empty', content: '' });
    } else {
      blocks.push({ type: 'p', content: line });
    }
  }

  if (inCodeBlock && codeLines.length > 0) {
    blocks.push({ type: 'code', content: codeLines.join('\n') });
  }

  return (
    <div className="space-y-6 text-zinc-700 leading-relaxed font-sans">
      {blocks.map((block, idx) => {
        switch (block.type) {
          case 'code':
            return (
              <div key={idx} className="relative group rounded-2xl overflow-hidden border border-zinc-800 bg-[#0f0f11] my-6 font-mono text-xs shadow-lg">
                <div className="flex items-center justify-between px-6 py-3 bg-[#16161a] border-b border-zinc-800 text-zinc-400">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-brand">Code Snippet</span>
                  <button
                    onClick={() => navigator.clipboard.writeText(block.content)}
                    className="hover:text-white transition-colors text-[10px] font-bold uppercase tracking-widest cursor-pointer"
                  >
                    Copy
                  </button>
                </div>
                <pre className="p-6 overflow-x-auto text-zinc-300">
                  <code>{block.content}</code>
                </pre>
              </div>
            );
          case 'h1':
            return (
              <h1 key={idx} className="text-3xl font-black text-zinc-900 mt-10 mb-4 tracking-tight leading-tight">
                {block.content}
              </h1>
            );
          case 'h2':
            return (
              <h2 key={idx} className="text-2xl font-black text-zinc-900 mt-8 mb-4 border-b pb-3 border-zinc-100 tracking-tight leading-tight flex items-center gap-2">
                <span className="w-1.5 h-6 bg-brand rounded-full inline-block" />
                {block.content}
              </h2>
            );
          case 'h3':
            return (
              <h3 key={idx} className="text-lg font-extrabold text-zinc-900 mt-6 mb-3 tracking-tight">
                {block.content}
              </h3>
            );
          case 'li':
            return (
              <li key={idx} className="ml-6 list-disc text-sm py-1.5 font-medium text-zinc-600 pl-2">
                {parseInlineMarkdown(block.content)}
              </li>
            );
          case 'blockquote':
            return (
              <div key={idx} className="p-6 bg-brand/5 border-l-4 border-brand rounded-r-2xl my-6 text-zinc-700 italic text-sm shadow-sm">
                {parseInlineMarkdown(block.content)}
              </div>
            );
          case 'empty':
            return <div key={idx} className="h-2" />;
          case 'p':
            return (
              <p key={idx} className="text-zinc-600 text-[15px] leading-relaxed">
                {parseInlineMarkdown(block.content)}
              </p>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

// Inline Markdown Parser for bold strings (**text**)
function parseInlineMarkdown(text: string) {
  const boldRegex = /\*\*([^*]+)\*\*/g;
  let match;
  const parts = [];
  let lastIdx = 0;

  while ((match = boldRegex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.substring(lastIdx, match.index));
    }
    parts.push(
      <strong key={match.index} className="font-extrabold text-zinc-900">
        {match[1]}
      </strong>
    );
    lastIdx = boldRegex.lastIndex;
  }

  if (lastIdx < text.length) {
    parts.push(text.substring(lastIdx));
  }

  return parts.length > 0 ? parts : text;
}

function DashboardCalendar() {
  const [currentDate, setCurrentDate] = useState(new Date());

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  // Helper: days of current month
  const firstDayIndex = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();

  // Create list of days (padding + days)
  const daysArray: (number | null)[] = [];
  // padding days
  for (let i = 0; i < firstDayIndex; i++) {
    daysArray.push(null);
  }
  // current month days
  for (let i = 1; i <= totalDays; i++) {
    daysArray.push(i);
  }

  // Status logic: all past days = unattempted, today & future = future (inactive)
  // When real quiz API data is available, this function will be replaced
  // to fetch and check each day's quiz result from the database.
  const getDayStatus = (dayNum: number | null): string => {
    if (!dayNum) return 'empty';

    const today = new Date();
    const todayZero = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const cellDateZero = new Date(year, month, dayNum);

    if (cellDateZero >= todayZero) {
      return 'future'; // Today and future days are inactive/grayed out
    }

    // All days before today: unattempted (red)
    return 'unattempted';
  };

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  return (
    <div className="bg-white rounded-[32px] p-6 border border-zinc-100 shadow-card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-black text-zinc-900 flex items-center gap-2">
          <Calendar size={16} className="text-brand" />
          Quiz Activity
        </h3>
        <div className="flex items-center gap-1">
          <button 
            onClick={handlePrevMonth}
            className="p-1 hover:bg-zinc-50 border rounded text-zinc-600 transition-colors cursor-pointer text-[10px] font-bold"
          >
            &lt;
          </button>
          <span className="text-[10px] font-bold text-zinc-700 min-w-[70px] text-center">
            {monthNames[month]} {year}
          </span>
          <button 
            onClick={handleNextMonth}
            className="p-1 hover:bg-zinc-50 border rounded text-zinc-600 transition-colors cursor-pointer text-[10px] font-bold"
          >
            &gt;
          </button>
        </div>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-1 text-center text-[9px] font-extrabold text-zinc-400 uppercase tracking-wider mb-2">
        <span>S</span>
        <span>M</span>
        <span>T</span>
        <span>W</span>
        <span>T</span>
        <span>F</span>
        <span>S</span>
      </div>

      {/* Days grid */}
      <div className="grid grid-cols-7 gap-1">
        {daysArray.map((day, idx) => {
          const status = getDayStatus(day);
          
          let bgClass = "bg-transparent text-transparent pointer-events-none";
          let tooltip = "";
          
          if (day !== null) {
            const isToday = new Date().toDateString() === new Date(year, month, day).toDateString();
            if (status === 'unattempted') {
              bgClass = "bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100";
              tooltip = `Day ${day}: Not Attempted`;
            } else if (status === 'passed') {
              bgClass = "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100";
              tooltip = `Day ${day}: Quiz Passed`;
            } else if (status === 'failed') {
              bgClass = "bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100";
              tooltip = `Day ${day}: Attempted, Not Passed`;
            } else {
              // future or unknown
              bgClass = "bg-zinc-50 text-zinc-400 border border-zinc-100";
              tooltip = `Day ${day}`;
            }
            if (isToday) {
              bgClass += " ring-2 ring-brand ring-offset-1 font-black";
            }
          }

          return (
            <div
              key={idx}
              title={tooltip}
              className={`aspect-square flex items-center justify-center text-[10px] font-semibold rounded transition-all duration-150 cursor-help ${bgClass}`}
            >
              {day}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-3 pt-3 border-t border-zinc-100 flex justify-between items-center text-[8px] font-bold text-zinc-500">
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded bg-emerald-500 border border-emerald-600 block shrink-0" />
          <span>Passed</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded bg-amber-500 border border-amber-600 block shrink-0" />
          <span>Attempted</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded bg-rose-500 border border-rose-600 block shrink-0" />
          <span>No Attempt</span>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'daily' | 'past' | 'activity'>('daily');

  // Brief states
  const [brief, setBrief] = useState<any>(null);
  const [loadingBrief, setLoadingBrief] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generationStep, setGenerationStep] = useState('');

  const supabase = createClient();
  const router = useRouter();

  const fetchLatestBrief = async () => {
    setLoadingBrief(true);
    try {
      const res = await fetch('/api/digests/latest');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.blog) {
          setBrief(data.blog);
        }
      }
    } catch (e) {
      console.error('Error fetching brief:', e);
    } finally {
      setLoadingBrief(false);
    }
  };

  useEffect(() => {
    async function getInitialData() {
      // Check query param or cookie
      const params = new URLSearchParams(window.location.search);
      const isMock =
        isMockUserAllowed() &&
        (params.has('mockUser') || document.cookie.includes('mock-user=true'));

      let currentUser = null;
      if (isMock) {
        currentUser = MOCK_USER;
        setUser(currentUser);
        // Set mock-user cookie in document
        document.cookie = "mock-user=true; path=/; max-age=3600";
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          router.push('/');
          return;
        }
        currentUser = user;
        setUser(user);
      }

      // Get detailed user profile
      const { data: userProfile } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', currentUser.id)
        .single();

      setProfile(userProfile);
      setLoading(false);

      // Get latest daily briefing if available
      await fetchLatestBrief();
    }
    getInitialData();
  }, [supabase, router]);

  const handleGenerateBriefing = async () => {
    if (!user) return;
    setGenerating(true);
    setBrief(null);

    // Custom simulated steps to give extremely premium, immersive feel
    const steps = [
      'Accessing Administrative registered urls...',
      'Crawling developer feeds from Hacker News and Dev.to...',
      'Mapping tech stack: ' + ((profile?.primary_tech_stack || []).join(', ') || 'WordPress') + '...',
      'Evaluating interest matches...',
      'Calling Gemini 2.5 Flash for deep synthesis...',
      'Structuring morning technical brief...',
      'Saving article briefing to Creole database...'
    ];

    let currentStep = 0;
    setGenerationStep(steps[currentStep]);

    const stepInterval = setInterval(() => {
      if (currentStep < steps.length - 2) {
        currentStep++;
        setGenerationStep(steps[currentStep]);
      }
    }, 3500);

    try {
      const res = await fetch('/api/digests/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      });

      clearInterval(stepInterval);

      if (res.ok) {
        setGenerationStep('Finalizing your Morning Brief...');
        const data = await res.json();
        if (data.success && data.blog) {
          setBrief(data.blog);
        } else {
          alert('Generation completed but briefing was not retrieved.');
        }
      } else {
        const errorData = await res.json();
        alert(`Synthesis failed: ${errorData.error || 'Unknown error'}`);
      }
    } catch (e: any) {
      clearInterval(stepInterval);
      alert(`Network error: ${e.message || e}`);
    } finally {
      setGenerating(false);
    }
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center space-y-4">
        <Loader2 className="w-8 h-8 text-brand animate-spin" />
        <p className="text-zinc-500 font-medium">Loading your portal...</p>
      </div>
    );
  }

  // Parse brief details
  const hasBrief = !!brief;

  return (
    <div className="min-h-screen bg-[#f8f9fa] flex">
      {/* Sidebar */}
      <aside className="w-72 bg-[#0a0a0a] text-white flex flex-col p-8 hidden md:flex border-r border-zinc-800 relative overflow-hidden shrink-0 h-screen sticky top-0">
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
            onClick={() => setActiveTab('daily')}
            className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all group ${activeTab === 'daily' ? 'bg-zinc-900/50 text-brand border border-brand/20 shadow-sm' : 'text-zinc-500 hover:text-white hover:bg-zinc-900 border border-transparent'} text-left`}
          >
            <Home size={20} />
            <span className="font-semibold text-sm">Morning Brief</span>
          </button>
          
          <button
            onClick={() => setActiveTab('past')}
            className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all group ${activeTab === 'past' ? 'bg-zinc-900/50 text-brand border border-brand/20 shadow-sm' : 'text-zinc-500 hover:text-white hover:bg-zinc-900 border border-transparent'} text-left`}
          >
            <History size={20} />
            <span className="font-semibold text-sm">Past Briefings</span>
          </button>
          
          <button
            onClick={() => setActiveTab('activity')}
            className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all group ${activeTab === 'activity' ? 'bg-zinc-900/50 text-brand border border-brand/20 shadow-sm' : 'text-zinc-500 hover:text-white hover:bg-zinc-900 border border-transparent'} text-left`}
          >
            <Activity size={20} />
            <span className="font-semibold text-sm">Activity Tracker</span>
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

          {profile?.role === 'admin' && (
            <>
              <div className="h-4" />
              <button
                onClick={() => router.push('/admin/dashboard')}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-purple-400 hover:text-white hover:bg-purple-950/35 rounded-xl transition-all group text-left border border-purple-900/20"
              >
                <LayoutDashboard size={20} />
                <span className="font-semibold text-sm">Admin Console</span>
              </button>
            </>
          )}
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
            {profile?.role === 'admin' && (
              <button
                onClick={() => router.push('/admin/dashboard')}
                className="flex items-center gap-1.5 px-4 py-2 bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 rounded-xl text-xs font-bold transition-all shadow-sm"
              >
                <LayoutDashboard size={14} />
                <span>Admin Console</span>
              </button>
            )}
            <div className="flex items-center gap-4">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-bold text-zinc-900 leading-tight capitalize">{profile?.name || user.email?.split('@')[0]}</p>
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
            {/* Tabs View */}
            {activeTab === 'daily' && <DailyBlogTab user={user} profile={profile} />}
            {activeTab === 'past' && <PastBlogsTab />}
            {activeTab === 'activity' && <ActivityTab user={user} />}

          </div>
        </div>
      </main>
    </div>
  );
}
