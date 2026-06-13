'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  Loader2,
  Sparkles,
  CheckCircle2,
  XCircle,
  ArrowRight,
} from 'lucide-react';
import PortalShell from '@/components/blog-roulette/portal-shell';

interface QuizQuestion {
  q: string;
}

type Phase = 'loading' | 'intro' | 'in_progress' | 'grading' | 'result';

interface ResultState {
  passed: boolean;
  correct: number;
  per_question: boolean[];
  result: 'PASS' | 'SOFT_FAIL' | 'REJECT';
  next_status: string;
  can_retry: boolean;
}

export default function QuizPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [phase, setPhase] = useState<Phase>('loading');
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<string[]>(['', '', '']);
  const [result, setResult] = useState<ResultState | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Boot: fetch blog status; if SUBMITTED, allow start.
  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/blog-roulette/${id}`);
      if (!res.ok) {
        router.push('/blog-roulette');
        return;
      }
      setPhase('intro');
    })();
  }, [id, router]);

  async function startQuiz() {
    setPhase('loading');
    setError(null);
    const res = await fetch(`/api/blog-roulette/${id}/quiz/generate`, {
      method: 'POST',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Failed to generate quiz.');
      setPhase('intro');
      return;
    }
    const data = await res.json();
    setQuestions(data.questions);
    setAnswers(['', '', '']);
    setPhase('in_progress');
  }

  async function submitAnswers() {
    if (answers.some((a) => a.trim().length < 5)) {
      setError('Please write a real answer for each question (5+ chars).');
      return;
    }
    setPhase('grading');
    setError(null);
    const res = await fetch(`/api/blog-roulette/${id}/quiz/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Grading failed.');
      setPhase('in_progress');
      return;
    }
    const data = (await res.json()) as ResultState;
    setResult(data);
    setPhase('result');
  }

  return (
    <PortalShell>
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-brand/10 border border-brand/20 rounded-full text-brand text-[10px] font-bold uppercase tracking-widest mb-4">
            <Sparkles size={10} />
            AI Vetting Quiz
          </div>
          <h1 className="text-3xl font-black text-zinc-900 tracking-tight">
            Prove you understand your own blog
          </h1>
          <p className="text-zinc-500 mt-2">
            Three questions generated from your submission. All 3 must be
            correct to publish.
          </p>
        </div>

        <AnimatePresence mode="wait">
          {phase === 'loading' && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="bg-white rounded-[32px] p-20 border border-zinc-100 shadow-card flex flex-col items-center text-center space-y-4"
            >
              <Loader2 className="w-10 h-10 text-brand animate-spin" />
              <p className="text-zinc-500 font-semibold">Preparing quiz...</p>
            </motion.div>
          )}

          {phase === 'intro' && (
            <motion.div
              key="intro"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="p-12 bg-gradient-to-tr from-zinc-950 via-zinc-900 to-indigo-950 rounded-[40px] border border-zinc-800 text-white relative overflow-hidden shadow-2xl"
            >
              <div className="absolute top-0 right-0 w-80 h-80 bg-brand/10 blur-[120px] pointer-events-none" />
              <div className="relative z-10 space-y-6">
                <div className="w-16 h-16 bg-brand/10 border border-brand/20 rounded-2xl flex items-center justify-center text-brand">
                  <Sparkles size={32} />
                </div>
                <h2 className="text-3xl font-black tracking-tight leading-tight">
                  Ready when you are.
                </h2>
                <ul className="text-zinc-400 text-sm space-y-2">
                  <li>• 3 questions generated from your blog content.</li>
                  <li>• Editor stays locked during the quiz.</li>
                  <li>
                    • All 3 must be correct → blog auto-publishes to marketing.
                  </li>
                  <li>• 1 retry allowed on soft fail. Hard fail = rejected.</li>
                </ul>
                {error && (
                  <p className="text-red-400 text-sm font-semibold">{error}</p>
                )}
                <button
                  onClick={startQuiz}
                  className="px-8 py-4 bg-brand text-black font-black rounded-2xl shadow-brand hover:bg-brand-hover transition-all text-sm uppercase tracking-widest"
                >
                  Start Quiz
                </button>
              </div>
            </motion.div>
          )}

          {phase === 'in_progress' && (
            <motion.div
              key="quiz"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              {questions.map((q, idx) => (
                <div
                  key={idx}
                  className="bg-white rounded-[28px] p-8 border border-zinc-100 shadow-card"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-8 h-8 rounded-lg bg-brand text-black font-black flex items-center justify-center text-sm">
                      {idx + 1}
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                      Question {idx + 1} of 3
                    </span>
                  </div>
                  <p className="text-lg font-bold text-zinc-900 leading-snug mb-4">
                    {q.q}
                  </p>
                  <textarea
                    value={answers[idx]}
                    onChange={(e) => {
                      const next = [...answers];
                      next[idx] = e.target.value;
                      setAnswers(next);
                    }}
                    rows={4}
                    placeholder="Answer in your own words..."
                    className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                  />
                </div>
              ))}

              {error && (
                <p className="text-red-500 text-sm font-semibold">{error}</p>
              )}

              <div className="flex justify-end">
                <button
                  onClick={submitAnswers}
                  className="px-8 py-4 bg-brand hover:bg-brand-hover text-black font-black rounded-2xl shadow-brand transition-all flex items-center gap-2 text-sm uppercase tracking-widest"
                >
                  Submit for Grading <ArrowRight size={16} />
                </button>
              </div>
            </motion.div>
          )}

          {phase === 'grading' && (
            <motion.div
              key="grading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="bg-white rounded-[32px] p-20 border border-zinc-100 shadow-card flex flex-col items-center text-center space-y-4"
            >
              <Loader2 className="w-10 h-10 text-brand animate-spin" />
              <p className="text-zinc-500 font-semibold">
                Grading your answers...
              </p>
            </motion.div>
          )}

          {phase === 'result' && result && (
            <motion.div
              key="result"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className={`rounded-[32px] p-10 border shadow-card ${
                result.passed
                  ? 'bg-emerald-50 border-emerald-200'
                  : result.result === 'REJECT'
                    ? 'bg-red-50 border-red-200'
                    : 'bg-amber-50 border-amber-200'
              }`}
            >
              <div className="flex items-center gap-3 mb-6">
                {result.passed ? (
                  <CheckCircle2 size={32} className="text-emerald-500" />
                ) : (
                  <XCircle
                    size={32}
                    className={
                      result.result === 'REJECT'
                        ? 'text-red-500'
                        : 'text-amber-500'
                    }
                  />
                )}
                <h2 className="text-3xl font-black tracking-tight">
                  {result.passed
                    ? 'Passed — Publishing'
                    : result.result === 'REJECT'
                      ? 'Rejected'
                      : 'Soft Fail'}
                </h2>
              </div>
              <p className="text-sm text-zinc-700 mb-4 font-semibold">
                Score: {result.correct}/3
              </p>
              <ul className="space-y-2 mb-6">
                {result.per_question.map((ok, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-2 text-sm font-semibold"
                  >
                    {ok ? (
                      <CheckCircle2 size={16} className="text-emerald-500" />
                    ) : (
                      <XCircle size={16} className="text-red-500" />
                    )}
                    Question {i + 1} — {ok ? 'Correct' : 'Incorrect'}
                  </li>
                ))}
              </ul>

              {result.passed && (
                <button
                  onClick={() => router.push('/blog-roulette')}
                  className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm uppercase tracking-widest"
                >
                  Back to Blogs
                </button>
              )}
              {!result.passed && result.can_retry && (
                <button
                  onClick={() => {
                    setResult(null);
                    setPhase('intro');
                  }}
                  className="px-6 py-3 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-sm uppercase tracking-widest"
                >
                  Try Again (1 retry left)
                </button>
              )}
              {!result.passed && !result.can_retry && (
                <button
                  onClick={() => router.push('/blog-roulette')}
                  className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-sm uppercase tracking-widest"
                >
                  Back to Blogs
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </PortalShell>
  );
}
