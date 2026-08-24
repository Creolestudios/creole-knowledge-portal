'use client';

import { useState, useEffect, useRef } from 'react';
import { RefreshCw, Sparkles, Clock, BookOpen, CheckCircle, ExternalLink, Loader2, CalendarDays } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { PremiumMarkdownRenderer } from './PremiumMarkdownRenderer';
import { useRouter } from 'next/navigation';

function localDateKey(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toDateKey(value?: string | null): string {
  if (!value) return localDateKey(new Date());
  const day = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (day) return day[1];
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return localDateKey(new Date());
  return localDateKey(parsed);
}

function formatFetchedLabel(value?: string | null): string {
  const dateKey = toDateKey(value);
  const today = localDateKey(new Date());
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  if (dateKey === today) return 'Today';
  if (dateKey === localDateKey(yesterdayDate)) return 'Yesterday';
  const [year, month, day] = dateKey.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(day)} ${months[Number(month) - 1]} ${year}`;
}

export default function DailyBlogTab({ user, profile }: { user?: any; profile?: any }) {
  const router = useRouter();
  const [brief, setBrief] = useState<any>(null);
  const [loadingBrief, setLoadingBrief] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generationStep, setGenerationStep] = useState('');
  const [quizStatus, setQuizStatus] = useState<any>(null);

  // Timer State
  const [readSeconds, setReadSeconds] = useState(0);
  const [timerActive, setTimerActive] = useState(false);

  // Quiz State
  const [quizOpen, setQuizOpen] = useState(false);
  const [quizLoading, setQuizLoading] = useState(false);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (timerActive) {
      interval = setInterval(() => {
        setReadSeconds(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [timerActive]);

  const fetchLatestBrief = async () => {
    setLoadingBrief(true);
    try {
      // Prefer URL blogId (e.g. returning from quiz). Otherwise always load
      // today's digest from the API (backend prefers IST today, else newest).
      const urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
      const urlBlogId = urlParams?.get('blogId');

      let res: Response | null = null;
      if (urlBlogId) {
        res = await fetch(`/api/digests/by-id?id=${urlBlogId}`);
      }

      if (!res || !res.ok) {
        res = await fetch('/api/digests/latest');
      }

      if (res.ok) {
        const data = await res.json();
        if (data.success && data.blog) {
          setBrief(data.blog);
          setTimerActive(true);
          if (typeof window !== 'undefined' && data.blog.id) {
            sessionStorage.setItem('active_blog_id', data.blog.id);
          }

          try {
            const qRes = await fetch(`/api/quizzes/status?blogId=${data.blog.id}`);
            if (qRes.ok) {
              const qData = await qRes.json();
              if (qData) {
                setQuizStatus(qData);
                if (qData.passed || (!qData.passed && qData.attemptsRemaining <= 0)) {
                  setTimerActive(false);
                }
              }
            }
          } catch (e) {
            console.error('Error loading quiz status:', e);
          }
        }
      }
    } catch (e) {
      console.error('Error fetching brief:', e);
    } finally {
      setLoadingBrief(false);
    }
  };

  useEffect(() => {
    queueMicrotask(() => {
      fetchLatestBrief();
    });
  }, []);

  const handleGenerateBriefing = async () => {
    if (!user) return;
    setGenerating(true);
    setBrief(null);
    setTimerActive(false);
    setReadSeconds(0);

    const steps = [
      'Syncing your preferences into the pipeline...',
      'Scraping Dev.to, Hacker News, and RSS for your stack...',
      'Extracting article bodies...',
      'Re-ranking matches with Gemini...',
      'Writing a 20-25 minute briefing from your sources...',
      'Saving the digest to MongoDB...',
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
        body: JSON.stringify({ userId: user.id, force: false })
      });

      clearInterval(stepInterval);

      if (res.ok) {
        setGenerationStep('Finalizing your Morning Brief...');
        const data = await res.json();
        if (data.success && data.blog) {
          setBrief(data.blog);
          if (typeof window !== 'undefined') {
            if (data.blog.id) {
              sessionStorage.setItem('active_blog_id', data.blog.id);
            } else {
              sessionStorage.removeItem('active_blog_id');
            }
          }
          setTimerActive(true);

          try {
            const qRes = await fetch(`/api/quizzes/status?blogId=${data.blog.id}`);
            if (qRes?.ok) {
              const qData = await qRes.json();
              setQuizStatus(qData);
              if (qData.passed || (!qData.passed && qData.attemptsRemaining <= 0)) {
                setTimerActive(false);
              }
            } else {
              setQuizStatus({ completed: false, inProgress: false, attemptsCount: 0, attemptsRemaining: 3 });
            }
          } catch (e) {
            console.error('Error loading quiz status after generation:', e);
            setQuizStatus({ completed: false, inProgress: false, attemptsCount: 0, attemptsRemaining: 3 });
          }
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

  const hasBrief = !!brief;

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}m ${s}s`;
  };

  const rawDate = brief?.generated_at || brief?.published_at || brief?.created_at;
  const formattedDate = rawDate
    ? new Date(rawDate).toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    })
    : new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });

  const estimatedMinutes = Math.max(
    1,
    Math.round(
      Number(brief?.estimated_read_minutes) > 0
        ? Number(brief.estimated_read_minutes)
        : String(brief?.content || '')
          .split(/\s+/)
          .filter(Boolean).length / 225
    )
  );

  const saveActivityAndOpenQuiz = async () => {
    if (quizLoading || !brief?.id) return;
    setQuizLoading(true);
    setTimerActive(false);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('active_blog_id', brief.id);
    }
    try {
      await fetch('/api/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          date: new Date().toISOString().split('T')[0],
          readSeconds
        })
      });
    } catch (e) {
      console.error('Failed to save reading time', e);
    }
    router.push(`/dashboard/quiz/${brief.id}`);
  };

  const handleReviewQuiz = () => {
    if (quizLoading || !brief?.id) return;
    setQuizLoading(true);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('active_blog_id', brief.id);
    }
    router.push(`/dashboard/quiz/${brief.id}`);
  };

  return (
    <>
      {hasBrief && !generating && (
        <div className="mb-8 flex justify-end">
          <button
            onClick={handleGenerateBriefing}
            className="px-6 py-3 bg-white hover:bg-zinc-50 text-zinc-700 font-bold rounded-xl border border-zinc-200 shadow-sm transition-all flex items-center gap-2 text-sm cursor-pointer shrink-0"
          >
            <RefreshCw size={15} />
            Regenerate Briefing
          </button>
        </div>
      )}

      <AnimatePresence mode="wait">
        {loadingBrief ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="bg-white rounded-[32px] p-20 border border-zinc-100 shadow-card flex flex-col items-center justify-center text-center space-y-4"
          >
            <Loader2 className="w-10 h-10 text-brand animate-spin" />
            <p className="text-zinc-500 font-semibold text-lg">Retrieving your latest briefing...</p>
          </motion.div>
        ) : generating ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="p-12 bg-gradient-to-tr from-zinc-950 via-zinc-900 to-indigo-950 rounded-[48px] border border-zinc-800 text-white relative overflow-hidden shadow-2xl"
          >
            <div className="max-w-2xl mx-auto text-center space-y-8 relative z-10 py-10">
              <div className="w-20 h-20 bg-brand/10 border border-brand/20 rounded-[28px] mx-auto flex items-center justify-center text-brand animate-bounce">
                <Sparkles size={40} />
              </div>
              <div className="space-y-3">
                <h2 className="text-3xl font-black tracking-tight">AI Factory is Synthesizing...</h2>
              </div>
              <div className="w-full bg-zinc-800 h-2.5 rounded-full overflow-hidden relative shadow-inner">
                <div className="absolute top-0 left-0 h-full bg-brand rounded-full animate-progress-loading w-[85%] shadow-brand" />
              </div>
              <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-5 inline-block min-w-[320px]">
                <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-extrabold block mb-2">Current Pipeline Process</span>
                <p className="text-brand font-mono text-xs font-bold animate-pulse">{generationStep}</p>
              </div>
            </div>
          </motion.div>
        ) : hasBrief ? (
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-8 relative"
          >
            {/* Live Reading Timer Floating Badge - Only show if quiz can be taken */}
            {(!quizStatus?.passed && (quizStatus?.attemptsRemaining ?? 3) > 0) && (
              <div className="absolute -top-6 right-0 z-10 bg-black text-white px-4 py-2 rounded-full font-mono text-sm font-bold shadow-lg flex items-center gap-2 border border-zinc-800">
                <Clock size={14} className="text-brand" />
                {formatTime(readSeconds)}
              </div>
            )}

            <div className="lg:col-span-2 space-y-6">
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
                {brief.title}
              </h2>
              <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-400 mb-8 flex items-center gap-2">
                <CalendarDays size={14} className="text-brand" />
                Fetched {formatFetchedLabel(brief.digest_date || brief.published_at)}
                <span className="text-zinc-300">·</span>
                {estimatedMinutes} min read
              </p>
              <PremiumMarkdownRenderer content={brief.content} />

              <div className="mt-10 pt-10 border-t border-zinc-100 flex flex-col items-center gap-4">
                  {(() => {
                    const attemptsCount = quizStatus?.attemptsCount || 0;
                    const attemptsRemaining = quizStatus?.attemptsRemaining ?? Math.max(0, 3 - attemptsCount);
                    const isPassed = Boolean(quizStatus?.passed);
                    const isFailedAll = Boolean(quizStatus?.failed || (!quizStatus?.passed && attemptsRemaining <= 0));
                    const isInProgress = Boolean(quizStatus?.inProgress);

                    if (isPassed) {
                      return (
                        <div className="text-center space-y-3">
                          <p className="text-sm font-bold text-green-600">
                            Quiz Passed! ({quizStatus.result?.score}/${quizStatus.result?.total} pts • {quizStatus.result?.percentage}%) 🎉
                          </p>
                          <div className="flex flex-wrap items-center justify-center gap-3">
                            <button
                              onClick={handleReviewQuiz}
                              disabled={quizLoading}
                              className="px-8 py-4 bg-zinc-950 hover:bg-zinc-900 text-white font-black rounded-2xl shadow-lg hover:scale-105 transition-all text-sm uppercase tracking-widest flex items-center gap-2 cursor-pointer disabled:opacity-50"
                            >
                              {quizLoading ? (
                                <>
                                  <Loader2 size={18} className="animate-spin" />
                                  Opening...
                                </>
                              ) : (
                                <>
                                  <BookOpen size={18} />
                                  Review Quiz Results
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    }

                    if (isFailedAll) {
                      return (
                        <div className="text-center space-y-3">
                          <p className="text-sm font-bold text-red-500">
                            Quiz Failed (Max Attempts Reached) ❌
                          </p>
                          <div className="flex flex-wrap items-center justify-center gap-3">
                            <button
                              disabled
                              className="px-8 py-4 bg-zinc-200 text-zinc-500 font-black rounded-2xl text-sm uppercase tracking-widest flex items-center gap-2 cursor-not-allowed opacity-75"
                            >
                              <CheckCircle size={18} />
                              Max Attempts Reached (0/3 left)
                            </button>
                            <button
                              onClick={handleReviewQuiz}
                              disabled={quizLoading}
                              className="px-8 py-4 bg-zinc-950 hover:bg-zinc-900 text-white font-black rounded-2xl shadow-lg hover:scale-105 transition-all text-sm uppercase tracking-widest flex items-center gap-2 cursor-pointer disabled:opacity-50"
                            >
                              {quizLoading ? (
                                <>
                                  <Loader2 size={18} className="animate-spin" />
                                  Opening...
                                </>
                              ) : (
                                <>
                                  <BookOpen size={18} />
                                  Review Quiz Results
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div className="text-center space-y-3">
                        {attemptsCount > 0 && (
                          <p className="text-xs font-bold text-amber-600 uppercase tracking-wider">
                            Attempt {attemptsCount} of 3 completed • {attemptsRemaining} {attemptsRemaining === 1 ? 'attempt' : 'attempts'} left
                          </p>
                        )}
                        <button
                          onClick={saveActivityAndOpenQuiz}
                          disabled={quizLoading}
                          className="px-8 py-4 bg-brand hover:bg-brand-hover text-black font-black rounded-2xl shadow-brand hover:scale-105 transition-all text-sm uppercase tracking-widest flex items-center gap-2 cursor-pointer disabled:opacity-50"
                        >
                          {quizLoading ? (
                            <>
                              <Loader2 size={18} className="animate-spin" />
                              Opening Quiz...
                            </>
                          ) : (
                            <>
                              <CheckCircle size={18} />
                              {isInProgress
                                ? 'Resume Quiz'
                                : attemptsCount === 0
                                  ? 'Start Quiz — Attempt 1 of 3 (3 attempts left)'
                                  : `Retake Quiz — Attempt ${attemptsCount + 1} of 3 (${attemptsRemaining} ${attemptsRemaining === 1 ? 'attempt' : 'attempts'} left)`}
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>

              <div className="space-y-8">
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

                <div className="bg-white rounded-[32px] p-8 border border-zinc-100 shadow-card">
                  <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest block mb-2">Sources evaluated</span>
                  <h4 className="text-lg font-black text-zinc-900 mb-4">Network Context</h4>
                  <div className="space-y-3">
                    <div className="p-4 bg-zinc-50 border rounded-2xl flex items-center justify-between group">
                      <div>
                        <p className="text-xs font-bold text-zinc-900 leading-tight">Dev.to API</p>
                      </div>
                      <ExternalLink size={14} className="text-zinc-400 group-hover:text-brand transition-colors" />
                    </div>
                  </div>
                </div>
              </div>
          </motion.div>
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="p-12 bg-gradient-to-tr from-zinc-950 via-zinc-900 to-indigo-950 rounded-[48px] border border-zinc-800 text-white relative overflow-hidden shadow-2xl"
          >
            <div className="max-w-xl text-left space-y-8 relative z-10 py-10 md:pl-8">
              <div className="w-16 h-16 bg-brand/10 border border-brand/20 rounded-2xl flex items-center justify-center text-brand">
                <Sparkles size={32} />
              </div>
              <div className="space-y-4">
                <h2 className="text-4xl font-black tracking-tight leading-none">Your Daily Tech Briefing is Ready.</h2>
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
    </>
  );
}
