'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  Loader2,
  Sparkles,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Clock,
} from 'lucide-react';
import LogoutButton from '@/components/logout-button';
import DashboardShell from '@/components/dashboard/DashboardShell';

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
  error?: string;
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
  const [quizCreatedAt, setQuizCreatedAt] = useState<string | null>(null);
  const [now, setNow] = useState<number>(0);
  const [incorrectIndices, setIncorrectIndices] = useState<number[]>([]);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState<number>(0);

  const answersRef = useRef<string[]>(answers);
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const autoSubmittedRef = useRef(false);

  // Boot: fetch blog; only allow quiz if status is SUBMITTED or QUIZ_IN_PROGRESS
  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/blog-roulette/${id}`);
      if (!res.ok) {
        router.push('/blog-roulette');
        return;
      }
      const data = await res.json();
      if (data.blog?.status !== 'SUBMITTED' && data.blog?.status !== 'QUIZ_IN_PROGRESS') {
        router.push('/blog-roulette');
        return;
      }
      setPhase('intro');
    })();
  }, [id, router]);

  // Periodic ticker to update "now" for countdown
  useEffect(() => {
    const t = setTimeout(() => {
      setNow(Date.now());
    }, 0);
    if (phase !== 'in_progress') return () => clearTimeout(t);
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearTimeout(t);
      clearInterval(interval);
    };
  }, [phase]);

  // Calculate timeLeft during render (avoids setState warning)
  let timeLeft: number | null = null;
  if (phase === 'in_progress' && quizCreatedAt && now > 0) {
    const elapsedSeconds = Math.floor((now - new Date(quizCreatedAt).getTime()) / 1000);
    timeLeft = Math.max(0, 300 - elapsedSeconds);
  }

  // Auto-submit when time is up
  useEffect(() => {
    if (phase === 'in_progress' && timeLeft !== null && timeLeft <= 0 && !autoSubmittedRef.current) {
      autoSubmittedRef.current = true;
      setPhase('grading');
      setError(null);

      const finalAnswers = answersRef.current.map((a) =>
        a.trim().length > 0 ? a : '(no answer - time expired)'
      );

      fetch(`/api/blog-roulette/${id}/quiz/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: finalAnswers }),
      })
        .then(async (res) => {
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            setError(data.error ?? 'Grading failed.');
            setPhase('in_progress');
            autoSubmittedRef.current = false;
            return;
          }
          const data = (await res.json()) as ResultState;
          setResult(data);
          setPhase('result');
        })
        .catch((err) => {
          setError('Submission failed on timeout.');
          setPhase('in_progress');
          autoSubmittedRef.current = false;
        });
    }
  }, [timeLeft, phase, id]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  async function startQuiz() {
    autoSubmittedRef.current = false;
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
    
    if (data.prev_answers) {
      setAnswers(data.prev_answers);
    } else {
      setAnswers(['', '', '']);
    }

    const wrongIndices = data.incorrect_indices || [];
    setIncorrectIndices(wrongIndices);

    if (wrongIndices.length > 0) {
      setCurrentQuestionIdx(wrongIndices[0]);
    } else {
      setCurrentQuestionIdx(0);
    }

    setQuizCreatedAt(data.created_at);
    setNow(Date.now());
    setPhase('in_progress');
  }

  async function submitAnswers(forceSubmit: boolean = false) {
    if (!forceSubmit) {
      const activeIndices = incorrectIndices.length > 0 ? incorrectIndices : [0, 1, 2];
      for (const idx of activeIndices) {
        if ((answers[idx] || '').trim().length < 5) {
          setError(`Please write a real answer for Question ${idx + 1} (5+ chars).`);
          return;
        }
      }
    }
    setPhase('grading');
    setError(null);

    const finalAnswers = answers.map((a) =>
      a.trim().length > 0 ? a : '(no answer - time expired)'
    );

    const res = await fetch(`/api/blog-roulette/${id}/quiz/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: finalAnswers }),
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
    <DashboardShell
      displayName="Author"
      displayDomain="creole"
      footer={<LogoutButton variant="sidebar" />}
    >
      <div className="max-w-3xl mx-auto">
        <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
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

          {phase === 'in_progress' && timeLeft !== null && (
            <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 text-white rounded-2xl py-3 px-5 shadow-xl shrink-0 self-start md:self-center">
              <div className="relative">
                <Clock className={`w-5 h-5 ${timeLeft < 60 ? 'text-red-400 animate-pulse' : 'text-brand'}`} />
                {timeLeft < 60 && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full animate-ping" />
                )}
              </div>
              <div>
                <span className="block text-[9px] font-bold uppercase tracking-wider text-zinc-400">Time Left</span>
                <span className={`text-lg font-black font-mono leading-none tracking-tight ${timeLeft < 60 ? 'text-red-400 animate-pulse' : 'text-white'}`}>
                  {formatTime(timeLeft)}
                </span>
              </div>
            </div>
          )}
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
                  <li>• 5-minute time limit. The quiz will auto-submit when the timer expires.</li>
                  <li>• Editor stays locked during the quiz.</li>
                  <li>
                    • All 3 must be correct → blog auto-publishes to marketing.
                  </li>
                  <li>• 1 retry allowed on soft fail (2/3 correct). Less than 2/3 correct = immediate rejection.</li>
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

          {phase === 'in_progress' && questions.length > 0 && (
            <motion.div
              key="quiz"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-6"
            >
              <div className="bg-white rounded-[28px] p-8 border border-zinc-100 shadow-card">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-8 rounded-lg bg-brand text-black font-black flex items-center justify-center text-sm">
                      {currentQuestionIdx + 1}
                    </span>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                      Question {currentQuestionIdx + 1} of 3 {incorrectIndices.length > 0 && '(Retry)'}
                    </span>
                  </div>
                  {incorrectIndices.length === 0 && (
                    <div className="flex items-center gap-1">
                      {questions.map((_, i) => (
                        <div
                          key={i}
                          className={`w-2.5 h-2.5 rounded-full transition-all ${
                            i === currentQuestionIdx
                              ? 'bg-brand scale-110 shadow-sm'
                              : i < currentQuestionIdx
                              ? 'bg-emerald-500'
                              : 'bg-zinc-200'
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </div>
                
                <p className="text-lg font-bold text-zinc-900 leading-snug mb-4">
                  {questions[currentQuestionIdx]?.q}
                </p>
                
                <textarea
                  value={answers[currentQuestionIdx] || ''}
                  onChange={(e) => {
                    const next = [...answers];
                    next[currentQuestionIdx] = e.target.value;
                    setAnswers(next);
                  }}
                  rows={6}
                  placeholder="Answer in your own words..."
                  className="w-full px-4 py-3 bg-zinc-50 border border-zinc-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
                />
              </div>

              {error && (
                <p className="text-red-500 text-sm font-semibold">{error}</p>
              )}

              <div className="flex justify-between items-center">
                {incorrectIndices.length === 0 && currentQuestionIdx > 0 ? (
                  <button
                    onClick={() => {
                      setError(null);
                      setCurrentQuestionIdx((prev) => prev - 1);
                    }}
                    className="px-6 py-3.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold rounded-2xl transition-all text-xs uppercase tracking-wider"
                  >
                    Previous
                  </button>
                ) : (
                  <div />
                )}

                {incorrectIndices.length === 0 && currentQuestionIdx < 2 ? (
                  <button
                    onClick={() => {
                      if ((answers[currentQuestionIdx] || '').trim().length < 5) {
                        setError(`Please write a real answer for Question ${currentQuestionIdx + 1} (5+ chars).`);
                        return;
                      }
                      setError(null);
                      setCurrentQuestionIdx((prev) => prev + 1);
                    }}
                    className="px-8 py-4 bg-brand hover:bg-brand-hover text-black font-black rounded-2xl shadow-brand transition-all flex items-center gap-2 text-sm uppercase tracking-widest"
                  >
                    Next Question <ArrowRight size={16} />
                  </button>
                ) : (
                  <button
                    onClick={() => submitAnswers(false)}
                    className="px-8 py-4 bg-brand hover:bg-brand-hover text-black font-black rounded-2xl shadow-brand transition-all flex items-center gap-2 text-sm uppercase tracking-widest"
                  >
                    Submit for Grading <ArrowRight size={16} />
                  </button>
                )}
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
              className={`rounded-[32px] p-10 border shadow-card ${result.passed
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

              {result.error && (
                <div className="mb-6 p-4 bg-red-100/50 border border-red-200 rounded-2xl text-red-700 text-sm font-semibold flex items-center gap-2">
                  <XCircle size={18} className="shrink-0 text-red-500" />
                  {result.error}
                </div>
              )}

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
    </DashboardShell>
  );
}
