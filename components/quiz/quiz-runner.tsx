'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { Timer, Send, ArrowRight, ArrowLeft, CheckCircle2, Target, AlertCircle, Clock } from 'lucide-react';

interface QuizRunnerProps {
  blogId: number | string;
}

export function QuizRunner({ blogId }: QuizRunnerProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  
  // Quiz State
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  
  // Elapsed Time & 20-Min Idle Check State
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showIdleModal, setShowIdleModal] = useState(false);
  const [idleCountdown, setIdleCountdown] = useState(60);
  
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Result State
  const [result, setResult] = useState<any>(null);

  // Start Quiz
  const handleStart = async () => {
    setLoading(true);
    setError('');
    setWarning('');
    try {
      const res = await fetch('/api/quizzes/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blogId })
      });
      const data = await res.json();
      
      if (res.ok && data.success !== false && data.attemptId) {
        setAttemptId(data.attemptId);
        setQuestions(data.questions);
        if (data.warning) setWarning(data.warning);
        setElapsedSeconds(0);
        setShowIdleModal(false);
        startTimer();
      } else {
        setError(data.error || 'Failed to start quiz. You may have already taken it.');
      }
    } catch (err) {
      setError('An error occurred while starting the quiz.');
    } finally {
      setLoading(false);
    }
  };

  const startTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsedSeconds(prev => {
        const next = prev + 1;
        // At 20 minutes (1200s) of continuous elapsed time, trigger the Idle Check Modal
        if (next === 1200) {
          setIdleCountdown(60);
          setShowIdleModal(true);
        }
        return next;
      });
    }, 1000);
  };

  // Autosave when moving to next question
  const saveCurrentAnswer = async () => {
    const qId = questions[currentIndex]?.id;
    const ans = answers[qId];
    if (ans && attemptId) {
      try {
        await fetch('/api/quizzes/evaluate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            attemptId,
            questionId: qId,
            userAnswer: ans
          })
        });
      } catch (err) {
        console.error('Autosave evaluation error:', err);
      }
    }
  };

  const handleSubmitQuiz = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (idleTimerRef.current) clearInterval(idleTimerRef.current);
    setShowIdleModal(false);
    setLoading(true);
    await saveCurrentAnswer();

    try {
      const res = await fetch('/api/quizzes/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setResult(data.result);
      } else {
        setError(data.error || 'Failed to submit quiz.');
      }
    } catch (err) {
      setError('An error occurred while submitting.');
    } finally {
      setLoading(false);
    }
  };

  // Handle 60s Idle Popup Countdown
  useEffect(() => {
    if (showIdleModal) {
      idleTimerRef.current = setInterval(() => {
        setIdleCountdown(prev => {
          if (prev <= 1) {
            clearInterval(idleTimerRef.current!);
            setShowIdleModal(false);
            handleSubmitQuiz();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (idleTimerRef.current) clearInterval(idleTimerRef.current);
    }

    return () => {
      if (idleTimerRef.current) clearInterval(idleTimerRef.current);
    };
  }, [showIdleModal]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleContinueQuiz = () => {
    setShowIdleModal(false);
    setElapsedSeconds(0); // Reset idle timer for another 20 minutes
    setIdleCountdown(60);
  };

  useEffect(() => {
    let mounted = true;

    const initializeQuiz = async () => {
      try {
        const statusRes = await fetch(`/api/quizzes/status?blogId=${blogId}`);
        const statusData = await statusRes.json();
        
        if (!mounted) return;

        if (statusData.completed) {
          setResult(statusData.result);
          setInitializing(false);
        } else if (statusData.inProgress) {
          setAttemptId(statusData.attemptId);
          
          if (statusData.timeLeft <= 0) {
            // Idle timeout reached while user was away
            setError('Your previous active attempt timed out. Submitting saved progress...');
            setQuestions(statusData.questions || []);
            setAnswers(statusData.answers || {});
            setElapsedSeconds(1200);
            startTimer();
          } else {
            // Resume normally
            setQuestions(statusData.questions || []);
            setAnswers(statusData.answers || {});
            setElapsedSeconds(Math.max(0, 1200 - (statusData.timeLeft || 1200)));
            startTimer();
          }
          setInitializing(false);
        } else {
          // Auto-start the quiz since they haven't taken it
          const res = await fetch('/api/quizzes/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blogId })
          });
          const data = await res.json();
          
          if (!mounted) return;

          if (res.ok && data.success !== false && data.attemptId) {
            setAttemptId(data.attemptId);
            setQuestions(data.questions);
            if (data.warning) setWarning(data.warning);
            setElapsedSeconds(0);
            startTimer();
          } else {
            setError(data.error || 'Failed to start quiz.');
          }
          setInitializing(false);
        }
      } catch (err) {
        if (mounted) {
          setError('Network error while checking quiz status.');
          setInitializing(false);
        }
      }
    };

    initializeQuiz();

    return () => {
      mounted = false;
      if (timerRef.current) clearInterval(timerRef.current);
      if (idleTimerRef.current) clearInterval(idleTimerRef.current);
    };
  }, [blogId]);  

  // Handle Answer Selection
  const handleOptionSelect = (qId: string, option: string, isMultiple: boolean) => {
    setAnswers(prev => {
      const current = prev[qId];
      if (isMultiple) {
        let arr = Array.isArray(current) ? [...current] : [];
        if (arr.includes(option)) {
          arr = arr.filter(o => o !== option);
        } else {
          arr.push(option);
        }
        return { ...prev, [qId]: arr };
      } else {
        return { ...prev, [qId]: [option] };
      }
    });
  };

  const handleTextChange = (qId: string, text: string) => {
    setAnswers(prev => ({ ...prev, [qId]: text }));
  };

  const handleNext = () => {
    saveCurrentAnswer();
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
    }
  };

  const hasAnsweredAll = () => {
    if (questions.length === 0) return false;
    return questions.every(q => {
      const ans = answers[q.id];
      const isDescriptive = ['conceptual', 'code', 'descriptive'].includes(q.question_type);
      if (isDescriptive) {
        return typeof ans === 'string' && ans.trim().length > 0;
      } else {
        return Array.isArray(ans) && ans.length > 0;
      }
    });
  };

  // Render Functions
  if (result) {
    return (
      <div className="space-y-6 mt-8">
        <div className="bg-[#0f0f11] border border-zinc-800 rounded-2xl p-8 max-w-3xl mx-auto text-center shadow-2xl">
          <div className="w-20 h-20 bg-brand/10 text-brand rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 size={40} />
          </div>
          <h2 className="text-3xl font-black text-white mb-2">Quiz Completed!</h2>
          <p className="text-zinc-400 mb-4">Your AI evaluation is complete.</p>

          {(() => {
            const count = result.attemptsCount || 1;
            const remaining = result.attemptsRemaining ?? Math.max(0, 3 - count);
            const isPassed = Boolean(result.passed);
            return (
              <div className="mb-6 space-y-2">
                <span className={`inline-block px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider ${isPassed ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'}`}>
                  {isPassed ? 'Quiz Passed! 🎉' : `Attempt ${count} of 3 Completed • ${remaining} ${remaining === 1 ? 'attempt' : 'attempts'} remaining`}
                </span>
              </div>
            );
          })()}

          <div className="grid grid-cols-2 gap-4 mb-8">
            <div className="bg-zinc-900/50 rounded-xl p-4 border border-zinc-800">
              <div className="text-xs text-zinc-500 font-bold uppercase tracking-wider mb-1">Correct Answers</div>
              <div className="text-2xl font-black text-green-400">{result.correctAnswers} / {result.totalQuestions || 5}</div>
            </div>
            <div className="bg-zinc-900/50 rounded-xl p-4 border border-zinc-800">
              <div className="text-xs text-zinc-500 font-bold uppercase tracking-wider mb-1">Time Taken</div>
              <div className="text-2xl font-black text-white">{Math.floor((result.timeTaken || elapsedSeconds) / 60)}:{((result.timeTaken || elapsedSeconds) % 60).toString().padStart(2, '0')}</div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button 
              onClick={() => router.push('/dashboard')}
              className="w-full sm:w-1/2 py-4 bg-zinc-800 hover:bg-zinc-700 text-white font-black uppercase tracking-widest text-xs rounded-xl transition-all cursor-pointer"
            >
              Back to Dashboard
            </button>
            {(!result.passed && ((result.attemptsRemaining ?? (3 - (result.attemptsCount || 1))) > 0)) && (
              <button 
                onClick={() => {
                  setResult(null);
                  setAttemptId(null);
                  setQuestions([]);
                  setCurrentIndex(0);
                  setAnswers({});
                  setWarning('');
                  handleStart();
                }}
                disabled={loading}
                className="w-full sm:w-1/2 py-4 bg-brand hover:bg-brand/90 text-black font-black uppercase tracking-widest text-xs rounded-xl transition-all shadow-brand cursor-pointer disabled:opacity-50"
              >
                {loading ? 'Starting Attempt...' : `Retake Quiz — Attempt ${(result.attemptsCount || 1) + 1} of 3`}
              </button>
            )}
          </div>
        </div>

        {result.reviewData && result.reviewData.length > 0 && (
          <div className="max-w-3xl mx-auto space-y-4">
            <h3 className="text-xl font-black text-white mb-6 border-b border-zinc-800 pb-2">Detailed Review</h3>
            {result.reviewData.map((review: any, idx: number) => (
              <div key={review.questionId} className={`p-6 rounded-xl border ${review.isCorrect ? 'bg-green-950/20 border-green-900/50' : 'bg-red-950/20 border-red-900/50'} text-left`}>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-zinc-400 text-sm font-bold uppercase tracking-wider">Question {idx + 1}</span>
                  <span className={`text-sm font-bold px-3 py-1 rounded-full ${review.isCorrect ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                    {review.isCorrect ? 'Correct' : 'Incorrect'} ({review.pointsAwarded} pts)
                  </span>
                </div>
                <p className="text-white font-medium mb-6 text-lg">{review.question}</p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div className="bg-black/20 p-4 rounded-lg border border-white/5">
                    <span className="text-xs text-zinc-500 uppercase font-bold tracking-wider mb-2 block">Your Answer</span>
                    <div className="text-zinc-300 font-medium">{Array.isArray(review.userAnswer) ? review.userAnswer.join(', ') : review.userAnswer || 'No answer provided'}</div>
                  </div>
                  <div className="bg-emerald-950/20 p-4 rounded-lg border border-emerald-900/30">
                    <span className="text-xs text-emerald-500 uppercase font-bold tracking-wider mb-2 block">Correct Answer</span>
                    <div className="text-emerald-400 font-medium">{Array.isArray(review.correctAnswers) ? review.correctAnswers.join(', ') : review.correctAnswers}</div>
                  </div>
                </div>

                {(review.evaluationReason || review.explanation) && (
                  <div className="bg-black/40 p-5 rounded-lg mt-4 border border-zinc-800">
                    <span className="text-xs text-brand uppercase font-bold tracking-wider mb-2 block flex items-center gap-2">
                      <Target size={14} /> AI Explanation
                    </span>
                    <p className="text-zinc-400 text-sm leading-relaxed">{review.evaluationReason || review.explanation}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (initializing) {
    return (
      <div className="bg-[#0f0f11] border border-zinc-800 rounded-2xl p-12 max-w-2xl mx-auto mt-8 text-center shadow-2xl flex flex-col items-center justify-center space-y-4">
        <div className="w-10 h-10 border-4 border-brand border-t-transparent rounded-full animate-spin"></div>
        <p className="text-zinc-500 font-bold uppercase tracking-widest text-sm">Initializing Quiz Environment...</p>
      </div>
    );
  }

  if (!attemptId) {
    return (
      <div className="bg-zinc-900/30 border border-brand/20 rounded-2xl p-6 mt-8 flex items-center justify-between shadow-brand">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Target className="text-brand" /> Test Your Knowledge
          </h3>
          <p className="text-zinc-400 text-sm mt-1">An AI-generated 5-question hard technical quiz based on this briefing.</p>
          {error && <p className="text-red-400 text-sm mt-2 font-medium">{error}</p>}
        </div>
        <button 
          onClick={handleStart}
          disabled={loading}
          className="px-6 py-3 bg-white text-black hover:bg-zinc-200 transition-colors font-bold text-sm rounded-xl disabled:opacity-50"
        >
          {loading ? 'Starting...' : 'Start Knowledge Quiz'}
        </button>
      </div>
    );
  }

  const q = questions[currentIndex];

  if (!q) {
    return (
      <div className="bg-[#0f0f11] border border-zinc-800 rounded-2xl p-12 max-w-2xl mx-auto mt-8 text-center shadow-2xl flex flex-col items-center justify-center space-y-4">
        <p className="text-zinc-400 font-bold uppercase tracking-widest text-sm">No questions available for this attempt.</p>
        <div className="flex gap-4">
          <button 
            onClick={() => router.push('/dashboard')}
            className="px-6 py-3 bg-zinc-800 text-white hover:bg-zinc-700 transition-colors font-bold text-sm rounded-xl"
          >
            Back to Dashboard
          </button>
          <button 
            onClick={handleStart}
            disabled={loading}
            className="px-6 py-3 bg-brand text-black hover:bg-brand/90 transition-colors font-bold text-sm rounded-xl"
          >
            {loading ? 'Starting...' : 'Restart Quiz'}
          </button>
        </div>
      </div>
    );
  }

  const isMultiple = q.question_type === 'multiple';
  const isDescriptive = ['conceptual', 'code', 'descriptive'].includes(q.question_type);

  return (
    <div className="bg-[#0f0f11] border border-zinc-800 rounded-2xl overflow-hidden mt-8 max-w-4xl mx-auto shadow-2xl relative">
      {/* 20-Minute Idle Check Popup Modal */}
      <AnimatePresence>
        {showIdleModal && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[#16161a] border border-amber-500/30 rounded-3xl p-8 max-w-md w-full shadow-2xl text-center space-y-6"
            >
              <div className="w-16 h-16 bg-amber-500/10 border border-amber-500/30 rounded-2xl mx-auto flex items-center justify-center text-amber-400">
                <Clock size={32} />
              </div>

              <div className="space-y-2">
                <h3 className="text-2xl font-black text-white tracking-tight">
                  Still working on your quiz?
                </h3>
                <p className="text-zinc-400 text-sm leading-relaxed">
                  You have been on this attempt for 20 minutes. Please confirm if you would like to keep working.
                </p>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-amber-400 text-xs font-mono font-bold flex items-center justify-center gap-2">
                <AlertCircle size={16} /> Auto-submitting in {idleCountdown}s...
              </div>

              <div className="space-y-3 pt-2">
                <button
                  type="button"
                  onClick={handleContinueQuiz}
                  className="w-full py-4 bg-brand hover:bg-brand/90 text-black font-black uppercase tracking-widest text-xs rounded-xl transition-all shadow-brand cursor-pointer"
                >
                  Yes, Continue Quiz
                </button>
                <button
                  type="button"
                  onClick={() => handleSubmitQuiz()}
                  className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer"
                >
                  Submit Quiz Now
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-[#16161a]">
        <div className="text-sm font-bold text-zinc-400 uppercase tracking-widest">
          Question {currentIndex + 1} of {questions.length}
        </div>
        <div className="flex items-center gap-2 font-mono text-sm font-bold text-brand bg-brand/10 border border-brand/20 px-3 py-1.5 rounded-lg">
          <Clock size={16} />
          Time Elapsed: {Math.floor(elapsedSeconds / 60)}:{(elapsedSeconds % 60).toString().padStart(2, '0')}
        </div>
      </div>

      {warning && (
        <div className="px-6 py-3 bg-amber-500/10 border-b border-amber-500/20 flex items-start gap-3 text-amber-400">
          <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
          <div className="text-xs leading-relaxed font-medium">
            {warning}
          </div>
        </div>
      )}

      {/* Progress */}
      <div className="h-1 w-full bg-zinc-900">
        <motion.div 
          className="h-full bg-brand"
          initial={{ width: 0 }}
          animate={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
        />
      </div>

      {/* Question Content */}
      <div className="p-8">
        <span className="inline-block px-3 py-1 bg-zinc-800 text-zinc-300 text-[10px] font-bold uppercase tracking-widest rounded-md mb-4">
          {q.question_type} • {q.difficulty}
        </span>
        <h2 className="text-xl md:text-2xl font-semibold text-white leading-relaxed mb-6">
          {q.question}
        </h2>

        {q.code_snippet && (
          <div className="mb-6 rounded-xl overflow-hidden border border-zinc-800 font-mono text-sm shadow-lg">
            <div className="px-4 py-2 bg-zinc-900 border-b border-zinc-800 text-zinc-500 text-xs">Code Snippet</div>
            <pre className="p-4 bg-[#0a0a0c] text-zinc-300 overflow-x-auto">
              <code>{q.code_snippet}</code>
            </pre>
          </div>
        )}

        {/* Options / Input */}
        {isDescriptive ? (
          <textarea 
            value={answers[q.id] || ''}
            onChange={(e) => handleTextChange(q.id, e.target.value)}
            placeholder="Type your detailed answer here... (AI evaluated)"
            aria-label="Your detailed answer"
            className="w-full h-40 bg-zinc-900/50 border border-zinc-700 rounded-xl p-4 text-white placeholder-zinc-500 focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand resize-none"
          />
        ) : (
          <div className="space-y-3" role={isMultiple ? "group" : "radiogroup"}>
            {q.options?.map((opt: string, i: number) => {
              const isSelected = (answers[q.id] || []).includes(opt);
              return (
                <button
                  key={i}
                  role={isMultiple ? "checkbox" : "radio"}
                  aria-checked={isSelected}
                  onClick={() => handleOptionSelect(q.id, opt, isMultiple)}
                  className={`w-full text-left p-4 rounded-xl border transition-all ${
                    isSelected 
                      ? 'bg-brand/10 border-brand text-white shadow-brand' 
                      : 'bg-zinc-900/30 border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:bg-zinc-900'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-5 h-5 flex items-center justify-center border rounded flex-shrink-0 ${isMultiple ? 'rounded-md' : 'rounded-full'} ${isSelected ? 'border-brand bg-brand text-black' : 'border-zinc-600'}`}>
                      {isSelected && <CheckCircle2 size={14} strokeWidth={4} />}
                    </div>
                    <span className="text-[15px] font-medium leading-relaxed">{opt}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer Controls */}
      <div className="px-8 py-5 border-t border-zinc-800 bg-[#16161a] flex items-center justify-between">
        <button 
          onClick={handlePrev}
          disabled={currentIndex === 0 || loading}
          className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors text-sm font-semibold disabled:opacity-30 disabled:hover:text-zinc-400"
        >
          <ArrowLeft size={16} /> Previous
        </button>

        {currentIndex === questions.length - 1 ? (
          <div className="flex flex-col items-end gap-1.5">
            {!hasAnsweredAll() && (
              <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                Answer all questions to submit
              </span>
            )}
            <button 
              onClick={() => handleSubmitQuiz()}
              disabled={loading || !hasAnsweredAll()}
              className="flex items-center gap-2 bg-brand text-black hover:bg-brand/90 transition-colors px-6 py-2.5 rounded-lg text-sm font-black uppercase tracking-wider disabled:opacity-30 disabled:hover:bg-brand disabled:cursor-not-allowed"
            >
              {loading ? 'Submitting...' : 'Submit Quiz'} <Send size={16} />
            </button>
          </div>
        ) : (
          <button 
            onClick={handleNext}
            className="flex items-center gap-2 bg-white text-black hover:bg-zinc-200 transition-colors px-6 py-2.5 rounded-lg text-sm font-bold"
          >
            Next <ArrowRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
