'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Timer, Send, ArrowRight, ArrowLeft, CheckCircle2, Target } from 'lucide-react';
import { QuizLeaderboard } from './quiz-leaderboard';

interface QuizRunnerProps {
  blogId: number | string;
}

export function QuizRunner({ blogId }: QuizRunnerProps) {
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState('');
  
  // Quiz State
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  
  // Timer State (600 seconds = 10 mins)
  const [timeLeft, setTimeLeft] = useState(600);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Result State
  const [result, setResult] = useState<any>(null);
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  // Start Quiz
  const handleStart = async () => {
    setLoading(true);
    setError('');
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
        setTimeLeft(600);
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
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          handleSubmitQuiz(0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Heartbeat to sync timer every 5 seconds
  useEffect(() => {
    if (!attemptId || timeLeft <= 0 || timeLeft === 600 || timeLeft % 5 !== 0) return;
    
    fetch('/api/quizzes/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attemptId,
        timeLeft
      })
    }).catch(console.error);
  }, [timeLeft, attemptId]);

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
            // Time expired while they were away, force submit
            setError('Time expired while you were away. Submitting your saved answers...');
            // We set initializing to false to render the component, and the timer will instantly hit 0 and submit
            setQuestions(statusData.questions || []);
            setAnswers(statusData.answers || {});
            setTimeLeft(0);
            startTimer();
          } else {
            // Resume normally
            setQuestions(statusData.questions || []);
            setAnswers(statusData.answers || {});
            setTimeLeft(statusData.timeLeft);
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
            setTimeLeft(600);
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
    };
  }, [blogId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle Answer Changes
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

  // Autosave when moving to next question
  const saveCurrentAnswer = () => {
    const qId = questions[currentIndex]?.id;
    const ans = answers[qId];
    if (ans && attemptId) {
      // Fire and forget evaluation
      fetch('/api/quizzes/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attemptId,
          questionId: qId,
          userAnswer: ans,
          timeLeft
        })
      }).catch(console.error);
    }
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

  const handleSubmitQuiz = async (forcedTimeLeft?: number) => {
    if (timerRef.current) clearInterval(timerRef.current);
    saveCurrentAnswer();
    setLoading(true);
    
    const finalTimeLeft = forcedTimeLeft !== undefined ? forcedTimeLeft : timeLeft;

    try {
      const res = await fetch('/api/quizzes/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId, timeLeft: finalTimeLeft })
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

  // Render Functions
  if (showLeaderboard) {
    return <QuizLeaderboard blogId={blogId} onClose={() => setShowLeaderboard(false)} />;
  }

  if (result) {
    return (
      <div className="space-y-6 mt-8">
        <div className="bg-[#0f0f11] border border-zinc-800 rounded-2xl p-8 max-w-3xl mx-auto text-center shadow-2xl">
          <div className="w-20 h-20 bg-brand/10 text-brand rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 size={40} />
          </div>
          <h2 className="text-3xl font-black text-white mb-2">Quiz Completed!</h2>
          <p className="text-zinc-400 mb-8">Your AI evaluation is complete.</p>
          
          <div className="grid grid-cols-2 gap-4 mb-8">
            <div className="bg-zinc-900/50 rounded-xl p-4 border border-zinc-800">
              <div className="text-xs text-zinc-500 font-bold uppercase tracking-wider mb-1">Total Score</div>
              <div className="text-2xl font-black text-brand">{result.score} / {result.total}</div>
            </div>
            <div className="bg-zinc-900/50 rounded-xl p-4 border border-zinc-800">
              <div className="text-xs text-zinc-500 font-bold uppercase tracking-wider mb-1">Accuracy</div>
              <div className="text-2xl font-black text-white">{result.percentage}%</div>
            </div>
            <div className="bg-zinc-900/50 rounded-xl p-4 border border-zinc-800">
              <div className="text-xs text-zinc-500 font-bold uppercase tracking-wider mb-1">Correct Answers</div>
              <div className="text-2xl font-black text-green-400">{result.correctAnswers}</div>
            </div>
            <div className="bg-zinc-900/50 rounded-xl p-4 border border-zinc-800">
              <div className="text-xs text-zinc-500 font-bold uppercase tracking-wider mb-1">Time Taken</div>
              <div className="text-2xl font-black text-white">{Math.floor(result.timeTaken / 60)}:{(result.timeTaken % 60).toString().padStart(2, '0')}</div>
            </div>
          </div>

          <button 
            onClick={() => setShowLeaderboard(true)}
            className="w-full py-4 bg-brand hover:bg-brand/90 text-black font-black uppercase tracking-widest text-sm rounded-xl transition-colors shadow-brand"
          >
            View Leaderboard
          </button>
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
          <p className="text-zinc-400 text-sm mt-1">An AI-generated, 5-question hard technical quiz based on this briefing.</p>
          {error && <p className="text-red-400 text-sm mt-2 font-medium">{error}</p>}
        </div>
        <button 
          onClick={handleStart}
          disabled={loading}
          className="px-6 py-3 bg-white text-black hover:bg-zinc-200 transition-colors font-bold text-sm rounded-xl disabled:opacity-50"
        >
          {loading ? 'Starting...' : 'Start 10-Min Quiz'}
        </button>
      </div>
    );
  }

  const q = questions[currentIndex];
  const isMultiple = q.question_type === 'multiple';
  const isDescriptive = ['conceptual', 'code', 'descriptive'].includes(q.question_type);

  return (
    <div className="bg-[#0f0f11] border border-zinc-800 rounded-2xl overflow-hidden mt-8 max-w-4xl mx-auto shadow-2xl">
      {/* Header */}
      <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-[#16161a]">
        <div className="text-sm font-bold text-zinc-400 uppercase tracking-widest">
          Question {currentIndex + 1} of {questions.length}
        </div>
        <div className={`flex items-center gap-2 font-mono text-lg font-bold ${timeLeft < 60 ? 'text-red-500 animate-pulse' : 'text-brand'}`}>
          <Timer size={20} />
          {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
        </div>
      </div>

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
            className="w-full h-40 bg-zinc-900/50 border border-zinc-700 rounded-xl p-4 text-white placeholder-zinc-500 focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand resize-none"
          />
        ) : (
          <div className="space-y-3">
            {q.options?.map((opt: string, i: number) => {
              const isSelected = (answers[q.id] || []).includes(opt);
              return (
                <button
                  key={i}
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
          <button 
            onClick={() => handleSubmitQuiz()}
            disabled={loading}
            className="flex items-center gap-2 bg-brand text-black hover:bg-brand/90 transition-colors px-6 py-2.5 rounded-lg text-sm font-black uppercase tracking-wider"
          >
            {loading ? 'Submitting...' : 'Submit Quiz'} <Send size={16} />
          </button>
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
