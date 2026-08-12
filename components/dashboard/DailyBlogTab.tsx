'use client';

import { useState, useEffect, useRef } from 'react';
import { RefreshCw, Sparkles, Clock, BookOpen, CheckCircle, ExternalLink, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { PremiumMarkdownRenderer } from './PremiumMarkdownRenderer';

export default function DailyBlogTab({ user, profile }: { user?: any; profile?: any }) {
  const [brief, setBrief] = useState<any>(null);
  const [loadingBrief, setLoadingBrief] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generationStep, setGenerationStep] = useState('');
  
  // Timer State
  const [readSeconds, setReadSeconds] = useState(0);
  const [timerActive, setTimerActive] = useState(false);

  // Quiz State
  const [quizOpen, setQuizOpen] = useState(false);

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
      const res = await fetch('/api/digests/latest');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.blog) {
          setBrief(data.blog);
          setTimerActive(true); // Start timer when blog loads
        }
      }
    } catch (e) {
      console.error('Error fetching brief:', e);
    } finally {
      setLoadingBrief(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLatestBrief();
  }, []);

  const handleGenerateBriefing = async () => {
    if (!user) return;
    setGenerating(true);
    setBrief(null);
    setTimerActive(false);
    setReadSeconds(0);

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
          setTimerActive(true);
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

  const saveActivityAndOpenQuiz = async () => {
    setTimerActive(false);
    setQuizOpen(true);
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
  };

  return (
    <>
      <div className="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-brand/10 border border-brand/20 rounded-full text-brand text-[10px] font-bold uppercase tracking-widest mb-4">
            <div className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse" />
            AI Factory Digest
          </div>
          <h1 className="text-4xl font-black text-zinc-900 tracking-tight mb-3">Your Morning Briefing</h1>
          <p className="text-zinc-500 text-base">Welcome back! Customized tech news and knowledge updates tailored perfectly to your developer interests.</p>
        </div>

        {hasBrief && !generating && (
          <button
            onClick={handleGenerateBriefing}
            className="px-6 py-3 bg-white hover:bg-zinc-50 text-zinc-700 font-bold rounded-xl border border-zinc-200 shadow-sm transition-all flex items-center gap-2 text-sm cursor-pointer shrink-0"
          >
            <RefreshCw size={15} />
            Regenerate Briefing
          </button>
        )}
      </div>

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
            {/* Live Reading Timer Floating Badge */}
            <div className="absolute -top-6 right-0 z-10 bg-black text-white px-4 py-2 rounded-full font-mono text-sm font-bold shadow-lg flex items-center gap-2 border border-zinc-800">
              <Clock size={14} className="text-brand" />
              {formatTime(readSeconds)}
            </div>

            <div className="lg:col-span-2 bg-white rounded-[32px] p-10 border border-zinc-100 shadow-card">
              <h2 className="text-3xl font-black text-zinc-900 tracking-tight leading-tight mb-8">
                {brief.title}
              </h2>
              <PremiumMarkdownRenderer content={brief.content} />
              
              <div className="mt-10 pt-10 border-t border-zinc-100 flex justify-center">
                <button 
                  onClick={saveActivityAndOpenQuiz}
                  className="px-8 py-4 bg-brand hover:bg-brand-hover text-black font-black rounded-2xl shadow-brand hover:scale-105 transition-all text-sm uppercase tracking-widest flex items-center gap-2"
                >
                  <CheckCircle size={18} />
                  Start Quiz
                </button>
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
      
      {/* Quiz Modal */}
      {quizOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl">
            <h2 className="text-2xl font-black mb-4">Daily Quiz</h2>
            <p className="text-zinc-600 mb-6">Test your comprehension of today&apos;s blog.</p>
            <div className="space-y-3 mb-6">
              <button className="w-full text-left p-4 border rounded-xl hover:border-brand font-medium">A) Server-Side Rendering (SSR)</button>
              <button className="w-full text-left p-4 border rounded-xl hover:border-brand font-medium">B) Client-Side Rendering (CSR)</button>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setQuizOpen(false)} className="px-4 py-2 font-bold text-zinc-500 hover:text-zinc-900">Cancel</button>
              <button onClick={() => {
                fetch('/api/activity', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ 
                    userId: user.id, 
                    date: new Date().toISOString().split('T')[0],
                    quizScore: 1,
                    quizTotal: 1
                  })
                }).then(() => {
                  setQuizOpen(false);
                  alert("Quiz submitted successfully!");
                });
              }} className="px-6 py-2 bg-black text-white rounded-xl font-bold">Submit</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
