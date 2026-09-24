'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckSquare,
  Loader2,
  PencilLine,
  Plus,
  Sparkles,
  Square,
  Trash2,
} from 'lucide-react';
import { ExtractionResult, SessionGenerationResult } from '@/lib/ai-interview/types';
import {
  createInterviewSessionWithInvite,
  SessionGenerationError,
} from '@/lib/ai-interview/create-session-and-invite';

interface HRQuestionBankRow {
  id: string;
  title: string;
  question_text: string;
  category: string;
  difficulty: string;
  is_mandatory: boolean;
  default_order: number;
}

interface QuestionBankSelectorProps {
  extraction: ExtractionResult;
  onComplete: (result: SessionGenerationResult) => void;
  onBack: () => void;
}

const STAGE_LABELS: Record<SessionGenerationError['stage'], string> = {
  session: 'Creating the interview session',
  questions: 'Saving the selected interview questions',
  invite: 'Creating the interview link & passcode',
};

const LOW_MATCH_THRESHOLD = 70;

export function QuestionBankSelector({ extraction, onComplete, onBack }: QuestionBankSelectorProps) {
  const [bank, setBank] = useState<HRQuestionBankRow[]>([]);
  const [bankLoading, setBankLoading] = useState(true);
  const [bankError, setBankError] = useState<string | null>(null);

  // Selection states — dedicated strictly to HR / behavioral categories from the question bank
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<Set<string>>(new Set());
  const [questionCount, setQuestionCount] = useState(1);
  const [hrTotalMinutes, setHrTotalMinutes] = useState(2);
  const [similarityConfirmed, setSimilarityConfirmed] = useState(false);
  const [customQuestions, setCustomQuestions] = useState<string[]>([]);
  const [draftCustomQuestion, setDraftCustomQuestion] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Dynamic total interview duration: (Total HR min as a whole [Admin Decided]) + (~15 min AI estimate for technical questions)
  const totalDurationMinutes = useMemo(() => {
    const estimatedAiTechMinutes = 15;
    return hrTotalMinutes + estimatedAiTechMinutes;
  }, [hrTotalMinutes]);

  // Load HR question bank from DB
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/ai-interview/question-bank');
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to load the question bank.');
        if (!cancelled) setBank(json.questions || []);
      } catch (err: unknown) {
        if (!cancelled) setBankError(err instanceof Error ? err.message : 'Failed to load the question bank.');
      } finally {
        if (!cancelled) setBankLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Filter categories strictly to HR / behavioral bank rows (no artificial technical items in the bank)
  const categories = useMemo(() => {
    return Array.from(new Set(bank.map((q) => q.category)))
      .filter((cat) => cat !== 'technical')
      .sort((a, b) => a.localeCompare(b));
  }, [bank]);

  const questionsByCategory = useMemo(() => {
    const map = new Map<string, HRQuestionBankRow[]>();
    for (const q of bank) {
      if (q.category === 'technical') continue;
      const list = map.get(q.category) || [];
      list.push(q);
      map.set(q.category, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.default_order - b.default_order);
    return map;
  }, [bank]);

  const toggleCategory = (category: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const toggleQuestion = (id: string) => {
    setSelectedQuestionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllInCategory = (category: string) => {
    const questions = questionsByCategory.get(category) || [];
    setSelectedQuestionIds((prev) => {
      const next = new Set(prev);
      questions.forEach((q) => next.add(q.id));
      return next;
    });
  };

  const clearCategory = (category: string) => {
    const questions = questionsByCategory.get(category) || [];
    setSelectedQuestionIds((prev) => {
      const next = new Set(prev);
      questions.forEach((q) => next.delete(q.id));
      return next;
    });
  };

  const matchPercentage = extraction.analysis.matchPercentage || 0;
  const isLowMatch = matchPercentage < LOW_MATCH_THRESHOLD;
  const selectedCount = selectedQuestionIds.size + customQuestions.length;
  const countMatches = selectedCount === questionCount;
  const canGenerate =
    !isSubmitting && !bankLoading && countMatches && selectedCount > 0 && (!isLowMatch || similarityConfirmed);

  const handleAddCustomQuestion = () => {
    const nextQuestion = draftCustomQuestion.trim();
    if (!nextQuestion) return;
    setCustomQuestions((current) => [...current, nextQuestion]);
    setDraftCustomQuestion('');
  };

  const handleRemoveCustomQuestion = (indexToRemove: number) => {
    setCustomQuestions((current) => current.filter((_, idx) => idx !== indexToRemove));
  };

  const handleGenerate = async () => {
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      setStatusMessage('Generating 4 dynamic technical questions with AI & creating session...');

      const result = await createInterviewSessionWithInvite(extraction, totalDurationMinutes, {
        questionCount,
        similarityConfirmed,
        questionBankIds: Array.from(selectedQuestionIds),
        customQuestions,
        hrTotalMinutes,
      });
      setStatusMessage(`Interview link ready — ${result.questions.length} questions saved successfully.`);
      onComplete(result);
    } catch (err: unknown) {
      setStatusMessage(null);
      if (err instanceof SessionGenerationError) {
        setSubmitError(`${STAGE_LABELS[err.stage]} failed: ${err.message}`);
      } else {
        setSubmitError(err instanceof Error ? err.message : 'An unexpected error occurred.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full space-y-6">
      <div className="p-5 bg-gradient-to-r from-blue-500/10 via-indigo-500/10 to-purple-500/10 border border-indigo-500/20 rounded-2xl space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <span>Select Interview Questions</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-medium">
              {selectedCount} HR Selected
            </span>
          </h3>
          <div className="text-xs text-slate-400">
            Total Interview: <strong className="text-white">{selectedCount + 4}</strong> questions ({selectedCount} HR + 4 Technical)
          </div>
        </div>

        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-xs text-purple-200 leading-relaxed">
          <Sparkles className="w-4 h-4 text-yellow-300 shrink-0 mt-0.5" />
          <span>
            <strong>Automatic Dynamic Technical Questions:</strong> Exactly 4 candidate-tailored technical questions will be generated dynamically by AI with dynamic time limits according to question difficulty (Easy ~3m, Medium ~4m, Hard ~5m), referencing the candidate&apos;s resume, project highlights, and job description skills.
          </span>
        </div>
      </div>

      {bankError && (
        <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{bankError}</span>
        </div>
      )}

      {submitError && (
        <div
          id="question-bank-selector-error"
          className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm"
        >
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{submitError}</span>
        </div>
      )}

      {bankLoading ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm p-6">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Loading the question bank...</span>
        </div>
      ) : (
        <>
          {/* CONFIGURATION */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-400">
              <span className="flex items-center justify-between">
                <span>HR Questions to Pick</span>
                <span className="text-[10px] uppercase font-bold text-blue-400 tracking-wider">Admin Decided</span>
              </span>
              <input
                id="question-bank-selector-question-count"
                type="number"
                min={1}
                value={questionCount}
                onChange={(e) => setQuestionCount(Math.max(1, Number(e.target.value) || 1))}
                className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl text-sm text-slate-100 outline-none focus:border-blue-500"
              />
              <span className="text-[11px] text-slate-500">
                Number of HR / behavioral questions to include
              </span>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-400">
              <span className="flex items-center justify-between">
                <span>Total Time for HR Questions</span>
                <span className="text-[10px] uppercase font-bold text-blue-400 tracking-wider">Admin Decided</span>
              </span>
              <div className="relative">
                <input
                  id="question-bank-selector-hr-time"
                  type="number"
                  min={1}
                  max={30}
                  value={hrTotalMinutes}
                  onChange={(e) => setHrTotalMinutes(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full p-3 bg-slate-950/60 border border-slate-800 rounded-xl text-sm text-slate-100 outline-none focus:border-blue-500 pr-12"
                />
                <span className="absolute right-3 top-3 text-xs text-slate-400 font-semibold">min</span>
              </div>
              <span className="text-[11px] text-slate-500">
                {hrTotalMinutes} mins allocated as a whole for all HR questions
              </span>
            </label>
            <div className="flex flex-col justify-between p-3.5 bg-purple-950/30 border border-purple-800/40 rounded-xl">
              <div>
                <div className="flex items-center justify-between text-xs font-semibold text-purple-300">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-yellow-300" />
                    4 Technical Questions
                  </span>
                  <span className="text-[10px] uppercase font-bold text-purple-400 tracking-wider">AI Decided</span>
                </div>
                <p className="text-xs font-bold text-white mt-1.5">Dynamic Minutes Per Question</p>
                <p className="text-[11px] text-purple-200/80 leading-relaxed mt-0.5">
                  AI decides the exact minutes for each technical question along with the question based on technical complexity.
                </p>
              </div>
              <div className="text-[10px] font-semibold text-purple-300/90 pt-1 border-t border-purple-800/30">
                No hardcoded minutes &bull; Decided dynamically by AI
              </div>
            </div>
          </div>

          {/* TOTAL DURATION BANNER */}
          <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <span className="text-xs uppercase tracking-wider font-bold text-blue-400 block">Total Overall Interview Timer</span>
              <p className="text-xs text-slate-300 mt-0.5">
                {hrTotalMinutes} min total (as a whole for {questionCount} HR question{questionCount > 1 ? 's' : ''}) + Technical questions duration (AI decided with questions)
              </p>
            </div>
            <div className="text-right">
              <span className="text-2xl font-black text-white">~{totalDurationMinutes}</span>
              <span className="text-xs font-bold text-blue-300 ml-1">MINUTES</span>
              <span className="block text-[10px] text-slate-400">Total timer calculated upon AI generation</span>
            </div>
          </div>

          {isLowMatch && (
            <label
              id="question-bank-selector-low-match-confirm"
              className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-sm cursor-pointer"
            >
              <input
                type="checkbox"
                checked={similarityConfirmed}
                onChange={(e) => setSimilarityConfirmed(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Match score is {matchPercentage}%, below the {LOW_MATCH_THRESHOLD}% recommended
                threshold. Confirm you want to continue generating an interview for this candidate.
              </span>
            </label>
          )}

          {/* HR CATEGORIES PILLS */}
          <div className="space-y-2">
            <span className="text-xs font-medium text-slate-400">HR & Behavioral Categories</span>
            <div className="flex flex-wrap gap-2">
              {categories.map((category) => {
                const active = selectedCategories.has(category);
                const questions = questionsByCategory.get(category) || [];
                const categorySelectedCount = questions.filter((q) => selectedQuestionIds.has(q.id)).length;

                return (
                  <button
                    key={category}
                    type="button"
                    id={`question-bank-category-${category}`}
                    onClick={() => toggleCategory(category)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border transition-all ${
                      active
                        ? 'bg-blue-600 border-blue-500 text-white shadow-sm'
                        : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    {active ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                    <span className="capitalize">{category.replaceAll('_', ' ')}</span>
                    {categorySelectedCount > 0 && (
                      <span className="px-1.5 py-0.2 rounded-full bg-white/20 text-[10px] font-semibold">
                        {categorySelectedCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* QUESTIONS PER SELECTED CATEGORY */}
          <div className="space-y-4">
            {Array.from(selectedCategories).map((category) => {
              const questions = questionsByCategory.get(category) || [];
              const categorySelectedCount = questions.filter((q) => selectedQuestionIds.has(q.id)).length;

              return (
                <div
                  key={category}
                  className="p-4 bg-slate-900/60 border border-slate-800 rounded-2xl space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold text-slate-200 capitalize">
                        {category.replaceAll('_', ' ')}
                      </h4>
                      <span className="text-xs text-slate-500">
                        ({categorySelectedCount}/{questions.length} selected)
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => selectAllInCategory(category)}
                        className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 rounded-lg hover:bg-blue-500/10 transition"
                      >
                        Select All
                      </button>
                      <button
                        type="button"
                        onClick={() => clearCategory(category)}
                        className="text-xs text-slate-400 hover:text-slate-300 px-2 py-1 rounded-lg hover:bg-slate-800 transition"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {questions.map((q) => {
                      const checked = selectedQuestionIds.has(q.id);
                      return (
                        <label
                          key={q.id}
                          className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                            checked
                              ? 'bg-blue-950/20 border-blue-500/40 text-slate-100'
                              : 'bg-slate-950/50 border-slate-800/90 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleQuestion(q.id)}
                            className="mt-1"
                          />
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-slate-400">{q.title}</span>
                              <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 uppercase font-medium">
                                {q.difficulty}
                              </span>
                            </div>
                            <p className="text-sm leading-relaxed">{q.question_text}</p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* CUSTOM QUESTIONS */}
          <div className="p-4 bg-slate-900/60 border border-indigo-500/30 rounded-2xl space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
              <PencilLine className="h-4 w-4 text-indigo-400" />
              Write any other question
              <span className="ml-auto text-[11px] font-normal text-slate-500">For this candidate only</span>
            </div>
            <p className="text-[11px] text-slate-500">
              Add a question that is not in the bank. It will be saved only on this candidate&apos;s interview.
            </p>
            <textarea
              id="custom-interview-question"
              value={draftCustomQuestion}
              onChange={(event) => setDraftCustomQuestion(event.target.value)}
              placeholder="Write any other question..."
              rows={3}
              className="w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 outline-none focus:border-indigo-500"
            />
            <button
              id="add-custom-interview-question"
              type="button"
              onClick={handleAddCustomQuestion}
              disabled={!draftCustomQuestion.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Add question
            </button>
            {customQuestions.length > 0 && (
              <div className="space-y-2">
                {customQuestions.map((question, index) => (
                  <div
                    key={`${question}-${index}`}
                    className="flex items-start gap-3 rounded-xl border border-indigo-500/40 bg-indigo-500/5 p-3 text-sm text-slate-200"
                  >
                    <span className="mt-0.5 rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-300">
                      Custom
                    </span>
                    <span className="flex-1">{question}</span>
                    <button
                      type="button"
                      aria-label={`Remove custom question ${index + 1}`}
                      onClick={() => handleRemoveCustomQuestion(index)}
                      className="text-slate-500 transition hover:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ACTIONS */}
          <div className="flex flex-col items-center gap-3 pt-2">
            <div className="text-xs text-slate-400 text-center">
              Selected <strong className="text-white">{selectedCount}</strong> of {questionCount} HR question{questionCount === 1 ? '' : 's'}
              <span className="text-purple-300 font-medium"> + 4 dynamic technical questions will be generated</span>
              {!countMatches && (
                <div className="text-amber-400 mt-1">
                  HR selection must match configured count ({questionCount}) before generating
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onBack}
                disabled={isSubmitting}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-xl border border-slate-700"
              >
                Back
              </button>
              <button
                id="question-bank-selector-generate-link"
                type="button"
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="px-6 py-3 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-semibold rounded-xl shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isSubmitting ? statusMessage || 'Working...' : 'Generate Interview Link'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
