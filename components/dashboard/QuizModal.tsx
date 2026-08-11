'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, CheckCircle, XCircle, Trophy, RotateCcw, ArrowRight } from 'lucide-react';
import type { Quiz } from '@/types/contracts';
import { scoreQuiz, isPassing } from '@/lib/data/quiz';
import { logActivity } from '@/lib/data/activity';

type Stage = 'confirm' | 'quiz' | 'result';

interface QuizModalProps {
  quiz: Quiz;
  date: string;
  open: boolean;
  onClose: () => void;
}

/**
 * End-of-blog quiz. Flow: confirm popup → question stepper → result screen.
 * On submit the result is logged to the activity store. A failing score can be
 * retaken; passing marks the day complete. No native alert/confirm dialogs.
 */
export default function QuizModal({ quiz, date, open, onClose }: QuizModalProps) {
  const [stage, setStage] = useState<Stage>('confirm');
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [reviewing, setReviewing] = useState(false);

  const question = quiz.questions[current];
  const result = scoreQuiz(quiz, answers, date);
  const passed = isPassing(result);

  const reset = (toStage: Stage) => {
    setStage(toStage);
    setCurrent(0);
    setAnswers({});
    setReviewing(false);
  };

  const handleClose = () => {
    reset('confirm');
    onClose();
  };

  const submit = () => {
    const final = scoreQuiz(quiz, answers, date);
    void logActivity({
      date,
      quizTaken: true,
      quizScore: final.score,
      quizTotal: final.total,
    });
    setStage('result');
  };

  const select = (optionIndex: number) => {
    setAnswers((prev) => ({ ...prev, [question.id]: optionIndex }));
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        id="quiz-modal-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="w-full max-w-xl bg-white rounded-[28px] border border-zinc-200 shadow-2xl overflow-hidden"
        >
          <div className="flex items-center justify-between px-5 sm:px-8 py-5 border-b border-zinc-100">
            <h2 className="text-lg font-black text-zinc-900 tracking-tight">Knowledge Check</h2>
            <button
              type="button"
              id="quiz-close-btn"
              onClick={handleClose}
              className="text-zinc-400 hover:text-zinc-900 transition-colors cursor-pointer"
              aria-label="Close quiz"
            >
              <X size={20} />
            </button>
          </div>

          <div className="p-5 sm:p-8">
            {/* CONFIRM */}
            {stage === 'confirm' && (
              <div className="text-center space-y-6 py-4">
                <div className="w-16 h-16 bg-brand/10 border border-brand/20 rounded-2xl mx-auto flex items-center justify-center text-brand">
                  <Trophy size={32} />
                </div>
                <div className="space-y-2">
                  <h3 className="text-2xl font-black text-zinc-900 tracking-tight">
                    Ready to start the quiz?
                  </h3>
                  <p className="text-zinc-500 text-sm">
                    {quiz.questions.length} quick questions on today&apos;s reading. You can retake
                    it if you don&apos;t pass.
                  </p>
                </div>
                <div className="flex items-center justify-center gap-3 pt-2">
                  <button
                    type="button"
                    id="quiz-cancel-btn"
                    onClick={handleClose}
                    className="px-6 py-3 rounded-xl border border-zinc-200 text-zinc-600 font-bold text-sm hover:bg-zinc-50 transition-all cursor-pointer"
                  >
                    Not now
                  </button>
                  <button
                    type="button"
                    id="quiz-start-btn"
                    onClick={() => setStage('quiz')}
                    className="px-8 py-3 rounded-xl bg-brand text-black font-black text-sm uppercase tracking-widest shadow-brand hover:bg-brand-hover hover:scale-105 transition-all cursor-pointer"
                  >
                    Start Quiz
                  </button>
                </div>
              </div>
            )}

            {/* QUIZ STEPPER */}
            {stage === 'quiz' && question && (
              <div className="space-y-6">
                <div className="flex items-center justify-between text-[10px] font-extrabold uppercase tracking-widest text-zinc-400">
                  <span>
                    Question {current + 1} of {quiz.questions.length}
                  </span>
                  <span className="text-brand">
                    {Object.keys(answers).length}/{quiz.questions.length} answered
                  </span>
                </div>
                <div className="w-full bg-zinc-100 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand rounded-full transition-all"
                    style={{ width: `${((current + 1) / quiz.questions.length) * 100}%` }}
                  />
                </div>

                <h3 className="text-xl font-black text-zinc-900 tracking-tight leading-snug">
                  {question.prompt}
                </h3>

                <div className="space-y-3">
                  {question.options.map((opt, i) => {
                    const chosen = answers[question.id] === i;
                    return (
                      <button
                        type="button"
                        key={i}
                        id={`quiz-option-${question.id}-${i}`}
                        onClick={() => select(i)}
                        className={`w-full text-left px-5 py-4 rounded-2xl border text-sm font-semibold transition-all cursor-pointer ${
                          chosen
                            ? 'border-brand bg-brand/5 text-zinc-900 shadow-sm'
                            : 'border-zinc-200 text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50'
                        }`}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    id="quiz-prev-btn"
                    onClick={() => setCurrent((c) => Math.max(0, c - 1))}
                    disabled={current === 0}
                    className="px-5 py-2.5 text-sm font-bold text-zinc-500 disabled:opacity-30 hover:text-zinc-900 transition-colors cursor-pointer disabled:cursor-default"
                  >
                    Back
                  </button>
                  {current < quiz.questions.length - 1 ? (
                    <button
                      type="button"
                      id="quiz-next-btn"
                      onClick={() => setCurrent((c) => c + 1)}
                      disabled={answers[question.id] === undefined}
                      className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-zinc-900 text-white font-bold text-sm hover:bg-zinc-800 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-default"
                    >
                      Next <ArrowRight size={16} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      id="quiz-submit-btn"
                      onClick={submit}
                      disabled={Object.keys(answers).length < quiz.questions.length}
                      className="px-8 py-3 rounded-xl bg-brand text-black font-black text-sm uppercase tracking-widest shadow-brand hover:bg-brand-hover transition-all cursor-pointer disabled:opacity-30 disabled:cursor-default"
                    >
                      Submit
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* RESULT */}
            {stage === 'result' && (
              <div className="space-y-6">
                <div className="text-center space-y-3 py-2">
                  <div
                    className={`w-16 h-16 rounded-2xl mx-auto flex items-center justify-center ${
                      passed ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'
                    }`}
                  >
                    {passed ? <Trophy size={32} /> : <RotateCcw size={32} />}
                  </div>
                  <h3 className="text-3xl font-black text-zinc-900 tracking-tight">
                    {result.score}/{result.total} correct
                  </h3>
                  <p
                    className={`text-sm font-bold ${passed ? 'text-green-600' : 'text-amber-600'}`}
                  >
                    {passed ? 'Passed — day complete! 🎉' : 'Almost there — give it another go.'}
                  </p>
                </div>

                {reviewing && (
                  <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                    {quiz.questions.map((q) => {
                      const correct = answers[q.id] === q.answerIndex;
                      return (
                        <div
                          key={q.id}
                          className="p-4 rounded-2xl border border-zinc-100 bg-zinc-50 space-y-1"
                        >
                          <div className="flex items-start gap-2">
                            {correct ? (
                              <CheckCircle size={16} className="text-green-600 shrink-0 mt-0.5" />
                            ) : (
                              <XCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
                            )}
                            <p className="text-sm font-bold text-zinc-900">{q.prompt}</p>
                          </div>
                          {!correct && (
                            <p className="text-xs text-zinc-500 ml-6">
                              Correct answer:{' '}
                              <span className="font-bold text-zinc-700">
                                {q.options[q.answerIndex]}
                              </span>
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="flex items-center justify-center gap-3 pt-2">
                  <button
                    type="button"
                    id="quiz-review-btn"
                    onClick={() => setReviewing((r) => !r)}
                    className="px-6 py-3 rounded-xl border border-zinc-200 text-zinc-600 font-bold text-sm hover:bg-zinc-50 transition-all cursor-pointer"
                  >
                    {reviewing ? 'Hide answers' : 'Review answers'}
                  </button>
                  {passed ? (
                    <button
                      type="button"
                      id="quiz-done-btn"
                      onClick={handleClose}
                      className="px-8 py-3 rounded-xl bg-brand text-black font-black text-sm uppercase tracking-widest shadow-brand hover:bg-brand-hover transition-all cursor-pointer"
                    >
                      Done
                    </button>
                  ) : (
                    <button
                      type="button"
                      id="quiz-retake-btn"
                      onClick={() => reset('quiz')}
                      className="inline-flex items-center gap-2 px-8 py-3 rounded-xl bg-zinc-900 text-white font-black text-sm uppercase tracking-widest hover:bg-zinc-800 transition-all cursor-pointer"
                    >
                      <RotateCcw size={16} /> Retake
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
