'use client';

import React from 'react';
import {
  X,
  ExternalLink,
  Clock,
  MessageSquare,
  Sparkles,
  Folder,
  FileText,
  CheckCircle2,
} from 'lucide-react';
import { ZohoTaskItem } from '@/lib/zoho/service';
import { formatZohoDurationToClock } from '@/lib/zoho/client';
import { generateDynamicPerformanceSummary, evaluateWorkAndCommentMatch } from '@/lib/zoho/heuristics';

interface ZohoTaskModalProps {
  task: ZohoTaskItem | null;
  onClose: () => void;
  hideZohoLink?: boolean;
}

function formatCommentTime(timeStr?: string): string {
  if (!timeStr) return '';
  if (timeStr.includes('T')) {
    try {
      const d = new Date(timeStr);
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    } catch {
      // Fallback
    }
  }
  return timeStr;
}

export default function ZohoTaskModal({ task, onClose, hideZohoLink }: ZohoTaskModalProps) {
  React.useEffect(() => {
    if (!task) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [task, onClose]);

  // Dynamic evaluation with buffer: up to +5m more and -15m less
  const evalData = React.useMemo(() => {
    if (!task) return null;
    const plannedHoursNum = Number(task.plannedHours);
    const plannedMins = Math.round((Number.isFinite(plannedHoursNum) && plannedHoursNum > 0 ? plannedHoursNum : 4) * 60);
    const actualHoursNum = Number(task.actualHours);
    const actualMins = Math.round((Number.isFinite(actualHoursNum) && actualHoursNum >= 0 ? actualHoursNum : 0) * 60);
    const variance = actualMins - plannedMins;

    // Buffer: up to 5 mins more (+5m overtime) and up to 15 mins less (-15m early)
    let timeScore = 10;
    let timeAssessmentLabel = 'ON_TIME';

    if (actualMins === 0) {
      timeScore = 0;
      timeAssessmentLabel = 'NOT_LOGGED';
    } else if (variance > 0 && variance <= 5) {
      timeScore = 10;
      timeAssessmentLabel = 'SLIGHT_OVERRUN_TOLERATED';
    } else if (variance <= 0 && variance >= -15) {
      timeScore = 10;
      timeAssessmentLabel = 'ON_TIME';
    } else if (variance < -15) {
      const earlyGap = Math.abs(variance) - 15;
      const penalty = Math.min(5.0, Number(((earlyGap / (plannedMins || 60)) * 8).toFixed(1)));
      timeScore = Math.max(3.0, Number((10 - penalty).toFixed(1)));
      timeAssessmentLabel = 'UNEXPECTED_EARLY';
    } else {
      const excess = variance - 5;
      const penalty = Math.min(7.0, Number(((excess / (plannedMins || 60)) * 7).toFixed(1)));
      timeScore = Math.max(2.0, Number((10 - penalty).toFixed(1)));
      timeAssessmentLabel = 'OVERDUE';
    }

    const hasComments = Boolean(task.comments && task.comments.length > 0);
    const commentContents = (task.comments || []).map((c) => c.content || '');
    const workMatchResult = evaluateWorkAndCommentMatch(task.taskDescription, commentContents);
    const workMatchScore = workMatchResult.workMatchScore;

    const overallScore = Number((
      workMatchScore * 0.55 +
      timeScore * 0.40 +
      (task.isQAReview ? 0.5 : 0)
    ).toFixed(1));

    const dyn = generateDynamicPerformanceSummary({
      taskDescription: task.taskDescription || '',
      comments: (task.comments || []).map((c) => c.content || ''),
      timeAssessmentLabel,
      workMatchScore,
      seniorityLevel: 'Senior',
      userExperienceYears: 4,
      aiSubscriptions: ['GitHub Copilot'],
      isQAReview: task.isQAReview || task.zohoStatus.toLowerCase().includes('qa'),
    });

    return {
      overallScore: Math.min(10.0, overallScore),
      timeScore,
      workMatchScore,
      commentQualityScore: workMatchScore,
      complexityScore: 8.0,
      repetitionScore: 10.0,
      timeVarianceMinutes: variance,
      timeAssessmentLabel,
      isRepetitive: false,
      repetitionSimilarityPct: 0,
      matchedTaskId: null,
      workMatchFeedback: hasComments
        ? 'Comments substantiate the completed scope and justify the time given for this task.'
        : 'Missing progress comments in Zoho. Work justification score is 0.',
      summaryFeedback: dyn.performanceSummary,
      whereLacked: dyn.whereLacked,
      whereToImprove: dyn.whereToImprove,
      improvementItems: dyn.improvementItems,
      strengths: [],
      improvements: [],
      aiModelUsed: 'engineering-rule-engine',
    };
  }, [task]);

  // Normalize scores to 0-10 scale
  const format10 = (score: number | undefined | null, fallback = 8.0) => {
    if (score === 0) return '0.0';
    if (score === undefined || score === null || Number.isNaN(score)) return fallback.toFixed(1);
    const val = score > 10 ? score / 10 : score;
    return val.toFixed(1);
  };

  const hasComments = Boolean(task?.comments && task.comments.length > 0);
  const overallScore10 = evalData ? format10(evalData.overallScore) : null;
  const timeScore10 = evalData ? format10(evalData.timeScore) : null;
  const workMatchScore10 = evalData ? format10(evalData.workMatchScore || evalData.commentQualityScore) : null;

  if (!task || !evalData) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200 cursor-pointer"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-[#14161b] border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-5xl xl:max-w-6xl max-h-[92vh] overflow-hidden flex flex-col shadow-2xl cursor-default"
      >
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between gap-4 bg-white/95 dark:bg-[#14161b]/95 backdrop-blur-xs z-10 shrink-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-[11px] font-bold text-[#34c4f2] bg-[#34c4f2]/10 border border-[#34c4f2]/20 px-2.5 py-0.5 rounded-full flex items-center gap-1.5 shadow-2xs">
                <Folder className="w-3 h-3" />
                {task.projectName}
              </span>
              <span
                className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${
                  task.isQAReview || task.zohoStatus.toLowerCase().includes('qa')
                    ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700'
                }`}
              >
                {task.zohoStatus}
              </span>
            </div>
            <h3 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-white leading-snug line-clamp-1" title={task.taskName}>
              {task.taskName}
            </h3>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Direct Zoho Deep-Link Button (Hidden for regular users in user portal) */}
            {!hideZohoLink && task.zohoLink && (
              <a
                href={task.zohoLink}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-bold text-zinc-600 dark:text-zinc-300 hover:text-[#34c4f2] dark:hover:text-[#34c4f2] flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors shadow-2xs"
              >
                <span>Open in Zoho</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              aria-label="Close dialog"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body: Two Columns (Scrollable on small viewports, zero scroll on desktop) */}
        <div className="p-5 overflow-y-auto max-h-[calc(92vh-100px)] grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          {/* ======================================================== */}
          {/* LEFT COLUMN: Current Task & Logged Data                 */}
          {/* ======================================================== */}
          <div className="space-y-3.5">
            <div className="flex items-center justify-between pb-1.5 border-b border-zinc-100 dark:border-zinc-800">
              <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-[#34c4f2]" />
                Task Details & Logs
              </span>
              <span className="text-[10px] text-zinc-400">Zoho Projects Activity</span>
            </div>

            {/* Time & Hours Breakdown Card */}
            <div className="p-3 rounded-xl bg-gradient-to-r from-sky-500/[0.07] via-sky-500/[0.03] to-transparent border border-sky-200/50 dark:border-sky-800/40">
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="border-r border-zinc-200/60 dark:border-zinc-800 pr-2">
                  <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Planned Time</div>
                  <div className="text-sm font-black text-zinc-900 dark:text-white mt-0.5">{formatZohoDurationToClock(task.plannedHours)} hrs</div>
                </div>
                <div className="pl-2">
                  <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Actual Spent</div>
                  <div className="text-sm font-black text-sky-600 dark:text-sky-400 mt-0.5">{formatZohoDurationToClock(task.actualHours)} hrs</div>
                </div>
              </div>
            </div>

            {/* Task Description */}
            <div className="space-y-1">
              <h4 className="text-[10.5px] font-bold uppercase tracking-wider text-zinc-400">
                Task Description
              </h4>
              <div className="p-3 rounded-xl bg-zinc-50/70 dark:bg-zinc-800/30 border border-zinc-200/70 dark:border-zinc-800/80 text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-line max-h-28 overflow-y-auto">
                {task.taskDescription || 'No description provided in Zoho Projects.'}
              </div>
            </div>

            {/* Related Comments Thread */}
            <div className="space-y-1">
              <h4 className="text-[10.5px] font-bold uppercase tracking-wider text-zinc-400 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-[#34c4f2]" />
                  Related Comments ({task.comments?.length || 0})
                </span>
                <span className="text-[10px] font-normal text-zinc-400 lowercase">
                  work evidence & status
                </span>
              </h4>

              {task.comments && task.comments.length > 0 ? (
                <div className="space-y-2 max-h-28 overflow-y-auto pr-1">
                  {task.comments.map((comment, index) => (
                    <div
                      key={index}
                      className="p-2.5 rounded-xl bg-zinc-50/70 dark:bg-zinc-800/40 border border-zinc-200/70 dark:border-zinc-800 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-zinc-900 dark:text-white">{comment.author}</span>
                        <span className="text-zinc-400">{formatCommentTime(comment.time)}</span>
                      </div>
                      <p className="text-zinc-600 dark:text-zinc-300 leading-relaxed whitespace-pre-line">
                        {comment.content}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-50/60 dark:bg-zinc-800/30 border border-dashed border-zinc-200 dark:border-zinc-800 text-xs text-zinc-400">
                  <MessageSquare className="w-3.5 h-3.5 text-zinc-300 dark:text-zinc-600 shrink-0" />
                  <span className="italic text-[11px]">No comments logged for this task in Zoho Projects.</span>
                </div>
              )}
            </div>
          </div>

          {/* ======================================================== */}
          {/* RIGHT COLUMN: Compact Performance & Dynamic Summary     */}
          {/* ======================================================== */}
          <div className="space-y-3.5">
            <div className="flex items-center justify-between pb-1.5 border-b border-zinc-100 dark:border-zinc-800">
              <span className="text-[11px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                Performance Evaluation
              </span>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-600 dark:text-purple-400">
                <span className="text-base font-black leading-none">{overallScore10}</span>
                <span className="text-[10px] text-zinc-400 font-bold leading-none">/ 10</span>
              </div>
            </div>

            {/* Evaluation Metrics Strip */}
            <div className="grid grid-cols-2 gap-3 p-2.5 rounded-xl bg-zinc-50/70 dark:bg-zinc-800/40 border border-zinc-200/70 dark:border-zinc-800 text-center">
              {/* Item 1: TIME SPENT */}
              <div className="border-r border-zinc-200/60 dark:border-zinc-800 pr-2">
                <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider leading-tight">
                  Time Spent
                </div>
                <div className="flex items-center justify-center gap-1.5 mt-0.5 flex-wrap">
                  <span className="text-sm font-black text-zinc-900 dark:text-white leading-tight">
                    {timeScore10}
                    <span className="text-[10px] font-normal text-zinc-400">/10</span>
                  </span>
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded leading-none ${
                      evalData.timeAssessmentLabel === 'SLIGHT_OVERRUN_TOLERATED' || evalData.timeAssessmentLabel === 'ON_TIME'
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/40'
                        : evalData.timeAssessmentLabel === 'NOT_LOGGED'
                        ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                        : evalData.timeAssessmentLabel === 'UNEXPECTED_EARLY'
                        ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/40'
                        : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200/60 dark:border-rose-800/40'
                    }`}
                  >
                    {evalData.timeAssessmentLabel === 'SLIGHT_OVERRUN_TOLERATED' || evalData.timeAssessmentLabel === 'ON_TIME'
                      ? 'Within Buffer'
                      : evalData.timeAssessmentLabel === 'NOT_LOGGED'
                      ? 'Not Logged'
                      : evalData.timeAssessmentLabel === 'UNEXPECTED_EARLY'
                      ? 'Early Gap'
                      : 'Buffer Exceeded'}
                  </span>
                </div>
              </div>

              {/* Item 2: SCORE */}
              <div className="pl-2">
                <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider leading-tight">
                  Score
                </div>
                <div className="flex items-center justify-center gap-1.5 mt-0.5 flex-wrap">
                  <span className="text-sm font-black text-purple-600 dark:text-purple-400 leading-tight">
                    {workMatchScore10}
                    <span className="text-[10px] font-normal text-zinc-400">/10</span>
                  </span>
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded leading-none ${
                      !hasComments || Number(workMatchScore10) === 0
                        ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200/60 dark:border-rose-800/40'
                        : Number(workMatchScore10) >= 8.5
                        ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 border border-purple-200/60 dark:border-purple-800/40'
                        : Number(workMatchScore10) >= 6.0
                        ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200/60 dark:border-blue-800/40'
                        : 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/40'
                    }`}
                  >
                    {!hasComments || Number(workMatchScore10) === 0
                      ? 'No Comments'
                      : Number(workMatchScore10) >= 8.5
                      ? 'Justified'
                      : Number(workMatchScore10) >= 6.0
                      ? 'Partial'
                      : 'Less Accurate'}
                  </span>
                </div>
              </div>
            </div>

            {/* Dynamic Performance Evaluation & Actionable Improvements */}
            <div className="p-3 rounded-xl bg-gradient-to-br from-purple-500/[0.05] via-indigo-500/[0.03] to-transparent border border-purple-200/60 dark:border-purple-900/40 space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                Performance Evaluation & Actionable Insights
              </span>

              {/* Evaluation summary */}
              <div className="p-2.5 rounded-lg bg-white/80 dark:bg-zinc-800/80 border border-zinc-200/60 dark:border-zinc-700/50 shadow-2xs">
                <p className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed font-normal max-h-24 overflow-y-auto">
                  {evalData.summaryFeedback}
                </p>
              </div>

              {/* Key Areas to Improve in 2-column compact grid */}
              <div className="space-y-1 pt-0.5">
                <span className="text-[10.5px] font-bold text-zinc-900 dark:text-white flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  Key Areas to Improve & Work On:
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-0.5">
                  {evalData.improvementItems && evalData.improvementItems.length > 0 ? (
                    evalData.improvementItems.map((item, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-1.5 p-2 rounded-lg bg-white/70 dark:bg-zinc-800/70 border border-zinc-200/50 dark:border-zinc-700/40 text-[11px] text-zinc-700 dark:text-zinc-300 leading-snug"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-500 mt-1 shrink-0" />
                        <span>{item}</span>
                      </div>
                    ))
                  ) : (
                    <div className="flex items-start gap-1.5 p-2 rounded-lg bg-white/70 dark:bg-zinc-800/70 border border-zinc-200/50 dark:border-zinc-700/40 text-[11px] text-zinc-700 dark:text-zinc-300 leading-snug sm:col-span-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-500 mt-1 shrink-0" />
                      <span>{evalData.whereToImprove}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-2.5 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-900/50 shrink-0">
          <span className="text-[11px] text-zinc-400">
            Press <kbd className="px-1.5 py-0.5 rounded bg-zinc-200/70 dark:bg-zinc-800 text-[10px] font-mono text-zinc-600 dark:text-zinc-400">ESC</kbd> or click outside to dismiss
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-bold rounded-xl bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors shadow-2xs cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
