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
import { generateDynamicPerformanceSummary, evaluateWorkAndCommentMatch } from '@/lib/zoho/heuristics';

interface ZohoTaskModalProps {
  task: ZohoTaskItem | null;
  onClose: () => void;
  hideZohoLink?: boolean;
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

  if (!task) return null;

  // Dynamic evaluation with buffer: up to +5m more and -15m less
  const evalData = React.useMemo(() => {
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200 cursor-pointer"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-5xl max-h-[92vh] overflow-y-auto shadow-2xl flex flex-col cursor-default"
      >
        {/* Modal Header */}
        <div className="p-5 sm:p-6 border-b border-zinc-100 dark:border-zinc-800 flex items-start justify-between gap-4 sticky top-0 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-sm z-10">
          <div>
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="text-[11px] font-bold text-[#34c4f2] bg-[#34c4f2]/10 px-2 py-0.5 rounded-md flex items-center gap-1">
                <Folder className="w-3 h-3" />
                {task.projectName}
              </span>
              <span
                className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                  task.isQAReview || task.zohoStatus.toLowerCase().includes('qa')
                    ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                }`}
              >
                {task.zohoStatus}
              </span>
            </div>
            <h3 className="text-lg font-bold text-zinc-900 dark:text-white leading-snug">
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
                className="text-xs font-bold text-zinc-600 dark:text-zinc-300 hover:text-[#34c4f2] dark:hover:text-[#34c4f2] flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                <span>Open in Zoho</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body: Split into Two Columns */}
        <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* ======================================================== */}
          {/* LEFT COLUMN: Current Task & Logged Data                 */}
          {/* ======================================================== */}
          <div className="space-y-5">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-100 dark:border-zinc-800">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-[#34c4f2]" />
                Task Details & Logs
              </span>
              <span className="text-[11px] text-zinc-400">Zoho Projects Activity</span>
            </div>

            {/* Time & Hours Breakdown Bar */}
            <div className="grid grid-cols-3 gap-2 p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/80 dark:border-zinc-800 text-center">
              <div>
                <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Planned Time</div>
                <div className="text-sm font-black text-zinc-900 dark:text-white mt-0.5">{task.plannedHours} hrs</div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Actual Spent</div>
                <div className="text-sm font-black text-zinc-900 dark:text-white mt-0.5">{Number(task.actualHours) || 0} hrs</div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Tolerance Status</div>
                <div className="text-xs font-bold mt-1">
                  {(evalData?.timeAssessmentLabel === 'SLIGHT_OVERRUN_TOLERATED' || evalData?.timeAssessmentLabel === 'ON_TIME') && (
                    <span className="text-emerald-600 dark:text-emerald-400">Within Buffer</span>
                  )}
                  {evalData?.timeAssessmentLabel === 'UNEXPECTED_EARLY' && (
                    <span className="text-amber-600 dark:text-amber-400">Early Gap</span>
                  )}
                  {evalData?.timeAssessmentLabel === 'OVERDUE' && (
                    <span className="text-rose-600 dark:text-rose-400">Buffer Exceeded</span>
                  )}
                  {evalData?.timeAssessmentLabel === 'NOT_LOGGED' && (
                    <span className="text-zinc-500 dark:text-zinc-400">Not Logged</span>
                  )}
                  {!evalData && <span className="text-zinc-400">Pending</span>}
                </div>
              </div>
            </div>

            {/* Task Description */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">
                Task Description
              </h4>
              <div className="p-4 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-line max-h-48 overflow-y-auto">
                {task.taskDescription || 'No description provided in Zoho Projects.'}
              </div>
            </div>

            {/* Related Comments Thread */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-[#34c4f2]" />
                  Related Comments ({task.comments?.length || 0})
                </span>
                <span className="text-[10px] font-normal text-zinc-400 lowercase">
                  Work evidence & status
                </span>
              </h4>

              {task.comments && task.comments.length > 0 ? (
                <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                  {task.comments.map((comment, index) => (
                    <div
                      key={index}
                      className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/80 dark:border-zinc-800 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-bold text-zinc-900 dark:text-white">{comment.author}</span>
                        <span className="text-zinc-400">{comment.time}</span>
                      </div>
                      <p className="text-zinc-600 dark:text-zinc-300 leading-relaxed whitespace-pre-line">
                        {comment.content}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-zinc-400 italic bg-zinc-50 dark:bg-zinc-800/40 p-4 rounded-xl text-center">
                  No comments logged for this task in Zoho Projects.
                </p>
              )}
            </div>
          </div>

          {/* ======================================================== */}
          {/* RIGHT COLUMN: 3 Compact Square Boxes + Dynamic Summary   */}
          {/* ======================================================== */}
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-100 dark:border-zinc-800">
              <span className="text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                Performance Evaluation
              </span>
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-black text-purple-600 dark:text-purple-400">
                  {overallScore10}
                </span>
                <span className="text-xs text-zinc-400 font-bold">/ 10</span>
              </div>
            </div>

            {/* 3 Square Boxes Side by Side */}
            <div className="grid grid-cols-3 gap-3 text-center">
              {/* Box 1: TIME ADHERENCE */}
              <div className="p-3 aspect-square rounded-2xl bg-white dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700/60 shadow-xs flex flex-col justify-between items-center text-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block truncate">
                  Time Adherence
                </span>
                <div className="my-auto">
                  <span className="text-2xl font-black text-zinc-900 dark:text-white">
                    {timeScore10}
                  </span>
                  <span className="text-[10px] font-normal text-zinc-400"> / 10</span>
                </div>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-md truncate ${
                    evalData.timeAssessmentLabel === 'SLIGHT_OVERRUN_TOLERATED' || evalData.timeAssessmentLabel === 'ON_TIME'
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400'
                      : evalData.timeAssessmentLabel === 'NOT_LOGGED'
                      ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                      : evalData.timeAssessmentLabel === 'UNEXPECTED_EARLY'
                      ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400'
                      : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400'
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

              {/* Box 2: WORK JUSTIFICATION */}
              <div className="p-3 aspect-square rounded-2xl bg-white dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700/60 shadow-xs flex flex-col justify-between items-center text-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block truncate">
                  Work Justification
                </span>
                <div className="my-auto">
                  <span
                    className={`text-2xl font-black ${
                      !hasComments || Number(workMatchScore10) === 0
                        ? 'text-rose-600 dark:text-rose-400'
                        : Number(workMatchScore10) < 6.0
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-purple-600 dark:text-purple-400'
                    }`}
                  >
                    {workMatchScore10}
                  </span>
                  <span className="text-[10px] font-normal text-zinc-400"> / 10</span>
                </div>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-md truncate ${
                    !hasComments || Number(workMatchScore10) === 0
                      ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400'
                      : Number(workMatchScore10) >= 8.5
                      ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400'
                      : Number(workMatchScore10) >= 6.0
                      ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
                      : 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400'
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

              {/* Box 3: WORK STATUS */}
              <div className="p-3 aspect-square rounded-2xl bg-white dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700/60 shadow-xs flex flex-col justify-between items-center text-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block truncate">
                  Work Status
                </span>
                <div className="my-auto px-1">
                  <span className="text-xs font-black text-zinc-800 dark:text-zinc-200 line-clamp-2 leading-tight">
                    {task.zohoStatus}
                  </span>
                </div>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-md truncate ${
                    task.isQAReview || task.zohoStatus.toLowerCase().includes('qa')
                      ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                  }`}
                >
                  {task.isQAReview || task.zohoStatus.toLowerCase().includes('qa') ? 'QA Verified' : 'In Progress'}
                </span>
              </div>
            </div>

