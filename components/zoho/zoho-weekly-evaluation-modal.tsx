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
  ShieldCheck,
} from 'lucide-react';
import { formatMinutesToClock, formatZohoDurationToClock } from '@/lib/zoho/client';
import { ZohoUserSummary, buildWeeklyPerformanceReports, WeeklyEvaluationReportItem, ZohoTaskItem } from '@/lib/zoho/service';

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
  const cumulativeQAReview = user.tillDateSummary?.qaReviewTasks ?? weeklyReports.reduce((sum, w) => sum + (w.qaReviewTasks || 0), 0);
  const cumulativePending = user.tillDateSummary?.pendingTasks ?? weeklyReports.reduce((sum, w) => sum + w.inProgressTasks, 0);
  const cumulativeDelayed = user.tillDateSummary?.delayedTasks ?? weeklyReports.reduce((sum, w) => sum + w.delayedTasks, 0);
  const cumulativeTotal = cumulativeDone + cumulativeQAReview + cumulativePending;
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

  type PopupCategory = 'DONE' | 'QA_REVIEW' | 'IN_PROGRESS' | 'DELAYED';
  const [popupCategory, setPopupCategory] = React.useState<PopupCategory | null>(null);

  const allTasks: ZohoTaskItem[] = React.useMemo(() => {
    const rawList = (user.allDailyEvaluationsUpToDate || user.dailyEvaluations || []).flatMap((d) => d.tasks || []);
    const seen = new Set<string>();
    const unique: ZohoTaskItem[] = [];
    for (const t of rawList) {
      const key = t.id || t.zohoTaskId || `${t.taskName}-${t.taskDate}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(t);
      }
    }
    return unique.length > 0 ? unique : rawList;
  }, [user]);

  const popupTasks = React.useMemo(() => {
    if (!popupCategory) return [];
    return allTasks.filter((t) => {
      const st = (t.zohoStatus || '').toLowerCase();
      const isClosed = st.includes('closed') || st.includes('completed') || (st.includes('done') && !st.includes('qa'));
      const isQA = Boolean(t.isQAReview || st.includes('qa') || st.includes('review'));
      const isDelayed = t.evaluation?.timeAssessmentLabel === 'OVERDUE';

      if (popupCategory === 'DONE') return isClosed;
      if (popupCategory === 'QA_REVIEW') return isQA;
      if (popupCategory === 'IN_PROGRESS') return !isClosed && !isQA;
      if (popupCategory === 'DELAYED') return isDelayed;
      return false;
    });
  }, [allTasks, popupCategory]);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (popupCategory) {
          setPopupCategory(null);
        } else {
          onClose();
        }
      }
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
  }, [onClose, popupCategory]);

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
          {/* SECTION 1: CUMULATIVE 4-METRIC SCORECARD (Matching Image 2) */}
          {/* ======================================================== */}
          <div className="space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                <Award className="w-4 h-4 text-purple-500" />
                Cumulative Performance Scorecard (Add-On Totals)
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="inline-flex items-center gap-1.5 py-1 px-2.5 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-xs">
                  <Zap className="w-3.5 h-3.5 text-[#34c4f2]" />
                  <span className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Logged Hours</span>
                  <strong className="text-xs font-black text-zinc-900 dark:text-white">{cumulativeHours}h</strong>
                </div>
                <div className="inline-flex items-center gap-1.5 py-1 px-2.5 rounded-lg bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-xs">
                  <Award className="w-3.5 h-3.5 text-purple-500" />
                  <span className="text-[11px] font-semibold text-purple-700 dark:text-purple-300">Overall Score</span>
                  <span className="text-xs font-black text-purple-600 dark:text-purple-400">{cumulativeScore}</span>
                  <span className="text-[10px] text-purple-400">/ 100</span>
                </div>
              </div>
            </div>

            {/* 4 Interactive Status Cards (Exact styling of Image 2) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* 1. Done Tasks */}
              <button
                type="button"
                onClick={() => setPopupCategory('DONE')}
                title={`Click to view all ${cumulativeDone} Done Tasks in a popup`}
                className="py-3 px-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-800/60 shadow-2xs flex items-center justify-between gap-3 cursor-pointer transition-all hover:border-emerald-400 dark:hover:border-emerald-600 hover:bg-emerald-50/30 dark:hover:bg-emerald-950/20 hover:shadow-xs hover:scale-[1.01] active:scale-[0.99] text-left group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-500 flex items-center justify-center shrink-0 border border-emerald-100 dark:border-emerald-900/40 group-hover:scale-105 transition-transform">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider truncate">
                    Done Tasks
                  </span>
                </div>
                <span className="text-2xl font-black text-zinc-900 dark:text-white leading-none shrink-0">
                  {cumulativeDone}
                </span>
              </button>

              {/* 2. In QA Review */}
              <button
                type="button"
                onClick={() => setPopupCategory('QA_REVIEW')}
                title={`Click to view all ${cumulativeQAReview} In QA Review Tasks in a popup`}
                className="py-3 px-4 rounded-2xl border border-blue-200 dark:border-blue-800/80 bg-blue-50/20 dark:bg-blue-950/20 shadow-2xs flex items-center justify-between gap-3 cursor-pointer transition-all hover:border-blue-400 dark:hover:border-blue-600 hover:bg-blue-50/50 dark:hover:bg-blue-950/40 hover:shadow-xs hover:scale-[1.01] active:scale-[0.99] text-left group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-500 flex items-center justify-center shrink-0 border border-blue-200/60 dark:border-blue-800/40 group-hover:scale-105 transition-transform">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider truncate">
                    In QA Review
                  </span>
                </div>
                <span className="text-2xl font-black text-blue-600 dark:text-blue-400 leading-none shrink-0">
                  {cumulativeQAReview}
                </span>
              </button>

              {/* 3. In Progress */}
              <button
                type="button"
                onClick={() => setPopupCategory('IN_PROGRESS')}
                title={`Click to view all ${cumulativePending} In Progress Tasks in a popup`}
                className="py-3 px-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-800/60 shadow-2xs flex items-center justify-between gap-3 cursor-pointer transition-all hover:border-amber-400 dark:hover:border-amber-600 hover:bg-amber-50/30 dark:hover:bg-amber-950/20 hover:shadow-xs hover:scale-[1.01] active:scale-[0.99] text-left group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-500 flex items-center justify-center shrink-0 border border-amber-100 dark:border-amber-900/40 group-hover:scale-105 transition-transform">
                    <BarChart3 className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider truncate">
                    In Progress
                  </span>
                </div>
                <span className="text-2xl font-black text-zinc-900 dark:text-white leading-none shrink-0">
                  {cumulativePending}
                </span>
              </button>

              {/* 4. Delayed Tasks */}
              <button
                type="button"
                onClick={() => setPopupCategory('DELAYED')}
                title={`Click to view all ${cumulativeDelayed} Delayed Tasks in a popup`}
                className="py-3 px-4 rounded-2xl border border-rose-200/80 dark:border-rose-900/60 bg-rose-50/15 dark:bg-rose-950/15 shadow-2xs flex items-center justify-between gap-3 cursor-pointer transition-all hover:border-rose-400 dark:hover:border-rose-600 hover:bg-rose-50/40 dark:hover:bg-rose-950/30 hover:shadow-xs hover:scale-[1.01] active:scale-[0.99] text-left group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-rose-50 dark:bg-rose-950/60 text-rose-500 flex items-center justify-center shrink-0 border border-rose-100 dark:border-rose-900/40 group-hover:scale-105 transition-transform">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider truncate">
                    Delayed Tasks
                  </span>
                </div>
                <span className="text-2xl font-black text-zinc-900 dark:text-white leading-none shrink-0">
                  {cumulativeDelayed}
                </span>
              </button>
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
                    ({cumulativeQAReview} In QA Review, {cumulativePending} In Progress, {cumulativeDelayed} Delayed past buffer)
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

                    {/* Inline Box 2: Tasks Completed */}
                    <div className="py-1 px-2.5 rounded-lg bg-zinc-100 dark:bg-zinc-800/90 border border-zinc-300 dark:border-zinc-700 flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] font-black text-zinc-800 dark:text-zinc-200 uppercase tracking-wider whitespace-nowrap">Tasks Completed:</span>
                      <span className="text-xs font-black text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                        {thisWeek.doneTasks} / {thisWeek.totalTasks}
                        <span className="text-[10px] text-zinc-700 dark:text-zinc-300 font-bold ml-0.5">({thisWeek.donePct}% Closed)</span>
                        {Boolean(thisWeek.qaReviewTasks && thisWeek.qaReviewTasks > 0) && (
                          <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-800 ml-1">
                            {thisWeek.qaReviewTasks} in QA
                          </span>
                        )}
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

                {appendedPastWeeks.map((pw, wIdx) => (
                  <div
                    key={`${pw.year}-W${pw.weekNumber}-${pw.startDate || wIdx}`}
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
          {/* SECTION 3: EVALUATED TASK BREAKDOWN TABLE (ALL TASKS)     */}
          {/* ======================================================== */}
          <div id="evaluated-task-breakdown" className="space-y-3 pt-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Evaluated Task Breakdown ({allTasks.length} Tasks Tracked)
              </h4>
            </div>
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
                      <td colSpan={5} className="py-8 text-center text-zinc-400">
                        <p className="font-semibold text-xs text-zinc-600 dark:text-zinc-400">
                          No tasks recorded for this period.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    allTasks.map((t, tIdx) => (
                      <tr key={`${t.id || t.zohoTaskId || t.taskName}-${t.taskDate || ''}-${tIdx}`} className="hover:bg-zinc-50/60 dark:hover:bg-zinc-800/40">
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
                          {t.actualMinutes != null ? formatMinutesToClock(t.actualMinutes) : formatZohoDurationToClock(t.actualHours)} hrs / {t.plannedMinutes != null ? formatMinutesToClock(t.plannedMinutes) : formatZohoDurationToClock(t.plannedHours)} hrs
                        </td>
                        <td className="py-3 px-3">
                          <span className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-[10px] font-bold">
                            {t.zohoStatus}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right font-black text-purple-600 dark:text-purple-400">
                          {t.evaluation?.overallScore != null ? t.evaluation.overallScore : 'N/A'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>


      {/* ======================================================== */}
      {/* POPUP CARD FOR SELECTED METRIC TASKS                     */}
      {/* ======================================================== */}
      {popupCategory && (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="category-task-popup"
          className="fixed inset-0 z-60 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 md:p-6"
          onClick={() => setPopupCategory(null)}
        >
          <div
            className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Popup Header */}
            <div className="p-4 md:p-5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between gap-3 bg-zinc-50/80 dark:bg-zinc-800/50">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  popupCategory === 'DONE' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
                  popupCategory === 'QA_REVIEW' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' :
                  popupCategory === 'IN_PROGRESS' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' :
                  'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                }`}>
                  {popupCategory === 'DONE' && <CheckCircle2 className="w-5 h-5" />}
                  {popupCategory === 'QA_REVIEW' && <ShieldCheck className="w-5 h-5" />}
                  {popupCategory === 'IN_PROGRESS' && <BarChart3 className="w-5 h-5" />}
                  {popupCategory === 'DELAYED' && <AlertTriangle className="w-5 h-5" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-black text-zinc-900 dark:text-white">
                      {popupCategory === 'DONE' ? 'Done Tasks' :
                       popupCategory === 'QA_REVIEW' ? 'In QA Review Tasks' :
                       popupCategory === 'IN_PROGRESS' ? 'In Progress Tasks' :
                       'Delayed Tasks'}
                    </h3>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-black ${
                      popupCategory === 'DONE' ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800' :
                      popupCategory === 'QA_REVIEW' ? 'bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800' :
                      popupCategory === 'IN_PROGRESS' ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800' :
                      'bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                    }`}>
                      {popupTasks.length} {popupTasks.length === 1 ? 'Task' : 'Tasks'}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                    {popupCategory === 'DONE' && 'All completed and closed tasks across cumulative evaluation history.'}
                    {popupCategory === 'QA_REVIEW' && 'Tasks currently submitted for quality assurance or code review.'}
                    {popupCategory === 'IN_PROGRESS' && 'Active or backlog tasks currently in development.'}
                    {popupCategory === 'DELAYED' && 'Tasks evaluated as overdue past allowed pacing tolerances.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPopupCategory(null)}
                className="p-2 rounded-xl text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Popup Table */}
            <div className="p-4 md:p-6 overflow-y-auto max-h-[60vh]">
              {popupTasks.length === 0 ? (
                <div className="py-12 text-center text-zinc-400 dark:text-zinc-500">
                  <p className="font-semibold text-sm">No tasks found in this category.</p>
                </div>
              ) : (
                <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-2xs">
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
                      {popupTasks.map((t, tIdx) => (
                        <tr key={`${t.id || t.zohoTaskId || t.taskName}-${t.taskDate || ''}-${tIdx}`} className="hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40 transition-colors">
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
                            {t.actualMinutes != null ? formatMinutesToClock(t.actualMinutes) : formatZohoDurationToClock(t.actualHours)} hrs / {t.plannedMinutes != null ? formatMinutesToClock(t.plannedMinutes) : formatZohoDurationToClock(t.plannedHours)} hrs
                          </td>
                          <td className="py-3 px-3">
                            <span className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-[10px] font-bold">
                              {t.zohoStatus}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-right font-black text-purple-600 dark:text-purple-400">
                            {t.evaluation?.overallScore != null ? t.evaluation.overallScore : 'N/A'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Popup Footer */}
            <div className="p-3 px-5 border-t border-zinc-100 dark:border-zinc-800 flex justify-end bg-zinc-50/50 dark:bg-zinc-900/50">
              <button
                type="button"
                data-testid="close-popup-card-btn"
                onClick={() => setPopupCategory(null)}
                className="px-5 py-2 text-xs font-bold rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

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

