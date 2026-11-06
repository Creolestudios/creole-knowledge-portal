'use client';

import React, { useState, useEffect } from 'react';
import { X, Sliders, CheckCircle2, RotateCcw, AlertCircle, Clock, ShieldCheck, FileText, PieChart, Loader2 } from 'lucide-react';
import type { ZohoEvaluationRulesConfig } from '@/lib/zoho/rules-types';
import { DEFAULT_ZOHO_RULES } from '@/lib/zoho/rules-types';

interface ZohoEvaluationCriteriaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export function ZohoEvaluationCriteriaModal({
  isOpen,
  onClose,
  onSaved,
}: ZohoEvaluationCriteriaModalProps) {
  const [rules, setRules] = useState<ZohoEvaluationRulesConfig>(DEFAULT_ZOHO_RULES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Natural percentage state for weights (e.g. 45 instead of 0.45)
  const [workWeightPct, setWorkWeightPct] = useState<number>(45);
  const [timeWeightPct, setTimeWeightPct] = useState<number>(35);
  const [complexityWeightPct, setComplexityWeightPct] = useState<number>(10);
  const [repetitionWeightPct, setRepetitionWeightPct] = useState<number>(10);

  // Lock body overflow on modal mount
  useEffect(() => {
    if (!isOpen) return;

    const originalBodyOverflow = document.body.style.overflow;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalHtmlOverflow;
    };
  }, [isOpen, onClose]);

  // Load active rules on modal open
  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;
    setLoading(true);
    setStatusMessage(null);

    fetch('/api/admin/zoho/rules')
      .then((res) => res.json())
      .then((data) => {
        if (isMounted && data?.rules) {
          const loaded: ZohoEvaluationRulesConfig = {
            ...DEFAULT_ZOHO_RULES,
            ...data.rules,
          };
          setRules(loaded);
          setWorkWeightPct(Math.round((loaded.workMatchWeight || 0.45) * 100));
          setTimeWeightPct(Math.round((loaded.timeAdherenceWeight || 0.35) * 100));
          setComplexityWeightPct(Math.round((loaded.complexityWeight || 0.10) * 100));
          setRepetitionWeightPct(Math.round((loaded.repetitionWeight || 0.10) * 100));
        }
      })
      .catch((err) => {
        console.warn('Failed to load Zoho evaluation rules:', err);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const totalWeightsPct = workWeightPct + timeWeightPct + complexityWeightPct + repetitionWeightPct;

  const handleSave = async () => {
    setSaving(true);
    setStatusMessage(null);

    const payload: Partial<ZohoEvaluationRulesConfig> = {
      ...rules,
      workMatchWeight: Number((workWeightPct / 100).toFixed(2)),
      timeAdherenceWeight: Number((timeWeightPct / 100).toFixed(2)),
      complexityWeight: Number((complexityWeightPct / 100).toFixed(2)),
      repetitionWeight: Number((repetitionWeightPct / 100).toFixed(2)),
    };

    try {
      const res = await fetch('/api/admin/zoho/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules: payload }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setStatusMessage({
          type: 'success',
          text: 'Evaluation criteria updated successfully! All upcoming evaluations will use these settings.',
        });
        if (onSaved) onSaved();
        setTimeout(() => {
          onClose();
        }, 1100);
      } else {
        setStatusMessage({
          type: 'error',
          text: data.error || 'Failed to save criteria.',
        });
      }
    } catch {
      setStatusMessage({
        type: 'error',
        text: 'Network error while saving criteria.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!confirm('Reset all evaluation criteria back to original system defaults?')) return;
    setSaving(true);
    setStatusMessage(null);

    try {
      const res = await fetch('/api/admin/zoho/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset: true }),
      });

      const data = await res.json();
      if (res.ok && data.rules) {
        setRules(data.rules);
        setWorkWeightPct(45);
        setTimeWeightPct(35);
        setComplexityWeightPct(10);
        setRepetitionWeightPct(10);
        setStatusMessage({
          type: 'success',
          text: 'Restored system defaults successfully.',
        });
        if (onSaved) onSaved();
      }
    } catch {
      setStatusMessage({
        type: 'error',
        text: 'Failed to reset rules.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="relative w-full max-w-4xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header - No Global Tag */}
        <div className="px-5 py-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between shrink-0 bg-zinc-50/70 dark:bg-zinc-900/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#34c4f2]/10 flex items-center justify-center text-[#34c4f2] border border-[#34c4f2]/20">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-black text-zinc-900 dark:text-white leading-tight">
                Zoho Task Evaluation Criteria & Deductions
              </h3>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                Customize time buffers, penalty point deductions, quality caps, and scoring weights
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body - Compact 2-Column Grid (Less Scrollable) */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 text-xs space-y-4">
          {statusMessage && (
            <div
              className={`p-2.5 rounded-xl border flex items-center gap-2 font-bold text-xs ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                  : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}

          {loading ? (
            <div className="py-20 flex flex-col items-center justify-center gap-3 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[#34c4f2]/10 border border-[#34c4f2]/20 flex items-center justify-center shadow-xs">
                <Loader2 className="w-6 h-6 text-[#34c4f2] animate-spin" />
              </div>
              <div className="space-y-1">
                <div className="text-sm font-black text-zinc-800 dark:text-zinc-200">
                  Loading Evaluation Criteria...
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Fetching current active time buffers, penalty deductions, and scoring weights
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* LEFT COLUMN: Time Buffers, Penalties & QA Gate */}
              <div className="space-y-4">
                {/* 1. Time Tolerance & Buffer Penalties */}
                <div className="p-3.5 rounded-xl bg-zinc-50/70 dark:bg-zinc-800/40 border border-zinc-200/80 dark:border-zinc-800 space-y-3">
                  <div className="flex items-center gap-1.5 text-zinc-900 dark:text-white font-black text-xs uppercase tracking-wider">
                    <Clock className="w-3.5 h-3.5 text-[#34c4f2]" />
                    <span>Time Tolerance & Buffer Penalties</span>
                  </div>

                  {/* Overtime Grace & Deduction */}
                  <div className="p-2.5 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200/70 dark:border-zinc-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-zinc-800 dark:text-zinc-200 text-xs">
                        Overtime Delivery
                      </span>
                      <span className="text-[10px] text-zinc-400 font-medium">When taking more than planned</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div>
                        <span className="text-zinc-500 block mb-1">Grace Buffer</span>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min="0"
                            max="60"
                            value={rules.overtimeGraceMinutes}
                            onChange={(e) =>
                              setRules({ ...rules, overtimeGraceMinutes: parseInt(e.target.value, 10) || 0 })
                            }
                            className="w-16 px-2 py-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded text-center font-black text-zinc-900 dark:text-white"
                          />
                          <span className="text-zinc-500 font-semibold text-[11px]">mins</span>
                        </div>
                        <span className="text-[9.5px] text-zinc-400 mt-0.5 block">Tolerated at 10/10</span>
                      </div>

                      <div>
                        <span className="text-zinc-500 block mb-1">Points Cut if Exceeded</span>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            max="5.0"
                            value={rules.overtimeBreachDeduction}
                            onChange={(e) =>
                              setRules({ ...rules, overtimeBreachDeduction: parseFloat(e.target.value) || 0 })
                            }
                            className="w-16 px-2 py-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded text-center font-black text-rose-600 dark:text-rose-400"
                          />
                          <span className="text-zinc-500 font-semibold text-[11px]">pts</span>
                        </div>
                        <span className="text-[9.5px] text-zinc-400 mt-0.5 block">Cut from time score</span>
                      </div>
                    </div>
                  </div>

                  {/* Early Completion Gap & Deduction */}
                  <div className="p-2.5 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200/70 dark:border-zinc-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-zinc-800 dark:text-zinc-200 text-xs">
                        Early Completion Gap
                      </span>
                      <span className="text-[10px] text-zinc-400 font-medium">When finishing too early</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div>
                        <span className="text-zinc-500 block mb-1">Early Grace Buffer</span>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min="0"
                            max="60"
                            value={rules.earlyCompletionBufferMinutes}
                            onChange={(e) =>
                              setRules({ ...rules, earlyCompletionBufferMinutes: parseInt(e.target.value, 10) || 0 })
                            }
                            className="w-16 px-2 py-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded text-center font-black text-zinc-900 dark:text-white"
                          />
                          <span className="text-zinc-500 font-semibold text-[11px]">mins</span>
                        </div>
                        <span className="text-[9.5px] text-zinc-400 mt-0.5 block">Tolerated early</span>
                      </div>

                      <div>
                        <span className="text-zinc-500 block mb-1">Points Cut for Early Gap</span>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            max="5.0"
                            value={rules.earlyGapDeduction}
                            onChange={(e) =>
                              setRules({ ...rules, earlyGapDeduction: parseFloat(e.target.value) || 0 })
                            }
                            className="w-16 px-2 py-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded text-center font-black text-amber-600 dark:text-amber-400"
                          />
                          <span className="text-zinc-500 font-semibold text-[11px]">pts</span>
                        </div>
                        <span className="text-[9.5px] text-zinc-400 mt-0.5 block">Cut for early rush</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. QA Review Status Gate */}
                <div className="p-3.5 rounded-xl bg-zinc-50/70 dark:bg-zinc-800/40 border border-zinc-200/80 dark:border-zinc-800 space-y-2.5">
                  <div className="flex items-center gap-1.5 text-zinc-900 dark:text-white font-black text-xs uppercase tracking-wider">
                    <ShieldCheck className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Task Status Gating</span>
                  </div>

                  <div className="p-2.5 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200/70 dark:border-zinc-800 flex items-center justify-between gap-3">
                    <div className="flex-1">
                      <span className="font-bold text-zinc-800 dark:text-zinc-200 block text-xs">
                        Task Left in &ldquo;In Progress&rdquo; or &ldquo;Backlog&rdquo;
                      </span>
                      <span className="text-[10.5px] text-zinc-500 dark:text-zinc-400 block mt-0.5">
                        Points deducted from overall score if developer closes day without moving to &ldquo;In QA Review&rdquo;.
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="font-bold text-rose-500 text-sm">-</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        max="5.0"
                        value={rules.nonQAReviewDeduction}
                        onChange={(e) =>
                          setRules({ ...rules, nonQAReviewDeduction: parseFloat(e.target.value) || 0 })
                        }
                        className="w-16 px-2 py-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded text-center font-black text-rose-600 dark:text-rose-400 text-xs"
                      />
                      <span className="text-zinc-500 font-semibold text-[11px]">pts</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* RIGHT COLUMN: Quality Caps & Composite Weights */}
              <div className="space-y-4">
                {/* 3. Deliverable Quality Caps */}
                <div className="p-3.5 rounded-xl bg-zinc-50/70 dark:bg-zinc-800/40 border border-zinc-200/80 dark:border-zinc-800 space-y-2.5">
                  <div className="flex items-center gap-1.5 text-zinc-900 dark:text-white font-black text-xs uppercase tracking-wider">
                    <FileText className="w-3.5 h-3.5 text-amber-500" />
                    <span>Quality Limits & Max Score Caps</span>
                  </div>

                  <div className="space-y-2">
                    {/* Empty Description */}
                    <div className="p-2.5 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200/70 dark:border-zinc-800 flex items-center justify-between gap-3">
                      <div>
                        <span className="font-bold text-zinc-800 dark:text-zinc-200 text-xs block">
                          Missing Task Description
                        </span>
                        <span className="text-[10px] text-zinc-500 block">
                          Max score allowed when description is empty (0.0 gives zero score)
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[11px] text-zinc-400 font-bold">Max</span>
                        <input
                          type="number"
                          step="0.5"
                          min="0.0"
                          max="10.0"
                          value={rules.missingDescriptionCap}
                          onChange={(e) =>
                            setRules({ ...rules, missingDescriptionCap: parseFloat(e.target.value) || 0 })
                          }
                          className="w-16 px-2 py-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded text-center font-black text-zinc-900 dark:text-white text-xs"
                        />
                        <span className="text-zinc-400 font-semibold text-[11px]">/ 10</span>
                      </div>
                    </div>

                    {/* Short Description Penalty */}
                    <div className="p-2.5 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200/70 dark:border-zinc-800 flex items-center justify-between gap-3">
                      <div>
                        <span className="font-bold text-zinc-800 dark:text-zinc-200 text-xs block">
                          Very Short Description (≤ 6 words)
                        </span>
                        <span className="text-[10px] text-zinc-500 block">
                          Points deducted directly from Score for 1-line descriptions
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[11px] text-rose-500 font-bold">-</span>
                        <input
                          type="number"
                          step="0.5"
                          min="0.0"
                          max="10.0"
                          value={rules.shortDescriptionDeduction ?? 4.5}
                          onChange={(e) =>
                            setRules({ ...rules, shortDescriptionDeduction: parseFloat(e.target.value) || 0 })
                          }
                          className="w-16 px-2 py-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded text-center font-black text-zinc-900 dark:text-white text-xs"
                        />
                        <span className="text-zinc-400 font-semibold text-[11px]">pts</span>
                      </div>
                    </div>

                    {/* Checklist Only */}
                    <div className="p-2.5 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200/70 dark:border-zinc-800 flex items-center justify-between gap-3">
                      <div>
                        <span className="font-bold text-zinc-800 dark:text-zinc-200 text-xs block">
                          Checklist-Only Comments
                        </span>
                        <span className="text-[10px] text-zinc-500 block">
                          Max score when comments only repeat checklist words
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[11px] text-zinc-400 font-bold">Max</span>
                        <input
                          type="number"
                          step="0.5"
                          min="1.0"
                          max="10.0"
                          value={rules.checklistCommentCap}
                          onChange={(e) =>
                            setRules({ ...rules, checklistCommentCap: parseFloat(e.target.value) || 0 })
                          }
                          className="w-16 px-2 py-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded text-center font-black text-zinc-900 dark:text-white text-xs"
                        />
                        <span className="text-zinc-400 font-semibold text-[11px]">/ 10</span>
                      </div>
                    </div>

                    {/* Pending Deliverables */}
                    <div className="p-2.5 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200/70 dark:border-zinc-800 flex items-center justify-between gap-3">
                      <div>
                        <span className="font-bold text-zinc-800 dark:text-zinc-200 text-xs block">
                          Pending / Unfinished Scope
                        </span>
                        <span className="text-[10px] text-zinc-500 block">
                          Max score when deliverables are marked pending or unverified
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[11px] text-zinc-400 font-bold">Max</span>
                        <input
                          type="number"
                          step="0.5"
                          min="1.0"
                          max="10.0"
                          value={rules.partialDeliveryCap}
                          onChange={(e) =>
                            setRules({ ...rules, partialDeliveryCap: parseFloat(e.target.value) || 0 })
                          }
                          className="w-16 px-2 py-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded text-center font-black text-zinc-900 dark:text-white text-xs"
                        />
                        <span className="text-zinc-400 font-semibold text-[11px]">/ 10</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 4. Composite Scoring Weights - Natural Numbers (45%, 35%, 10%, 10%) */}
                <div className="p-3.5 rounded-xl bg-zinc-50/70 dark:bg-zinc-800/40 border border-zinc-200/80 dark:border-zinc-800 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-zinc-900 dark:text-white font-black text-xs uppercase tracking-wider">
                      <PieChart className="w-3.5 h-3.5 text-emerald-500" />
                      <span>Scoring Weights (100% Total)</span>
                    </div>
                    <span
                      className={`text-[10px] font-black px-2 py-0.5 rounded-md ${
                        totalWeightsPct === 100
                          ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                          : 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                      }`}
                    >
                      Total: {totalWeightsPct}% {totalWeightsPct !== 100 && '(Must = 100%)'}
                    </span>
                  </div>

                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div className="p-2 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200/70 dark:border-zinc-800">
                      <span className="text-[10px] font-bold text-zinc-500 uppercase block">Work Match</span>
                      <div className="flex items-center justify-center gap-0.5 mt-1">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={workWeightPct}
                          onChange={(e) => setWorkWeightPct(parseInt(e.target.value, 10) || 0)}
                          className="w-12 px-1 py-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded text-center font-black text-zinc-900 dark:text-white text-xs"
                        />
                        <span className="text-zinc-400 font-bold text-[10px]">%</span>
                      </div>
                      <span className="text-[9px] text-zinc-400 mt-0.5 block">Def: 45%</span>
                    </div>

                    <div className="p-2 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200/70 dark:border-zinc-800">
                      <span className="text-[10px] font-bold text-zinc-500 uppercase block">Time Logged</span>
                      <div className="flex items-center justify-center gap-0.5 mt-1">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={timeWeightPct}
                          onChange={(e) => setTimeWeightPct(parseInt(e.target.value, 10) || 0)}
                          className="w-12 px-1 py-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded text-center font-black text-zinc-900 dark:text-white text-xs"
                        />
                        <span className="text-zinc-400 font-bold text-[10px]">%</span>
                      </div>
                      <span className="text-[9px] text-zinc-400 mt-0.5 block">Def: 35%</span>
                    </div>

                    <div className="p-2 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200/70 dark:border-zinc-800">
                      <span className="text-[10px] font-bold text-zinc-500 uppercase block">Complexity</span>
                      <div className="flex items-center justify-center gap-0.5 mt-1">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={complexityWeightPct}
                          onChange={(e) => setComplexityWeightPct(parseInt(e.target.value, 10) || 0)}
                          className="w-12 px-1 py-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded text-center font-black text-zinc-900 dark:text-white text-xs"
                        />
                        <span className="text-zinc-400 font-bold text-[10px]">%</span>
                      </div>
                      <span className="text-[9px] text-zinc-400 mt-0.5 block">Def: 10%</span>
                    </div>

                    <div className="p-2 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200/70 dark:border-zinc-800">
                      <span className="text-[10px] font-bold text-zinc-500 uppercase block">Repetition</span>
                      <div className="flex items-center justify-center gap-0.5 mt-1">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={repetitionWeightPct}
                          onChange={(e) => setRepetitionWeightPct(parseInt(e.target.value, 10) || 0)}
                          className="w-12 px-1 py-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded text-center font-black text-zinc-900 dark:text-white text-xs"
                        />
                        <span className="text-zinc-400 font-bold text-[10px]">%</span>
                      </div>
                      <span className="text-[9px] text-zinc-400 mt-0.5 block">Def: 10%</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-900/70 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={handleReset}
            disabled={saving || loading}
            className="text-xs font-bold px-3 py-1.5 rounded-lg text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/60 dark:hover:bg-zinc-800 flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset to Defaults</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="text-xs font-bold px-3.5 py-1.5 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || loading}
              className="text-xs font-black px-4 py-1.5 rounded-lg bg-[#34c4f2] hover:bg-[#20b8e8] text-white shadow-xs transition-all cursor-pointer active:scale-95 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save & Apply Criteria'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
