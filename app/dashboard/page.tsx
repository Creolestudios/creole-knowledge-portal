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
  ArrowLeft
} from 'lucide-react';
import LogoutButton from '@/components/logout-button';
import { motion, AnimatePresence } from 'motion/react';

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

export default function DashboardPage() {
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Brief states
  const [brief, setBrief] = useState<any>(null);
  const [meta, setMeta] = useState<any>(null);
  const [seriesCompleted, setSeriesCompleted] = useState(false);
  const [loadingBrief, setLoadingBrief] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [generationStep, setGenerationStep] = useState('');

  // Trending states
  const [trendingBlogs, setTrendingBlogs] = useState<any[]>([]);
  const [loadingTrending, setLoadingTrending] = useState(false);
  const [activeTrendingBlog, setActiveTrendingBlog] = useState<any>(null);

  const supabase = createClient();
  const router = useRouter();

  const fetchLatestBrief = async () => {
    setLoadingBrief(true);
    try {
      const res = await fetch('/api/digests/latest');
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          if (data.blog) {
            setBrief(data.blog);
            setMeta(data.meta || null);
            setSeriesCompleted(false);
          } else if (data.seriesCompleted) {
            setBrief(null);
            setMeta(null);
            setSeriesCompleted(true);
          } else {
            setBrief(null);
            setMeta(null);
            setSeriesCompleted(false);
          }
        }
      }
    } catch (e) {
      console.error('Error fetching brief:', e);
    } finally {
      setLoadingBrief(false);
    }
  };

  const fetchTrendingBlogs = async () => {
    setLoadingTrending(true);
    try {
      const res = await fetch('/api/digests/trending');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.blogs) {
          setTrendingBlogs(data.blogs);
        }
      }
    } catch (e) {
      console.error('Error fetching trending:', e);
    } finally {
      setLoadingTrending(false);
    }
  };

  useEffect(() => {
    async function getInitialData() {
      // Check query param or cookie
      const params = new URLSearchParams(window.location.search);
      const isMock = params.has('mockUser') || document.cookie.includes('mock-user=true');

      let currentUser = null;
      if (isMock) {
        currentUser = {
          id: 'b632b1ab-71e5-48ca-ab5d-b431c4e65004', // priyadhanani125@gmail.com user_id
          email: 'priyadhanani125@gmail.com'
        };
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

      // Fetch daily briefing and trending blogs
      await Promise.all([
        fetchLatestBrief(),
        fetchTrendingBlogs()
      ]);
    }
    getInitialData();
  }, [supabase, router]);

  const handleGenerateBriefing = async () => {
    if (!user) return;
    setGenerating(true);
    setBrief(null);
    setMeta(null);
    setSeriesCompleted(false);
    setActiveTrendingBlog(null);

    // Custom simulated steps to give extremely premium, immersive feel
    const steps = [
      'Accessing Administrative registered urls...',
      'Crawling developer feeds from Hacker News and Dev.to...',
      'Selecting the best matching article using LLM Reranking...',
      'Executing Chromium-based page scrape...',
      'Running LLM cleanup & extraction...',
      'Synthesizing full masterclass technical tutorial...',
      'Splitting content into 20-min daily segments...'
    ];

    let currentStep = 0;
    setGenerationStep(steps[currentStep]);

    const stepInterval = setInterval(() => {
      if (currentStep < steps.length - 1) {
        currentStep++;
        setGenerationStep(steps[currentStep]);
      }
    }, 4000);

    try {
      const res = await fetch('/api/digests/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id })
      });

      clearInterval(stepInterval);

      if (res.ok) {
        setGenerationStep('Finalizing your Day 1 Course Segment...');
        const data = await res.json();
        if (data.success && data.blog) {
          setBrief(data.blog);
          setMeta(data.meta || null);
          setSeriesCompleted(false);
          // Re-fetch trending for new content ideas
          fetchTrendingBlogs();
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

  const handleCompleteDay = async () => {
    if (!brief || completing) return;
    setCompleting(true);
    try {
      const res = await fetch('/api/digests/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blogId: brief.id })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          await fetchLatestBrief();
        } else {
          alert('Failed to update progress.');
        }
      } else {
        alert('Error completing day.');
      }
    } catch (e) {
      console.error('Error completing day:', e);
    } finally {
      setCompleting(false);
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
      <aside className="w-72 bg-[#0a0a0a] text-white flex flex-col p-8 hidden md:flex border-r border-zinc-800 relative overflow-hidden shrink-0">
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
            onClick={() => setActiveTrendingBlog(null)}
            className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all group text-left border ${
              !activeTrendingBlog 
                ? 'bg-zinc-900/50 text-brand border-brand/20 shadow-sm'
                : 'text-zinc-500 hover:text-white hover:bg-zinc-900 border-transparent'
            }`}
          >
            <Home size={20} />
            <span className="font-semibold text-sm">Morning Brief</span>
          </button>

          <div className="h-4" />

          <button className="w-full flex items-center gap-3 px-4 py-3.5 text-zinc-500 hover:text-white hover:bg-zinc-900 rounded-xl transition-all group text-left border border-transparent">
            <Bell size={20} className="group-hover:rotate-12 transition-transform" />
            <span className="font-medium text-sm">Notifications</span>
          </button>
          <button className="w-full flex items-center gap-3 px-4 py-3.5 text-zinc-500 hover:text-white hover:bg-zinc-900 rounded-xl transition-all group text-left border border-transparent">
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
            {/* Top section */}
            <div className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-brand/10 border border-brand/20 rounded-full text-brand text-[10px] font-bold uppercase tracking-widest mb-4">
                  <div className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
                  AI Factory Digest
                </div>
                <h1 id="dashboard-welcome" className="text-4xl font-black text-zinc-900 tracking-tight mb-3">
                  {activeTrendingBlog ? 'Trending Tech Briefing' : 'Your Morning Briefing'}
                </h1>
                <p className="text-zinc-500 text-base">
                  {activeTrendingBlog 
                    ? `Currently reading a trending topic in your stack: ${activeTrendingBlog.title}`
                    : 'Welcome back! Customized tech news and knowledge updates tailored perfectly to your developer interests.'}
                </p>
              </div>

              {((hasBrief || seriesCompleted) && !generating && !activeTrendingBlog) && (
                <button
                  onClick={handleGenerateBriefing}
                  className="px-6 py-3 bg-white hover:bg-zinc-50 text-zinc-700 font-bold rounded-xl border border-zinc-200 shadow-sm transition-all flex items-center gap-2 text-sm cursor-pointer shrink-0"
                >
                  <RefreshCw size={15} />
                  Regenerate Briefing
                </button>
              )}
            </div>

            {/* Main view state switcher */}
            <AnimatePresence mode="wait">
              {loadingBrief ? (
                /* LOADING PREVIOUS BRIEFING */
                <motion.div
                  key="loading-brief"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="bg-white rounded-[32px] p-20 border border-zinc-100 shadow-card flex flex-col items-center justify-center text-center space-y-4"
                >
                  <Loader2 className="w-10 h-10 text-brand animate-spin" />
                  <p className="text-zinc-500 font-semibold text-lg">Retrieving your latest briefing...</p>
                </motion.div>
              ) : generating ? (
                /* ACTIVE AI SYNTHESIS PROCESS */
                <motion.div
                  key="generating-brief"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="p-12 bg-gradient-to-tr from-zinc-950 via-zinc-900 to-indigo-950 rounded-[48px] border border-zinc-800 text-white relative overflow-hidden shadow-2xl"
                >
                  <div className="absolute top-0 right-0 w-80 h-80 bg-brand/10 blur-[120px] pointer-events-none" />
                  <div className="absolute -bottom-20 -left-20 w-80 h-80 bg-indigo-500/10 blur-[120px] pointer-events-none" />

                  <div className="max-w-2xl mx-auto text-center space-y-8 relative z-10 py-10">
                    <div className="w-20 h-20 bg-brand/10 border border-brand/20 rounded-[28px] mx-auto flex items-center justify-center text-brand animate-bounce">
                      <Sparkles size={40} />
                    </div>

                    <div className="space-y-3">
                      <h2 className="text-3xl font-black tracking-tight">AI Factory is Synthesizing...</h2>
                      <p className="text-zinc-400 text-sm max-w-md mx-auto">
                        Scraping source materials, ranking developer tutorials, and chunking a personalized deep-dive technical masterclass course.
                      </p>
                    </div>

                    {/* Glowing Progress bar */}
                    <div className="w-full bg-zinc-800 h-2.5 rounded-full overflow-hidden relative shadow-inner">
                      <div className="absolute top-0 left-0 h-full bg-brand rounded-full animate-progress-loading w-[85%] shadow-brand" />
                    </div>

                    {/* Step logger */}
                    <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-5 inline-block min-w-[320px]">
                      <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-extrabold block mb-2">Current Pipeline Process</span>
                      <p className="text-brand font-mono text-xs font-bold animate-pulse">{generationStep}</p>
                    </div>
                  </div>
                </motion.div>
              ) : activeTrendingBlog ? (
                /* TRENDING ARTICLE DETAIL READER */
                <motion.div
                  key="trending-reader"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="bg-white rounded-[32px] p-10 border border-zinc-100 shadow-card relative overflow-hidden"
                >
                  <button
                    onClick={() => setActiveTrendingBlog(null)}
                    className="mb-8 px-4 py-2.5 bg-zinc-50 hover:bg-zinc-100 text-zinc-700 border rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-sm"
                  >
                    <ArrowLeft size={14} />
                    <span>Back to Daily Masterclass</span>
                  </button>

                  <div className="flex flex-wrap items-center gap-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-6 border-b pb-6 border-zinc-100">
                    <div className="flex items-center gap-1.5 px-3 py-1 bg-brand/10 text-brand border border-brand/20 rounded-lg">
                      <Sparkles size={12} />
                      <span>Trending Insight</span>
                    </div>
                    <div className="flex items-center gap-1.5 px-3 py-1 bg-zinc-50 rounded-lg border">
                      <Clock size={12} className="text-zinc-500" />
                      <span>{JSON.parse(activeTrendingBlog.summary || '{}').readingTime || 5} min read</span>
                    </div>
                    <span className="ml-auto text-zinc-400">Published {new Date(activeTrendingBlog.published_at).toLocaleDateString()}</span>
                  </div>

                  <h2 className="text-3xl font-black text-zinc-900 tracking-tight leading-tight mb-8">
                    {activeTrendingBlog.title}
                  </h2>

                  <PremiumMarkdownRenderer content={activeTrendingBlog.content} />
                </motion.div>
              ) : seriesCompleted ? (
                /* SERIES COMPLETION SCREEN */
                <motion.div
                  key="series-completed"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="p-16 bg-gradient-to-tr from-zinc-950 via-zinc-900 to-indigo-950 rounded-[48px] border border-zinc-800 text-white relative overflow-hidden shadow-2xl text-center"
                >
                  <div className="absolute top-0 right-0 w-80 h-80 bg-brand/10 blur-[120px] pointer-events-none" />
                  <div className="absolute -bottom-20 -left-20 w-80 h-80 bg-indigo-500/10 blur-[120px] pointer-events-none" />

                  <div className="max-w-xl mx-auto space-y-8 relative z-10 py-10">
                    <div className="w-20 h-20 bg-brand/10 border border-brand/20 rounded-[28px] mx-auto flex items-center justify-center text-brand">
                      <CheckCircle size={40} />
                    </div>

                    <div className="space-y-4">
                      <h2 className="text-4xl font-black tracking-tight leading-none">Course Series Completed!</h2>
                      <p className="text-zinc-400 text-base leading-relaxed">
                        Fantastic effort! You have read all parts of your personalized masterclass. Ready for your next daily tech curriculum?
                      </p>
                    </div>

                    <button
                      onClick={handleGenerateBriefing}
                      className="px-10 py-5 bg-brand text-black font-black rounded-2xl shadow-brand hover:bg-brand-hover hover:scale-105 transition-all text-sm uppercase tracking-widest cursor-pointer"
                    >
                      Synthesize Next Series
                    </button>
                  </div>
                </motion.div>
              ) : hasBrief ? (
                /* BRIEFING ACTIVE AND LOADED */
                <motion.div
                  key="briefing-active"
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="grid grid-cols-1 lg:grid-cols-3 gap-8"
                >
                  {/* Left major briefing reader */}
                  <div className="lg:col-span-2 bg-white rounded-[32px] p-10 border border-zinc-100 shadow-card relative overflow-hidden">
                    {meta && !meta.unlocked ? (
                      /* LOCKED STATE */
                      <div className="py-20 flex flex-col items-center justify-center text-center space-y-8 relative z-10">
                        <div className="w-20 h-20 bg-zinc-50 border border-zinc-200 rounded-[28px] mx-auto flex items-center justify-center text-zinc-400 shadow-sm">
                          <Clock size={36} className="animate-pulse" />
                        </div>
                        <div className="space-y-3 max-w-md mx-auto">
                          <span className="px-3.5 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-full text-[10px] font-bold uppercase tracking-widest">
                            Locked Until Tomorrow
                          </span>
                          <h3 className="text-2xl font-black text-zinc-900 tracking-tight leading-tight pt-2">
                            {brief.title}
                          </h3>
                          <p className="text-zinc-500 text-sm leading-relaxed">
                            You have completed today's daily reading chapter. The next step of your learning path is being prepared and will unlock on:
                          </p>
                          <div className="bg-zinc-50 border rounded-2xl p-4 font-mono text-xs font-bold text-zinc-800 inline-block mt-2">
                            {new Date(meta.unlockedAt).toLocaleDateString('en-US', {
                              weekday: 'long',
                              month: 'long',
                              day: 'numeric',
                              year: 'numeric'
                            })} at midnight
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* ACTIVE BRIEFING CONTENT */
                      <>
                        <div className="flex flex-wrap items-center gap-3 text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-6 border-b pb-6 border-zinc-100">
                          <div className="flex items-center gap-1.5 px-3 py-1 bg-zinc-50 rounded-lg border">
                            <Clock size={12} className="text-zinc-500" />
                            <span>{meta?.readingTime || 20} min read</span>
                          </div>
                          <div className="flex items-center gap-1.5 px-3 py-1 bg-zinc-50 rounded-lg border">
                            <Sparkles size={12} className="text-brand" />
                            <span>Gemini 2.5 Flash</span>
                          </div>
                          <span className="ml-auto text-zinc-400">Published {new Date(brief.published_at).toLocaleDateString()}</span>
                        </div>

                        <h2 className="text-3xl font-black text-zinc-900 tracking-tight leading-tight mb-8">
                          {brief.title}
                        </h2>

                        <PremiumMarkdownRenderer content={brief.content} />

                        {meta && !meta.completed && (
                          <div className="mt-12 pt-8 border-t border-zinc-100 flex justify-end">
                            <button
                              onClick={handleCompleteDay}
                              disabled={completing}
                              className="px-8 py-4 bg-brand text-black font-black rounded-2xl shadow-brand hover:bg-brand-hover hover:scale-105 transition-all text-xs uppercase tracking-widest cursor-pointer flex items-center gap-2"
                            >
                              {completing ? (
                                <>
                                  <Loader2 size={14} className="animate-spin" />
                                  Completing Day...
                                </>
                              ) : (
                                <>
                                  <CheckCircle size={14} />
                                  Complete Today's Reading
                                </>
                              )}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Right side widgets/takeaways sidebar */}
                  <div className="space-y-8">
                    {/* Series Progress card */}
                    {meta && (
                      <div className="bg-white rounded-[32px] p-8 border border-zinc-100 shadow-card">
                        <h3 className="text-lg font-black text-zinc-900 mb-2 flex items-center gap-2">
                          <LayoutDashboard size={18} className="text-brand" />
                          Series Progress
                        </h3>
                        <p className="text-xs text-zinc-500 mb-4 font-semibold uppercase tracking-wider">
                          {meta.seriesTitle}
                        </p>
                        <div className="space-y-4">
                          <div className="flex justify-between items-center text-xs font-bold text-zinc-700">
                            <span>Part {meta.partNumber} of {meta.totalParts}</span>
                            <span>{Math.round(((meta.partNumber - 1) / meta.totalParts) * 100)}% Complete</span>
                          </div>
                          
                          {/* Progress dots or bar */}
                          <div className="w-full bg-zinc-100 h-2 rounded-full overflow-hidden flex gap-0.5">
                            {Array.from({ length: meta.totalParts }).map((_, idx) => {
                              const partNum = idx + 1;
                              const isCompleted = partNum < meta.partNumber;
                              const isActive = partNum === meta.partNumber;
                              return (
                                <div
                                  key={idx}
                                  className={`flex-1 h-full rounded-sm transition-all ${
                                    isCompleted ? 'bg-brand' : isActive ? 'bg-zinc-400' : 'bg-zinc-200'
                                  }`}
                                />
                              );
                            })}
                          </div>
                          
                          {/* Timeline bullet list */}
                          <div className="pt-2 space-y-2">
                            {Array.from({ length: meta.totalParts }).map((_, idx) => {
                              const partNum = idx + 1;
                              const isCompleted = partNum < meta.partNumber;
                              const isActive = partNum === meta.partNumber;
                              return (
                                <div key={idx} className="flex items-center gap-3 text-xs">
                                  <div className={`w-2 h-2 rounded-full ${
                                    isCompleted ? 'bg-brand shadow-brand' : isActive ? 'bg-zinc-400 ring-2 ring-zinc-300' : 'bg-zinc-200'
                                  }`} />
                                  <span className={`font-semibold ${
                                    isCompleted ? 'text-zinc-500 line-through' : isActive ? 'text-zinc-950 font-bold' : 'text-zinc-400'
                                  }`}>
                                    Day {partNum} {isActive ? '(Today)' : ''}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Key features / tags */}
                    <div className="bg-white rounded-[32px] p-8 border border-zinc-100 shadow-card">
                      <h3 className="text-lg font-black text-zinc-900 mb-4 flex items-center gap-2">
                        <BookOpen size={18} className="text-brand" />
                        Curation Focus
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {brief.tags?.map((tag: string, idx: number) => (
                          <span key={idx} className="px-3.5 py-1.5 bg-zinc-50 border text-zinc-600 rounded-xl text-xs font-bold capitalize">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Actionable Next Steps */}
                    <div className="bg-white rounded-[32px] p-8 border border-zinc-100 shadow-card">
                      <h3 className="text-lg font-black text-zinc-900 mb-4 flex items-center gap-2">
                        <CheckCircle size={18} className="text-brand" />
                        Daily Takeaways
                      </h3>
                      <ul className="space-y-4">
                        <li className="flex gap-3 text-sm text-zinc-600 font-medium">
                          <CheckCircle size={16} className="text-brand shrink-0 mt-0.5" />
                          <span>Apply the masterclass practices directly to code implementation.</span>
                        </li>
                        <li className="flex gap-3 text-sm text-zinc-600 font-medium">
                          <CheckCircle size={16} className="text-brand shrink-0 mt-0.5" />
                          <span>Review full-length code snippets and analyze key architectural details.</span>
                        </li>
                        <li className="flex gap-3 text-sm text-zinc-600 font-medium">
                          <CheckCircle size={16} className="text-brand shrink-0 mt-0.5" />
                          <span>Proceed to tomorrow's daily segment once unlocked.</span>
                        </li>
                      </ul>
                    </div>

                    {/* Source context citation transparency widget */}
                    <div className="bg-white rounded-[32px] p-8 border border-zinc-100 shadow-card">
                      <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest block mb-2">Sources evaluated</span>
                      <h4 className="text-lg font-black text-zinc-900 mb-4">Network Context</h4>
                      <div className="space-y-3">
                        <div className="p-4 bg-zinc-50 border rounded-2xl flex items-center justify-between group">
                          <div>
                            <p className="text-xs font-bold text-zinc-900 leading-tight">Dev.to API</p>
                            <p className="text-[9px] text-zinc-500 uppercase tracking-widest font-semibold mt-0.5">Top Tech Trends</p>
                          </div>
                          <ExternalLink size={14} className="text-zinc-400 group-hover:text-brand transition-colors" />
                        </div>
                        <div className="p-4 bg-zinc-50 border rounded-2xl flex items-center justify-between group">
                          <div>
                            <p className="text-xs font-bold text-zinc-900 leading-tight">Hacker News API</p>
                            <p className="text-[9px] text-zinc-500 uppercase tracking-widest font-semibold mt-0.5">Global Hacker Curation</p>
                          </div>
                          <ExternalLink size={14} className="text-zinc-400 group-hover:text-brand transition-colors" />
                        </div>
                        <div className="p-4 bg-zinc-50 border rounded-2xl flex items-center justify-between group">
                          <div>
                            <p className="text-xs font-bold text-zinc-900 leading-tight">Admin URL Sources</p>
                            <p className="text-[9px] text-zinc-500 uppercase tracking-widest font-semibold mt-0.5">Times of India Curation</p>
                          </div>
                          <ExternalLink size={14} className="text-zinc-400 group-hover:text-brand transition-colors" />
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : (
                /* EMPTY STATE / SYNTHESIZE NOW CALL OUT */
                <motion.div
                  key="briefing-empty"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="p-12 bg-gradient-to-tr from-zinc-950 via-zinc-900 to-indigo-950 rounded-[48px] border border-zinc-800 text-white relative overflow-hidden shadow-2xl"
                >
                  {/* Neon glow grids */}
                  <div className="absolute top-0 right-0 w-96 h-96 bg-brand/10 blur-[130px] pointer-events-none" />
                  <div className="absolute -bottom-20 -left-20 w-96 h-96 bg-indigo-500/10 blur-[130px] pointer-events-none" />

                  <div className="max-w-xl text-left space-y-8 relative z-10 py-10 md:pl-8">
                    <div className="w-16 h-16 bg-brand/10 border border-brand/20 rounded-2xl flex items-center justify-center text-brand">
                      <Sparkles size={32} />
                    </div>

                    <div className="space-y-4">
                      <h2 className="text-4xl font-black tracking-tight leading-none">Your Daily Tech Briefing is Ready.</h2>
                      <p className="text-zinc-400 text-base leading-relaxed">
                        Synthesize your personalized technical masterclass course. We compile insights from Hacker News, Dev.to feeds, and administrative sources, mapping directly to your technology stack.
                      </p>
                    </div>

                    <button
                      onClick={handleGenerateBriefing}
                      className="px-10 py-5 bg-brand text-black font-black rounded-2xl shadow-brand hover:bg-brand-hover hover:scale-105 transition-all text-sm uppercase tracking-widest cursor-pointer"
                    >
                      Synthesize Morning Briefing
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Trending Section */}
            {trendingBlogs.length > 0 && !activeTrendingBlog && !generating && (
              <div className="mt-20 border-t border-zinc-200/60 pt-16">
                <div className="flex items-center gap-2 mb-8">
                  <Sparkles size={22} className="text-brand" />
                  <h3 className="text-2xl font-black text-zinc-900 tracking-tight">Trending in Your Stack</h3>
                </div>

                {loadingTrending ? (
                  <div className="flex items-center gap-2 text-zinc-400 py-6">
                    <Loader2 size={16} className="animate-spin" />
                    <span className="text-sm font-semibold">Refreshing trending topics...</span>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {trendingBlogs.map((tBlog) => {
                      let parsedMeta: any = {};
                      try {
                        parsedMeta = JSON.parse(tBlog.summary || '{}');
                      } catch (e) {}

                      return (
                        <div
                          key={tBlog.id}
                          onClick={() => {
                            setActiveTrendingBlog(tBlog);
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="bg-white hover:border-brand/40 border border-zinc-200/60 rounded-[32px] p-8 shadow-card-sm hover:shadow-card transition-all cursor-pointer flex flex-col justify-between group relative overflow-hidden"
                        >
                          <div className="space-y-4">
                            <span className="px-3.5 py-1.5 bg-brand/10 text-brand rounded-xl text-[10px] font-bold uppercase tracking-widest inline-block border border-brand/20">
                              {parsedMeta.topic || 'Trending Tech'}
                            </span>
                            <h4 className="text-lg font-black text-zinc-900 group-hover:text-brand transition-colors leading-snug">
                              {tBlog.title}
                            </h4>
                          </div>

                          <div className="flex items-center justify-between text-[10px] font-bold text-zinc-400 uppercase tracking-wider mt-8 pt-6 border-t border-zinc-100">
                            <span className="flex items-center gap-1.5">
                              <Clock size={12} className="text-zinc-500" />
                              {parsedMeta.readingTime || 5} min read
                            </span>
                            <span className="group-hover:translate-x-1.5 transition-transform flex items-center gap-1 text-zinc-700">
                              Read Insight →
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      </main>
    </div>
  );
}
