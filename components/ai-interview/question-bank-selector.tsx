'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckSquare, Loader2, Square } from 'lucide-react';
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

  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<Set<string>>(new Set());
  const [questionCount, setQuestionCount] = useState(10);
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [similarityConfirmed, setSimilarityConfirmed] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

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

  const categories = useMemo(
    () => Array.from(new Set(bank.map((q) => q.category))).sort((a, b) => a.localeCompare(b)),
    [bank],
  );

  const questionsByCategory = useMemo(() => {
    const map = new Map<string, HRQuestionBankRow[]>();
    for (const q of bank) {
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
      if (next.has(category)) {
        next.delete(category);
        const ids = new Set(selectedQuestionIds);
        (questionsByCategory.get(category) || []).forEach((q) => ids.delete(q.id));
        setSelectedQuestionIds(ids);
      } else {
        next.add(category);
      }
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

  const matchPercentage = extraction.analysis.matchPercentage || 0;
  const isLowMatch = matchPercentage < LOW_MATCH_THRESHOLD;
  const selectedCount = selectedQuestionIds.size;
  const countMatches = selectedCount === questionCount;
  const canGenerate =
    !isSubmitting && !bankLoading && countMatches && selectedCount > 0 && (!isLowMatch || similarityConfirmed);

  const handleGenerate = async () => {
    setSubmitError(null);
    setIsSubmitting(true);
    try {
      setStatusMessage('Creating the interview session & saving selected questions...');
      const result = await createInterviewSessionWithInvite(extraction, durationMinutes, {
        questionCount,
        similarityConfirmed,
        questionBankIds: Array.from(selectedQuestionIds),
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
      <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-2xl">
        <h3 className="text-lg font-semibold text-slate-100">Select Interview Questions</h3>
        <p className="text-xs text-slate-400 mt-1">
          Choose the categories, then check the exact questions to include. The number of
          questions checked must equal the configured question count.
        </p>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-400">
              <span>Total question count</span>
              <input
                id="question-bank-selector-question-count"
                type="number"
                min={1}
                value={questionCount}
                onChange={(e) => setQuestionCount(Math.max(1, Number(e.target.value) || 1))}
                className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl text-sm text-slate-100 outline-none focus:border-blue-500"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-400">
              <span>Interview duration (minutes)</span>
              <input
                id="question-bank-selector-duration"
                type="number"
                min={5}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Math.max(5, Number(e.target.value) || 5))}
                className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl text-sm text-slate-100 outline-none focus:border-blue-500"
              />
            </label>
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

          {/* CATEGORIES */}
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => {
              const active = selectedCategories.has(category);
              return (
                <button
                  key={category}
                  type="button"
                  id={`question-bank-category-${category}`}
                  onClick={() => toggleCategory(category)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium border transition-all ${
                    active
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  {active ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                  {category.replaceAll('_', ' ')}
                </button>
              );
            })}
          </div>

          {/* QUESTIONS PER SELECTED CATEGORY */}
          <div className="space-y-4">
            {Array.from(selectedCategories).map((category) => (
              <div
                key={category}
                className="p-4 bg-slate-900/60 border border-slate-800 rounded-2xl space-y-2"
              >
                <h4 className="text-sm font-semibold text-slate-200 capitalize">
                  {category.replaceAll('_', ' ')}
                </h4>
                <div className="space-y-2">
                  {(questionsByCategory.get(category) || []).map((q) => {
                    const checked = selectedQuestionIds.has(q.id);
                    return (
                      <label
                        key={q.id}
                        className="flex items-start gap-3 p-3 bg-slate-950/50 border border-slate-800/90 rounded-xl cursor-pointer hover:border-slate-700"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleQuestion(q.id)}
                          className="mt-0.5"
                        />
                        <span className="text-sm text-slate-200">{q.question_text}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* ACTIONS */}
          <div className="flex flex-col items-center gap-3 pt-2">
            <div className="text-xs text-slate-400">
              Selected {selectedCount} of {questionCount} question{questionCount === 1 ? '' : 's'}
              {!countMatches && (
                <span className="text-amber-400"> — selection must match the configured count</span>
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