            {/* Dynamic Performance Evaluation & Actionable Improvements */}
            <div className="p-4 rounded-2xl bg-purple-500/5 border border-purple-200/60 dark:border-purple-900/40 space-y-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                Performance Evaluation & Actionable Insights
              </span>

              {/* 2-3 Lines Written Separately */}
              <div className="p-3.5 rounded-xl bg-white dark:bg-zinc-800/80 border border-zinc-200/80 dark:border-zinc-700/60 shadow-xs">
                <p className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-line font-normal">
                  {evalData.summaryFeedback}
                </p>
              </div>

              {/* After That: List Improve / To Work On Points for User */}
              <div className="space-y-1.5 pt-1">
                <span className="text-[11px] font-bold text-zinc-900 dark:text-white flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  Key Areas to Improve & Work On:
                </span>
                <ul className="space-y-1.5 text-xs">
                  {evalData.improvementItems && evalData.improvementItems.length > 0 ? (
                    evalData.improvementItems.map((item, idx) => (
                      <li
                        key={idx}
                        className="flex items-start gap-2 p-2 rounded-lg bg-white/70 dark:bg-zinc-800/70 border border-zinc-200/60 dark:border-zinc-700/40 text-zinc-700 dark:text-zinc-300"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-500 mt-1.5 shrink-0" />
                        <span className="leading-snug">{item}</span>
                      </li>
                    ))
                  ) : (
                    <li className="flex items-start gap-2 p-2 rounded-lg bg-white/70 dark:bg-zinc-800/70 border border-zinc-200/60 dark:border-zinc-700/40 text-zinc-700 dark:text-zinc-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-500 mt-1.5 shrink-0" />
                      <span className="leading-snug">{evalData.whereToImprove}</span>
                    </li>
                  )}
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-zinc-100 dark:border-zinc-800 flex justify-end bg-zinc-50/50 dark:bg-zinc-900/50">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 text-xs font-bold rounded-xl bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
