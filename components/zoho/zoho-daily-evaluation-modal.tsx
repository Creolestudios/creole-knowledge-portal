'use client';

import React from 'react';
import {
  X,
  Calendar,
  Clock,
  Sparkles,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Layers,
} from 'lucide-react';
import { ZohoTaskItem, ZohoUserSummary } from '@/lib/zoho/service';
import { formatMinutesToClock, formatZohoDurationToClock, parseDurationToMinutes } from '@/lib/zoho/client';
import { calculateTimeAdherence } from '@/lib/zoho/heuristics';

export interface ZohoDailyEvaluationModalProps {
  day: {
    date: string;
    dayScore: number;
    summary: string;
    tasks: ZohoTaskItem[];
  };
  userName: string;
  userRole?: string;
  userSummary?: ZohoUserSummary;
  onClose: () => void;
  onSelectTask?: (task: ZohoTaskItem) => void;
  hideZohoLink?: boolean;
}

export default function ZohoDailyEvaluationModal({
  day,
  userName,
  userRole = 'Developer',
  userSummary,
  onClose,
  onSelectTask,
  hideZohoLink = false,
}: ZohoDailyEvaluationModalProps) {
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);

    const originalBodyOverflow = document.body.style.overflow;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalHtmlOverflow;
    };
  }, [onClose]);

  // Aggregate daily time statistics
  const totalPlannedMins = day.tasks.reduce(
    (acc, t) => acc + (t.plannedMinutes != null ? t.plannedMinutes : parseDurationToMinutes(t.plannedHours) || 240),
    0
  );
  const totalActualMins = day.tasks.reduce(
    (acc, t) => acc + (t.actualMinutes != null ? t.actualMinutes : parseDurationToMinutes(t.actualHours) || 0),
    0
  );

  const timeAdherence = calculateTimeAdherence(
    totalPlannedMins || 480,
    totalActualMins
  );

  // Aggregate work justification score
  const validWorkScores = day.tasks
    .map((t) => t.evaluation?.commentQualityScore ?? t.evaluation?.workMatchScore)
    .filter((s): s is number => typeof s === 'number' && Number.isFinite(s));
  const avgWorkJustification =
    validWorkScores.length > 0
      ? validWorkScores.reduce((a, b) => a + b, 0) / validWorkScores.length
      : 8.0;

  // Aggregate daily overall score
  const overallDayScore = Number.isFinite(day.dayScore) && day.dayScore > 0
    ? day.dayScore
    : Number((avgWorkJustification * 0.55 + timeAdherence.timeScore * 0.40).toFixed(1));

  // Determine aggregate tolerance badge
  const isWithinBuffer =
    timeAdherence.assessmentLabel === 'ON_TIME' ||
    timeAdherence.assessmentLabel === 'SLIGHT_OVERRUN_TOLERATED';
  const isEarlyGap = timeAdherence.assessmentLabel === 'UNEXPECTED_EARLY';
  const isOverdue = timeAdherence.assessmentLabel === 'OVERDUE';
  const isNotLogged = timeAdherence.assessmentLabel === 'NOT_LOGGED';

  // QA and Status verification
  const isQAVerified = day.tasks.some(
    (t) => t.isQAReview || (t.zohoStatus || '').toLowerCase().includes('qa')
  );
  const hasDoneTasks = day.tasks.some((t) => {
    const s = (t.zohoStatus || '').toLowerCase();
    return s.includes('done') || s.includes('closed') || s.includes('completed');
  });

  // Extract accomplishments and improvements across day tasks
  const dailyAccomplishments: string[] = [];
  const dailyImprovements: string[] = [];

  for (const t of day.tasks) {
    if (t.evaluation?.strengths) {
      for (const str of t.evaluation.strengths) {
        if (!dailyAccomplishments.includes(str)) dailyAccomplishments.push(str);
      }
    }
    if (t.evaluation?.improvements) {
      for (const imp of t.evaluation.improvements) {
        if (!dailyImprovements.includes(imp)) dailyImprovements.push(imp);
      }
    }
  }

  if (dailyAccomplishments.length === 0) {
    dailyAccomplishments.push('Progress comments justify the task implementation scope.');
    dailyAccomplishments.push('Work logged and reviewed.');
  }

  if (dailyImprovements.length === 0) {
    if (isNotLogged || totalActualMins === 0) {
      dailyImprovements.push('Log Task Hours in Zoho: Make sure to record accurate billable or non-billable timelog entries for completed or ongoing work.');
    }
    if (isOverdue || isEarlyGap) {
      dailyImprovements.push('Time Tolerance & Blocker Escalation: Flag dependencies or roadblocks early in comments to keep delivery within the +5m buffer.');
    }
    if (dailyImprovements.length === 0) {
      dailyImprovements.push('Maintain prompt technical commentary and timely status transitions in Zoho Projects.');
    }
  }

  const getScoreRating = (score: number) => {
    if (score >= 9.0) return { label: 'Excellent', color: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800' };
    if (score >= 7.5) return { label: 'Good', color: 'text-purple-700 dark:text-purple-300 bg-purple-50 dark:bg-purple-950/60 border-purple-200 dark:border-purple-800' };
    return { label: 'Needs Attention', color: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800' };
  };

  const rating = getScoreRating(overallDayScore);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 sm:p-6 overflow-y-auto overscroll-contain cursor-pointer animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-5xl xl:max-w-6xl max-h-[92vh] overflow-y-auto shadow-2xl relative my-auto cursor-default flex flex-col"
      >
        {/* Modal Header */}
        <div className="p-6 pb-4 border-b border-zinc-100 dark:border-zinc-800 flex items-start justify-between gap-4 sticky top-0 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md z-10">
          <div>
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-bold bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300">
                <Calendar className="w-3.5 h-3.5" />
                {day.date}
              </span>
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                {day.tasks.length} Task{day.tasks.length === 1 ? '' : 's'} Evaluated
              </span>
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                {userName} • {userRole}
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-zinc-900 dark:text-white tracking-tight flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-500 shrink-0" />
              Daily Performance & Activity Evaluation
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body: 2-Column Split matching Zoho UI */}
        <div className="p-6 sm:p-8 grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          {/* ======================================================== */}
          {/* LEFT COLUMN: Day Details & Logs + Tasks List             */}
          {/* ======================================================== */}
          <div className="space-y-5">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-100 dark:border-zinc-800">
              <span className="text-xs font-bold uppercase tracking-wider text-[#34c4f2] flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                Day Details & Logs
              </span>
              <span className="text-[11px] text-zinc-400">Cumulative Activity</span>
            </div>

            {/* Time & Hours Breakdown Bar in Clock H:MM Format */}
            <div className="grid grid-cols-2 gap-3 py-2 px-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/80 dark:border-zinc-800 text-center">
              <div>
                <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider leading-tight">Planned Time</div>
                <div className="text-sm font-black text-zinc-900 dark:text-white mt-0.5 leading-tight">
                  {formatMinutesToClock(totalPlannedMins)} hrs
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider leading-tight">Actual Spent</div>
                <div className="text-sm font-black text-zinc-900 dark:text-white mt-0.5 leading-tight">
                  {formatMinutesToClock(totalActualMins)} hrs
                </div>
              </div>
            </div>

            {/* Day's Tasks List */}
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-purple-500" />
                  Tasks Evaluated for this Day ({day.tasks.length})
                </span>
                <span className="text-[11px] text-zinc-400">Click task to view individual audit</span>
              </div>

              <div className="space-y-2.5 max-h-[420px] overflow-y-auto overflow-x-hidden pr-1">
                {day.tasks.map((task) => {
                  const taskActualClock = task.actualMinutes != null ? formatMinutesToClock(task.actualMinutes) : formatZohoDurationToClock(task.actualHours);
                  const taskPlannedClock = task.plannedMinutes != null ? formatMinutesToClock(task.plannedMinutes) : formatZohoDurationToClock(task.plannedHours);
                  const taskScore = task.evaluation?.overallScore ?? 8.0;

                  return (
                    <div
                      key={task.id}
                      className="p-3.5 rounded-xl bg-zinc-50/80 dark:bg-zinc-800/40 border border-zinc-200/80 dark:border-zinc-800 hover:border-purple-300 dark:hover:border-purple-700 transition-all flex flex-col gap-2 group w-full"
                    >
                      {/* Top Line: Project Name, Clock Hours, Status, and Score/Link on the Right */}
                      <div className="flex items-center justify-between gap-2 w-full">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-zinc-200/70 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 shrink-0">
                            {task.projectName}
                          </span>
                          <span className="text-[10px] font-semibold text-zinc-600 dark:text-zinc-400 flex items-center gap-1 bg-white dark:bg-zinc-900 px-2 py-0.5 rounded border border-zinc-200/70 dark:border-zinc-700 shrink-0">
                            <Clock className="w-3 h-3 text-zinc-400" />
                            {taskActualClock} hrs / {taskPlannedClock} hrs
                          </span>
                          {task.zohoStatus && (
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded shrink-0 ${
                                task.isQAReview || task.zohoStatus.toLowerCase().includes('qa')
                                  ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/60'
                                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                              }`}
                            >
                              {task.zohoStatus}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs font-black px-2 py-0.5 rounded-lg bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300 border border-purple-200/60 dark:border-purple-800/60">
                            {taskScore.toFixed(1)}/10
                          </span>
                          {!hideZohoLink && task.zohoLink && (
                            <a
                              href={task.zohoLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1 rounded text-zinc-400 hover:text-purple-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                              title="Open task in Zoho Projects"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      </div>

                      {/* Bottom Line: Full-width Task Name with Drilldown Arrow */}
                      <button
                        type="button"
                        onClick={() => {
                          if (onSelectTask) onSelectTask(task);
                        }}
                        className="w-full text-left text-xs font-bold text-zinc-900 dark:text-white hover:text-purple-600 dark:hover:text-purple-400 truncate block cursor-pointer transition-colors"
                        title={`Click to view audit for: ${task.taskName}`}
                      >
                        {task.taskName}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ======================================================== */}
          {/* RIGHT COLUMN: Daily Performance Evaluation & Insights   */}
          {/* ======================================================== */}
          <div className="space-y-5">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-100 dark:border-zinc-800">
              <span className="text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Performance Evaluation
              </span>
              <div className="flex items-center gap-2">
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${rating.color}`}>
                  {rating.label}
                </span>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-black text-purple-600 dark:text-purple-400">
                    {overallDayScore.toFixed(1)}
                  </span>
                  <span className="text-xs text-zinc-400">/ 10</span>
                </div>
              </div>
            </div>

            {/* 2 Metric Cards: Time Spent, Score (Compact matching Planned Time) */}
            <div className="grid grid-cols-2 gap-3 py-2 px-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/80 dark:border-zinc-800 text-center">
              {/* 1. Time Spent */}
              <div>
                <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider leading-tight">Time Spent</div>
                <div className="flex items-center justify-center gap-1.5 mt-0.5 flex-wrap">
                  <span className="text-sm font-black text-zinc-900 dark:text-white leading-tight">
                    {timeAdherence.timeScore.toFixed(1)}
                    <span className="text-[10px] font-normal text-zinc-400">/10</span>
                  </span>
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded leading-none ${
                      isWithinBuffer
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400'
                        : isNotLogged
                        ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
                        : isEarlyGap
                        ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400'
                        : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {isWithinBuffer
                      ? 'Within Buffer'
                      : isNotLogged
                      ? 'Not Logged'
                      : isEarlyGap
                      ? 'Early Gap'
                      : 'Buffer Exceeded'}
                  </span>
                </div>
              </div>

              {/* 2. Score */}
              <div>
                <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider leading-tight">Score</div>
                <div className="flex items-center justify-center gap-1.5 mt-0.5 flex-wrap">
                  <span className="text-sm font-black text-purple-600 dark:text-purple-400 leading-tight">
                    {avgWorkJustification.toFixed(1)}
                    <span className="text-[10px] font-normal text-zinc-400">/10</span>
                  </span>
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded leading-none ${
                      avgWorkJustification >= 8.0
                        ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400'
                        : avgWorkJustification >= 6.0
                        ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400'
                        : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {avgWorkJustification >= 8.0
                      ? 'Substantiated'
                      : avgWorkJustification >= 6.0
                      ? 'Partial'
                      : 'Less Accurate'}
                  </span>
                </div>
              </div>
            </div>

            {/* DAILY PERFORMANCE EVALUATION & ACTIONABLE INSIGHTS */}
            <div className="p-5 rounded-2xl bg-zinc-50/80 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 space-y-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-purple-700 dark:text-purple-300">
                <Sparkles className="w-4 h-4 text-purple-500" />
                <span>Daily Performance Evaluation & Actionable Insights</span>
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                Completed {day.tasks.length} task(s) on {day.date}.
              </p>

              {/* Key Accomplishments */}
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-900 dark:text-white">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  <span>Key Accomplishments for the Day:</span>
                </div>
                <ul className="space-y-1.5 pl-5 list-disc text-xs text-zinc-600 dark:text-zinc-400">
                  {dailyAccomplishments.map((acc, idx) => (
                    <li key={idx}>{acc}</li>
                  ))}
                </ul>
              </div>

              {/* Key Areas to Improve & Work On */}
              <div className="space-y-2 pt-2 border-t border-zinc-200/70 dark:border-zinc-700/70">
                <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-900 dark:text-white">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  <span>Key Areas to Improve & Work On:</span>
                </div>
                <ul className="space-y-1.5 pl-5 list-disc text-xs text-zinc-600 dark:text-zinc-400">
                  {dailyImprovements.map((imp, idx) => (
                    <li key={idx}>{imp}</li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Footer Close Button */}
            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors cursor-pointer shadow-xs hover:shadow-md"
              >
                Close Daily Evaluation
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
