'use client';

import React from 'react';
import {
  X,
  Printer,
  Sparkles,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Award,
  RefreshCw,
  BarChart3,
  ExternalLink,
  History,
  Briefcase,
  Bot,
  Zap,
} from 'lucide-react';
import { ZohoUserSummary, buildWeeklyPerformanceReports, WeeklyEvaluationReportItem } from '@/lib/zoho/service';

export interface ZohoWeeklyEvaluationModalProps {
  user: ZohoUserSummary;
  onClose: () => void;
  hideZohoLink?: boolean;
}

export default function ZohoWeeklyEvaluationModal({
  user,
  onClose,
  hideZohoLink = false,
}: ZohoWeeklyEvaluationModalProps) {
  // Generate multi-week performance timeline (starts with this week, past weeks appended)
  const weeklyReports: WeeklyEvaluationReportItem[] = React.useMemo(() => {
    return buildWeeklyPerformanceReports(user);
  }, [user]);

  const thisWeek = weeklyReports[0];
  const appendedPastWeeks = weeklyReports.slice(1);

  // Cumulative numbers that "Add On & Change" across weeks
  const cumulativeDone = user.tillDateSummary?.doneTasks ?? weeklyReports.reduce((sum, w) => sum + w.doneTasks, 0);
  const cumulativePending = user.tillDateSummary?.pendingTasks ?? weeklyReports.reduce((sum, w) => sum + w.inProgressTasks, 0);
  const cumulativeDelayed = user.tillDateSummary?.delayedTasks ?? weeklyReports.reduce((sum, w) => sum + w.delayedTasks, 0);
  const cumulativeTotal = cumulativeDone + cumulativePending + cumulativeDelayed;
  const cumulativeHours = user.tillDateSummary?.totalHoursLogged ?? Math.round(weeklyReports.reduce((sum, w) => sum + w.totalActualHours, 0) * 10) / 10;
  const cumulativePlannedHours = Math.round(weeklyReports.reduce((sum, w) => sum + w.totalPlannedHours, 0) * 10) / 10;
  const cumulativeDonePct = cumulativeTotal > 0 ? Math.round((cumulativeDone / cumulativeTotal) * 100) : 100;
  const cumulativePendingPct = cumulativeTotal > 0 ? Math.round((cumulativePending / cumulativeTotal) * 100) : 0;
  const cumulativeDelayedPct = cumulativeTotal > 0 ? Math.round((cumulativeDelayed / cumulativeTotal) * 100) : 0;

  const totalRepetitiveTasks = weeklyReports.reduce((sum, w) => sum + w.repetitiveCount, 0);
  const cumulativeRepetitivePct = cumulativeTotal > 0 ? Math.round((totalRepetitiveTasks / cumulativeTotal) * 100) : 0;

  const rawScore = user.tillDateSummary?.weeklyAvgScore ?? thisWeek?.overallScore ?? 88;
  const cumulativeScore = rawScore <= 10 ? Math.round(rawScore * 10) : Math.round(rawScore);

  const handlePrint = () => {
    window.print();
  };

  const allTasks = user.dailyEvaluations?.flatMap((d) => d.tasks) || [];

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

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-2 sm:p-3 overflow-y-auto overscroll-contain cursor-pointer animate-in fade-in duration-150"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-5xl xl:max-w-6xl max-h-[92vh] overflow-y-auto shadow-2xl relative my-auto cursor-default flex flex-col"
      >
        {/* Modal Header */}
        <div className="px-3.5 sm:px-4 pt-3.5 pb-2 flex items-start justify-between gap-4 sticky top-0 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md z-10">
          <div>
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-bold bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                <Calendar className="w-3.5 h-3.5" />
                {thisWeek?.label || 'Weekly Evaluation'}
              </span>
              <span className="text-xs font-bold px-2.5 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                {weeklyReports.length} Week{weeklyReports.length === 1 ? '' : 's'} on Record
              </span>
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                {user.name} • {user.role} ({user.seniorityLevel})
              </span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-zinc-900 dark:text-white tracking-tight flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-500 shrink-0" />
              Weekly Performance & Evaluation Report (Cumulative)
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
              Ongoing performance report: completed weeks add on to cumulative velocity metrics and append to this chronological audit.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handlePrint}
              className="text-xs font-bold text-zinc-600 dark:text-zinc-300 hover:text-[#34c4f2] flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print / PDF</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              title="Close report"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="px-3.5 sm:px-4 pb-4 pt-1 space-y-3">
          {/* ======================================================== */}
          {/* SECTION 1: CUMULATIVE 5-METRIC SCORECARD (The 5 Cards)  */}
          {/* ======================================================== */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                <Award className="w-3.5 h-3.5 text-purple-500" />
                Cumulative Performance Scorecard (Add-On Totals)
              </span>
              <span className="text-[11px] text-zinc-400">
                Dynamically calculated across all evaluated weeks
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {/* 1. Done Tasks */}
              <div className="py-2 px-3 rounded-xl bg-white dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-800 shadow-2xs flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-6 h-6 rounded-md bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider truncate">
                    Done Tasks
                  </span>
                </div>
                <span className="text-base font-black text-zinc-900 dark:text-white leading-none shrink-0">
                  {cumulativeDone}
                </span>
              </div>

              {/* 2. In Progress Tasks */}
              <div className="py-2 px-3 rounded-xl bg-white dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-800 shadow-2xs flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-6 h-6 rounded-md bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0">
                    <BarChart3 className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider truncate">
                    In Progress
                  </span>
                </div>
                <span className="text-base font-black text-zinc-900 dark:text-white leading-none shrink-0">
                  {cumulativePending}
                </span>
              </div>

              {/* 3. Delayed Tasks */}
              <div className="py-2 px-3 rounded-xl bg-white dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-800 shadow-2xs flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-6 h-6 rounded-md bg-rose-500/10 text-rose-500 flex items-center justify-center shrink-0">
                    <AlertTriangle className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider truncate">
                    Delayed Tasks
                  </span>
                </div>
                <span className="text-base font-black text-zinc-900 dark:text-white leading-none shrink-0">
                  {cumulativeDelayed}
                </span>
              </div>

              {/* 4. Total Logged Hours */}
              <div className="py-2 px-3 rounded-xl bg-white dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-800 shadow-2xs flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-6 h-6 rounded-md bg-[#34c4f2]/10 text-[#34c4f2] flex items-center justify-center shrink-0">
                    <Zap className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider truncate">
                    Logged Hours
                  </span>
                </div>
                <span className="text-base font-black text-zinc-900 dark:text-white leading-none shrink-0">
                  {cumulativeHours}h
                </span>
              </div>

              {/* 5. Cumulative Overall Score */}
              <div className="col-span-2 md:col-span-1 py-2 px-3 rounded-xl bg-white dark:bg-zinc-800/60 border border-purple-200 dark:border-purple-800 shadow-2xs flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-6 h-6 rounded-md bg-purple-500/10 text-purple-500 flex items-center justify-center shrink-0">
                    <Award className="w-3.5 h-3.5" />
                  </div>
                  <span className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider truncate">
                    Overall Score
                  </span>
                </div>
                <div className="flex items-baseline gap-1 shrink-0">
                  <span className="text-base font-black text-purple-600 dark:text-purple-400 leading-none">
                    {cumulativeScore}
                  </span>
                  <span className="text-[9px] font-bold text-purple-700 dark:text-purple-300">
                    / 100
                  </span>
                </div>
              </div>
            </div>

            {/* Segmented Task Progress Bar (3/5 Done Style) & Repetitive Task Rate */}
            <div className="py-2 px-3 rounded-xl bg-zinc-50/80 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 space-y-1.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-xs">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-zinc-900 dark:text-white text-xs">
                    Cumulative Task Progress: {cumulativeDone} / {cumulativeTotal} Tasks Done
                  </span>
                  <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                    {cumulativeDonePct}% Completed
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    ({cumulativePending} In Progress, {cumulativeDelayed} Delayed past buffer)
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold text-zinc-500">
                    Repetitive Task Rate:
                  </span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 flex items-center gap-1">
                    <RefreshCw className="w-2.5 h-2.5 text-purple-500" />
                    {cumulativeRepetitivePct}% Repetitive
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ======================================================== */}
          {/* SECTION 2: CHRONOLOGICAL APPENDED EVALUATION FEED        */}
          {/* ======================================================== */}
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-100 dark:border-zinc-800">
              <span className="text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
                <History className="w-4 h-4 text-purple-500" />
                Chronological Weekly Evaluation Feed (Appended Week by Week)
              </span>
              <span className="text-[11px] text-zinc-400">
                New weeks append directly below existing evaluations
              </span>
            </div>

            {/* 1. THIS WEEK (CURRENT WEEK) */}
            {thisWeek && (
              <div className="p-3 sm:p-3.5 rounded-xl bg-white dark:bg-zinc-800/80 border-2 border-purple-300 dark:border-purple-700/80 shadow-xs space-y-2.5 relative">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2 border-b border-zinc-100 dark:border-zinc-700">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-purple-600 text-white shadow-xs shrink-0">
                      CURRENT WEEK
                    </span>
                    <h3 className="text-sm sm:text-base font-bold text-zinc-900 dark:text-white shrink-0">
                      {thisWeek.label}
                    </h3>

                    {/* Inline Box 1: Hours Logged */}
                    <div className="py-1 px-2.5 rounded-lg bg-zinc-100 dark:bg-zinc-800/90 border border-zinc-300 dark:border-zinc-700 flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] font-black text-zinc-800 dark:text-zinc-200 uppercase tracking-wider whitespace-nowrap">Hours Logged:</span>
                      <span className="text-xs font-black text-sky-700 dark:text-[#34c4f2] whitespace-nowrap">
                        {thisWeek.totalActualHours}h
                        <span className="text-[10px] text-zinc-700 dark:text-zinc-300 font-bold ml-0.5">/ {thisWeek.totalPlannedHours}h planned</span>
                      </span>
                    </div>

                    {/* Inline Box 2: Completion Velocity */}
                    <div className="py-1 px-2.5 rounded-lg bg-zinc-100 dark:bg-zinc-800/90 border border-zinc-300 dark:border-zinc-700 flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] font-black text-zinc-800 dark:text-zinc-200 uppercase tracking-wider whitespace-nowrap">Completion Velocity:</span>
                      <span className="text-xs font-black text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                        {thisWeek.doneTasks} / {thisWeek.totalTasks}
                        <span className="text-[10px] text-zinc-700 dark:text-zinc-300 font-bold ml-0.5">({thisWeek.donePct}%)</span>
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Week Score:</span>
                    <span className="text-2xl font-black text-purple-600 dark:text-purple-400 leading-none">
                      {thisWeek.overallScore}
                    </span>
                    <span className="text-xs text-zinc-400">/ 100</span>
                  </div>
                </div>

                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Active week audit combining time adherence, comment justification, complexity, and QA verification.
                </p>

                {/* This Week Executive Summary in 2-3 Paragraphs */}
                <div className="space-y-2 pt-1.5 border-t border-zinc-100 dark:border-zinc-700 text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-purple-700 dark:text-purple-300 flex items-center gap-1">
                    <Award className="w-3.5 h-3.5" />
                    Executive Performance Summary (Week {thisWeek.weekNumber})
                  </div>
                  {thisWeek.summaryParagraphs.map((para, idx) => (
                    <p key={idx} className="p-2.5 px-3 rounded-xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200/80 dark:border-zinc-800 leading-normal">
                      {para}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {/* 2. APPENDED PREVIOUS WEEKS (Continuous History Timeline) */}
            {appendedPastWeeks.length > 0 && (
              <div className="space-y-4 pt-2">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-zinc-500">
                  <span>Appended Previous Weeks ({appendedPastWeeks.length})</span>
                  <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800" />
                </div>

                {appendedPastWeeks.map((pw) => (
                  <div
                    key={pw.weekNumber}
                    className="p-3.5 rounded-xl bg-zinc-50/70 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 space-y-2.5"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-zinc-200/70 dark:border-zinc-700/70">
                      <div>
                        <span className="text-sm font-bold text-zinc-900 dark:text-white">
                          {pw.label}
                        </span>
                        <span className="text-xs text-zinc-500 ml-2">
                          • {pw.totalActualHours}h logged • {pw.doneTasks}/{pw.totalTasks} Done ({pw.donePct}%) • {pw.repetitivenessPct}% Repetitive
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300">Week Score:</span>
                        <span className="text-xl font-black text-purple-600 dark:text-purple-400">
                          {pw.overallScore}/100
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                      {pw.summaryParagraphs.map((para, idx) => (
                        <p key={idx} className="p-3 rounded-xl bg-white dark:bg-zinc-900/60 border border-zinc-200/60 dark:border-zinc-800/60">
                          {para}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ======================================================== */}
          {/* SECTION 3: EVALUATED TASK BREAKDOWN TABLE                */}
          {/* ======================================================== */}
          <div className="space-y-3 pt-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
              Evaluated Task Breakdown ({allTasks.length} Tasks Tracked)
            </h4>
            <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-[10px] uppercase font-bold tracking-wider">
                  <tr>
                    <th className="py-2.5 px-4">Task Name</th>
                    <th className="py-2.5 px-3">Project</th>
                    <th className="py-2.5 px-3 text-center">Hours (Act/Plan)</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right">Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {allTasks.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-4 text-center text-zinc-400">
                        No tasks found in selected date period
                      </td>
                    </tr>
                  ) : (
                    allTasks.map((t) => (
                      <tr key={t.id} className="hover:bg-zinc-50/60 dark:hover:bg-zinc-800/40">
                        <td className="py-3 px-4 font-semibold text-zinc-900 dark:text-white">
                          <div className="flex items-center gap-1.5">
                            <span>{t.taskName}</span>
                            {!hideZohoLink && t.zohoLink && (
                              <a
                                href={t.zohoLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-0.5 text-zinc-400 hover:text-[#34c4f2]"
                                title="Open in Zoho"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3 text-zinc-500">{t.projectName}</td>
                        <td className="py-3 px-3 text-center font-bold text-zinc-700 dark:text-zinc-300">
                          {t.actualHours}h / {t.plannedHours}h
                        </td>
                        <td className="py-3 px-3">
                          <span className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-[10px] font-bold">
                            {t.zohoStatus}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right font-black text-purple-600 dark:text-purple-400">
                          {t.evaluation?.overallScore || 'N/A'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-zinc-100 dark:border-zinc-800 flex justify-end bg-zinc-50/50 dark:bg-zinc-900/50 sticky bottom-0">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 text-xs font-bold rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors cursor-pointer shadow-xs"
          >
            Close Weekly Report
          </button>
        </div>
      </div>
    </div>
  );
}

