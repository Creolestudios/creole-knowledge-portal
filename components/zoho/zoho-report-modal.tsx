'use client';

import React, { useState } from 'react';
import { X, Printer, Award, Clock, CheckCircle2, AlertTriangle, FileText, Bot, Users, BarChart3, RefreshCw } from 'lucide-react';
import { formatMinutesToClock, formatZohoDurationToClock } from '@/lib/zoho/client';
import { ZohoUserSummary } from '@/lib/zoho/service';

export interface PeriodCapacityInfo {
  capacityHours: number;
  weeksCount: number;
  workingDaysCount: number;
  label: string;
}

/**
 * Calculates standard full-time capacity hours for a given period:
 * - 1 week: 40 hours (5 working days x 8h/day)
 * - Custom range: Number of full/partial calendar weeks spanned x 40h/week (or 8h/working day)
 * - Month: Working days x 8h/day (or ~160h standard 4-week capacity)
 */
export function calculatePeriodCapacity(
  filterType: string,
  dateRangeText?: string,
  startDate?: string,
  endDate?: string
): PeriodCapacityInfo {
  // 1. Explicit weekly filter: exactly 1 full week = 40h standard capacity
  if (filterType === 'week') {
    return {
      capacityHours: 40,
      weeksCount: 1,
      workingDaysCount: 5,
      label: '1 full week × 40h/week = 40h capacity',
    };
  }

  // 2. Parse dates if not passed directly
  let start = startDate;
  let end = endDate;

  if ((!start || !end) && dateRangeText) {
    // Check for DD-MM-YYYY (e.g. "20-10-2026 to 05-11-2026")
    const ddmmyyyyMatches = dateRangeText.match(/(\d{2})[-/](\d{2})[-/](\d{4})/g);
    if (ddmmyyyyMatches && ddmmyyyyMatches.length >= 2) {
      const toIso = (s: string) => {
        const parts = s.split(/[-/]/);
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
      };
      start = toIso(ddmmyyyyMatches[0]);
      end = toIso(ddmmyyyyMatches[1]);
    } else {
      const yyyymmddMatches = dateRangeText.match(/(\d{4})[-/](\d{2})[-/](\d{2})/g);
      if (yyyymmddMatches && yyyymmddMatches.length >= 2) {
        start = yyyymmddMatches[0];
        end = yyyymmddMatches[1];
      }
    }
  }

  // 3. Explicit monthly filter
  if (filterType === 'month') {
    if (start && end) {
      const s = new Date(start);
      const e = new Date(end);
      if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime())) {
        let workDays = 0;
        const cur = new Date(s);
        while (cur <= e) {
          const dayOfWeek = cur.getDay();
          if (dayOfWeek !== 0 && dayOfWeek !== 6) workDays++;
          cur.setDate(cur.getDate() + 1);
        }
        const cap = workDays * 8;
        return {
          capacityHours: cap,
          weeksCount: Math.max(1, Math.round(workDays / 5)),
          workingDaysCount: workDays,
          label: `${workDays} working days @ 8h/day = ${cap}h capacity`,
        };
      }
    }
    return {
      capacityHours: 160,
      weeksCount: 4,
      workingDaysCount: 20,
      label: '4 full weeks × 40h/week = 160h capacity',
    };
  }

  // 4. Custom range or general calculation
  if (start && end) {
    const s = new Date(start);
    const e = new Date(end);
    if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime())) {
      let workDays = 0;
      const cur = new Date(s);
      while (cur <= e) {
        const dayOfWeek = cur.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) workDays++;
        cur.setDate(cur.getDate() + 1);
      }

      // Monday of start week
      const startDay = s.getDay();
      const diffToMonday = startDay === 0 ? -6 : 1 - startDay;
      const startMonday = new Date(s);
      startMonday.setDate(s.getDate() + diffToMonday);
      startMonday.setHours(0, 0, 0, 0);

      // Sunday of end week
      const endDay = e.getDay();
      const diffToSunday = endDay === 0 ? 0 : 7 - endDay;
      const endSunday = new Date(e);
      endSunday.setDate(e.getDate() + diffToSunday);
      endSunday.setHours(23, 59, 59, 999);

      const daysSpanned = Math.round((endSunday.getTime() - startMonday.getTime()) / (24 * 60 * 60 * 1000));
      const weeksCount = Math.max(1, Math.round(daysSpanned / 7));
      const capacityHours = weeksCount * 40;

      return {
        capacityHours,
        weeksCount,
        workingDaysCount: workDays,
        label: `${weeksCount} full week${weeksCount > 1 ? 's' : ''} × 40h/week = ${capacityHours}h capacity`,
      };
    }
  }

  return {
    capacityHours: 40,
    weeksCount: 1,
    workingDaysCount: 5,
    label: '1 full week × 40h/week = 40h capacity',
  };
}

interface ZohoReportModalProps {
  isOpen?: boolean;
  user?: ZohoUserSummary | null;
  users?: ZohoUserSummary[];
  filterType: string;
  dateRangeText?: string;
  startDate?: string;
  endDate?: string;
  onClose: () => void;
}

export default function ZohoReportModal({
  isOpen = true,
  user,
  users = [],
  filterType,
  dateRangeText,
  startDate,
  endDate,
  onClose,
}: ZohoReportModalProps) {
  // If multiple users passed, allow selecting one to drill down, or default to all
  const [activeDrilldownUser, setActiveDrilldownUser] = useState<ZohoUserSummary | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;
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
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Resolve target users
  const effectiveUsers: ZohoUserSummary[] =
    users && users.length > 0 ? users : user ? [user] : [];

  if (effectiveUsers.length === 0) return null;

  const isMultiUser = effectiveUsers.length > 1;
  const singleUser = isMultiUser ? (activeDrilldownUser || null) : effectiveUsers[0];

  const handlePrint = () => {
    window.print();
  };

  // Aggregate stats for multi-user report
  const totalTasksDone = effectiveUsers.reduce((sum, u) => {
    const tasks = u.dailyEvaluations?.flatMap((d) => d.tasks) || [];
    if (tasks.length > 0) {
      return sum + tasks.filter((t) => {
        const s = (t.zohoStatus || '').toLowerCase();
        return s.includes('closed') || s.includes('completed') || (s.includes('done') && !s.includes('qa'));
      }).length;
    }
    return sum + (u.filterSummary?.doneTasks ?? u.tillDateSummary?.doneTasks ?? 0);
  }, 0);

  const totalTasksPending = effectiveUsers.reduce((sum, u) => {
    const tasks = u.dailyEvaluations?.flatMap((d) => d.tasks) || [];
    if (tasks.length > 0) {
      return sum + tasks.filter((t) => {
        const s = (t.zohoStatus || '').toLowerCase();
        const isClosed = s.includes('closed') || s.includes('completed') || (s.includes('done') && !s.includes('qa'));
        const isQA = t.isQAReview || s.includes('qa') || s.includes('review');
        return !isClosed && !isQA;
      }).length;
    }
    return sum + (u.filterSummary?.pendingTasks ?? u.tillDateSummary?.pendingTasks ?? 0);
  }, 0);

  const totalTasksDelayed = effectiveUsers.reduce((sum, u) => {
    const tasks = u.dailyEvaluations?.flatMap((d) => d.tasks) || [];
    if (tasks.length > 0) {
      return sum + tasks.filter((t) => t.evaluation?.timeAssessmentLabel === 'OVERDUE').length;
    }
    return sum + (u.filterSummary?.delayedTasks ?? u.tillDateSummary?.delayedTasks ?? 0);
  }, 0);

  const totalHoursLogged = Math.round(effectiveUsers.reduce((sum, u) => {
    const tasks = u.dailyEvaluations?.flatMap((d) => d.tasks) || [];
    if (tasks.length > 0) {
      return sum + tasks.reduce((s, t) => s + (Number(t.actualHours) || 0), 0);
    }
    return sum + (u.filterSummary?.totalHoursLogged ?? u.tillDateSummary?.totalHoursLogged ?? 0);
  }, 0) * 10) / 10;

  const avgTeamScore = Math.round(
    effectiveUsers.reduce((sum, u) => {
      const tasks = u.dailyEvaluations?.flatMap((d) => d.tasks) || [];
      if (tasks.length > 0) {
        const scored = tasks.filter((t) => t.evaluation?.overallScore != null);
        if (scored.length > 0) {
          const avg = scored.reduce((s, t) => s + (Number(t.evaluation?.overallScore) || 0), 0) / scored.length;
          return sum + (avg <= 10 ? Math.round(avg * 10) : Math.round(avg));
        }
      }
      return sum + (u.filterSummary?.weeklyAvgScore ?? u.tillDateSummary?.weeklyAvgScore ?? 85);
    }, 0) / (effectiveUsers.length || 1)
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs overscroll-contain animate-in fade-in duration-200 cursor-pointer"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-5xl xl:max-w-6xl max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col cursor-default"
      >
        {/* Header */}
        <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between sticky top-0 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-sm z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#34c4f2]/10 text-[#34c4f2] flex items-center justify-center">
              {isMultiUser ? <Users className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-900 dark:text-white">
                {isMultiUser ? 'Team Evaluation & Performance Report' : 'Employee Evaluation Report'}
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {isMultiUser
                  ? `Generated for ${effectiveUsers.length} Employees • Period: ${filterType.toUpperCase()}${dateRangeText ? ` (${dateRangeText})` : ''}`
                  : `Generated for ${singleUser?.name || singleUser?.email} (${singleUser?.role}) • Period: ${filterType.toUpperCase()}${dateRangeText ? ` (${dateRangeText})` : ''}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="text-xs font-bold text-zinc-600 dark:text-zinc-300 hover:text-[#34c4f2] dark:hover:text-[#34c4f2] flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print / PDF</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Report Body */}
        <div className="p-8 space-y-6 text-zinc-900 dark:text-zinc-100 print:text-black">
          {/* Multi-User View */}
          {isMultiUser && !singleUser && (
            <>
              {/* Executive Team Scorecard */}
              <div className="p-6 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                <div>
                  <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Avg Team Score</span>
                  <div className="text-3xl font-black text-purple-600 dark:text-purple-400 mt-1">
                    {avgTeamScore}
                  </div>
                  <span className="text-[10px] text-zinc-400">out of 100</span>
                </div>
                <div>
                  <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Completed Tasks</span>
                  <div className="text-3xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
                    {totalTasksDone}
                  </div>
                  <span className="text-[10px] text-zinc-400 font-semibold">{totalTasksPending} pending</span>
                </div>
                <div>
                  <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Total Hours Logged</span>
                  <div className="text-3xl font-black text-[#34c4f2] mt-1">
                    {totalHoursLogged}h
                  </div>
                  <span className="text-[10px] text-zinc-400">across {effectiveUsers.length} users</span>
                </div>
                <div>
                  <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Delayed Tasks</span>
                  <div className="text-3xl font-black text-rose-500 mt-1">
                    {totalTasksDelayed}
                  </div>
                  <span className="text-[10px] text-rose-400 font-bold">past tolerance</span>
                </div>
              </div>

              {/* Team Executive Summary */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                  <Award className="w-3.5 h-3.5 text-purple-500" />
                  Team Executive Summary
                </h4>
                <div className="p-4 rounded-xl bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200/60 dark:border-purple-900/30 text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">
                  {avgTeamScore >= 80
                    ? `The team delivered solid performance with an average evaluation score of ${avgTeamScore}/100. A total of ${totalTasksDone} tasks were successfully completed with ${totalHoursLogged} hours logged. Engineering discipline and adherence to Zoho estimation targets remained steady.`
                    : `Team evaluation score is at ${avgTeamScore}/100 with ${totalTasksDelayed} tasks encountering schedule variance. Recommend reviewing task estimation buffers and workload distribution across developers.`}
                </div>
              </div>

              {/* User Breakdown Table */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center justify-between">
                  <span>Selected Employees ({effectiveUsers.length})</span>
                  <span className="text-[11px] font-normal text-zinc-400">Click any user to inspect their tasks</span>
                </h4>
                <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 text-[10px] uppercase font-bold tracking-wider">
                      <tr>
                        <th className="py-2.5 px-4">User Email</th>
                        <th className="py-2.5 px-3">Role</th>
                        <th className="py-2.5 px-3 text-center">Score</th>
                        <th className="py-2.5 px-3 text-center">Done</th>
                        <th className="py-2.5 px-3 text-center">Delay</th>
                        <th className="py-2.5 px-3 text-center">Hours</th>
                        <th className="py-2.5 px-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {effectiveUsers.map((u) => {
                        const uTasks = u.dailyEvaluations?.flatMap((d) => d.tasks) || [];
                        const uDone = uTasks.length > 0
                          ? uTasks.filter((t) => {
                              const s = (t.zohoStatus || '').toLowerCase();
                              return s.includes('closed') || s.includes('completed') || (s.includes('done') && !s.includes('qa'));
                            }).length
                          : (u.filterSummary?.doneTasks ?? u.tillDateSummary?.doneTasks ?? 0);
                        const uDelayed = uTasks.length > 0
                          ? uTasks.filter((t) => t.evaluation?.timeAssessmentLabel === 'OVERDUE').length
                          : (u.filterSummary?.delayedTasks ?? u.tillDateSummary?.delayedTasks ?? 0);
                        const uHours = uTasks.length > 0
                          ? Math.round(uTasks.reduce((s, t) => s + (Number(t.actualHours) || 0), 0) * 10) / 10
                          : (u.filterSummary?.totalHoursLogged ?? u.tillDateSummary?.totalHoursLogged ?? 0);
                        const uScore = (() => {
                          if (uTasks.length > 0) {
                            const scored = uTasks.filter((t) => t.evaluation?.overallScore != null);
                            if (scored.length > 0) {
                              const avg = scored.reduce((sum, t) => sum + (Number(t.evaluation?.overallScore) || 0), 0) / scored.length;
                              return avg <= 10 ? Math.round(avg * 10) : Math.round(avg);
                            }
                          }
                          return u.filterSummary?.weeklyAvgScore ?? u.tillDateSummary?.weeklyAvgScore ?? 85;
                        })();

                        return (
                          <tr
                            key={u.userId}
                            onClick={() => setActiveDrilldownUser(u)}
                            className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors"
                          >
                            <td className="py-3 px-4 font-semibold text-zinc-900 dark:text-white">
                              {u.email}
                            </td>
                            <td className="py-3 px-3 text-zinc-500">{u.role}</td>
                            <td className="py-3 px-3 text-center font-bold text-purple-600 dark:text-purple-400">
                              {uScore}
                            </td>
                            <td className="py-3 px-3 text-center text-emerald-600 font-bold">
                              {uDone}
                            </td>
                            <td className="py-3 px-3 text-center text-rose-500 font-bold">
                              {uDelayed}
                            </td>
                            <td className="py-3 px-3 text-center font-bold text-[#34c4f2]">
                              {uHours}h
                            </td>
                            <td className="py-3 px-3 text-right">
                              <span className="text-[11px] font-bold text-[#34c4f2] hover:underline">
                                Inspect Tasks →
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* Single User or Active Drilldown User View */}
          {singleUser && (
            <>
              {isMultiUser && (
                <button
                  type="button"
                  onClick={() => setActiveDrilldownUser(null)}
                  className="text-xs font-bold text-[#34c4f2] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  ← Back to Team Summary ({effectiveUsers.length} Users)
                </button>
              )}

              {/* Performance Reports - Scoped to Selected Date Range / Month / Week */}
              {(() => {
                const isWeeklyFilter = filterType === 'week';
                const periodBadge = filterType === 'month' ? 'MONTHLY EVALUATION' : filterType === 'range' ? 'CUSTOM RANGE EVALUATION' : 'WEEKLY EVALUATION';
                const periodTitle = dateRangeText ? `Evaluation Report: ${dateRangeText}` : `${periodBadge}`;

                const allPeriodTasks = singleUser.dailyEvaluations?.flatMap((d) => d.tasks) || [];

                const periodDoneTasks = allPeriodTasks.length > 0
                  ? allPeriodTasks.filter((t) => {
                      const s = (t.zohoStatus || '').toLowerCase();
                      return s.includes('closed') || s.includes('completed') || (s.includes('done') && !s.includes('qa'));
                    }).length
                  : (singleUser.filterSummary?.doneTasks ?? 0);

                const periodQATasks = allPeriodTasks.length > 0
                  ? allPeriodTasks.filter((t) => {
                      const s = (t.zohoStatus || '').toLowerCase();
                      return !s.includes('closed') && !s.includes('completed') && (t.isQAReview || s.includes('qa') || s.includes('review'));
                    }).length
                  : (singleUser.filterSummary?.qaReviewTasks ?? 0);

                const periodPendingTasks = allPeriodTasks.length > 0
                  ? allPeriodTasks.filter((t) => {
                      const s = (t.zohoStatus || '').toLowerCase();
                      const isClosed = s.includes('closed') || s.includes('completed') || (s.includes('done') && !s.includes('qa'));
                      const isQA = t.isQAReview || s.includes('qa') || s.includes('review');
                      return !isClosed && !isQA;
                    }).length
                  : (singleUser.filterSummary?.pendingTasks ?? 0);

                const periodDelayedTasks = allPeriodTasks.length > 0
                  ? allPeriodTasks.filter((t) => t.evaluation?.timeAssessmentLabel === 'OVERDUE').length
                  : (singleUser.filterSummary?.delayedTasks ?? 0);

                const periodTotalTasks = allPeriodTasks.length > 0
                  ? allPeriodTasks.length
                  : (periodDoneTasks + periodQATasks + periodPendingTasks);

                const periodActualHours = allPeriodTasks.length > 0
                  ? Math.round(allPeriodTasks.reduce((s, t) => s + (Number(t.actualHours) || 0), 0) * 10) / 10
                  : (singleUser.filterSummary?.totalHoursLogged ?? 0);

                const periodCapacityInfo = calculatePeriodCapacity(filterType, dateRangeText, startDate, endDate);
                const periodPlannedHours = periodCapacityInfo.capacityHours;
                const periodTaskEstimates = allPeriodTasks.length > 0
                  ? Math.round(allPeriodTasks.reduce((s, t) => s + (Number(t.plannedHours) || 0), 0) * 10) / 10
                  : 0;

                const periodDonePct = periodTotalTasks > 0 ? Math.min(100, Math.round((periodDoneTasks / periodTotalTasks) * 100)) : 100;

                let periodOverallScore = 88;
                if (allPeriodTasks.length > 0) {
                  const scoredTasks = allPeriodTasks.filter((t) => t.evaluation?.overallScore != null);
                  if (scoredTasks.length > 0) {
                    const avgScore = scoredTasks.reduce((sum, t) => sum + (Number(t.evaluation?.overallScore) || 0), 0) / scoredTasks.length;
                    periodOverallScore = avgScore <= 10 ? Math.round(avgScore * 10) : Math.round(avgScore);
                  } else if (singleUser.filterSummary?.weeklyAvgScore != null) {
                    periodOverallScore = singleUser.filterSummary.weeklyAvgScore;
                  }
                } else if (singleUser.filterSummary?.weeklyAvgScore != null) {
                  periodOverallScore = singleUser.filterSummary.weeklyAvgScore;
                }

                const documentedTasksCount = allPeriodTasks.filter((t) => t.comments && t.comments.length > 0).length;
                const capacityUtilizationPct = Math.round((periodActualHours / (periodPlannedHours || 1)) * 100);

                const summaryParagraphs = [
                  `During the evaluated period (${dateRangeText || filterType.toUpperCase()}), ${singleUser.name || singleUser.email} logged ${periodActualHours}h out of ${periodPlannedHours}h standard planned capacity (${capacityUtilizationPct}% capacity utilization) across ${periodTotalTasks} task(s). ${periodDoneTasks} task(s) were successfully completed, while ${periodDelayedTasks} task(s) encountered schedule variance past the permitted tolerance buffer. Overall performance velocity attained ${periodOverallScore}/100.`,
                  `Audit of technical work evidence shows that ${documentedTasksCount} of ${allPeriodTasks.length || 1} task(s) have documented comments in Zoho Projects. Logging clear implementation details and test verification notes before task closure provides traceability and validates actual logged time against initial estimates.`,
                  `Recommendations for ${singleUser.name || 'this developer'} (${singleUser.role || 'Developer'}${singleUser.seniorityLevel ? ` • ${singleUser.seniorityLevel}` : ''}): ${singleUser.aiSubscriptions && singleUser.aiSubscriptions.length > 0 ? `Actively leverage subscribed AI tools (${singleUser.aiSubscriptions.join(', ')}) to assist with test verification and automated documentation.` : 'Incorporate automated test validation prior to task completion.'} Maintain close estimation fidelity within the +5m buffer to prevent overdue flags.`,
                ];

                return (
                  <div className="space-y-6">
                    {/* PERIOD PERFORMANCE REPORT */}
                    <div className="p-6 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-200 dark:border-zinc-700">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="px-2.5 py-0.5 rounded-md text-xs font-bold bg-[#34c4f2]/10 text-[#34c4f2] border border-[#34c4f2]/20">
                              {periodBadge}
                            </span>
                            <h4 className="text-sm font-bold text-zinc-900 dark:text-white">
                              {periodTitle}
                            </h4>
                          </div>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                            Performance audit combining time adherence, comment verification, and task completion
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Overall Score:</span>
                          <span className="text-2xl font-black text-purple-600 dark:text-purple-400">
                            {periodOverallScore}
                          </span>
                          <span className="text-xs text-zinc-400">/ 100</span>
                        </div>
                      </div>

                      {/* Metrics Row: Hours, Tasks Completed, Delayed Tasks */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="p-3.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 flex flex-col justify-between">
                          <div>
                            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Hours Logged</span>
                            <div className="text-xl font-black text-[#34c4f2] mt-0.5">
                              {periodActualHours}h
                              {periodPlannedHours > 0 && (
                                <span className="text-xs text-zinc-400 font-normal"> / {periodPlannedHours}h planned</span>
                              )}
                            </div>
                          </div>
                          <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1.5 pt-1.5 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between">
                            <span className="truncate">{periodCapacityInfo.label}</span>
                            {periodTaskEstimates > 0 && (
                              <span className="text-zinc-400 shrink-0 ml-1.5" title="Sum of individual Zoho task initial estimates">
                                Est: {periodTaskEstimates}h
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="p-3.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 flex flex-col justify-between">
                          <div>
                            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Tasks Completed</span>
                            <div className="text-xl font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
                              {periodDoneTasks} / {periodTotalTasks}
                              <span className="text-xs text-zinc-400 font-normal"> ({periodDonePct}%)</span>
                            </div>
                          </div>
                          <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1.5 pt-1.5 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between">
                            <span className="truncate">{periodDoneTasks} Completed of {periodTotalTasks} Given</span>
                            {periodQATasks > 0 && (
                              <span className="text-blue-500 font-medium shrink-0 ml-1">({periodQATasks} in QA)</span>
                            )}
                          </div>
                        </div>

                        <div className="p-3.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 flex flex-col justify-between">
                          <div>
                            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Delayed Tasks</span>
                            <div className="text-xl font-black text-rose-500 mt-0.5">
                              {periodDelayedTasks}
                              <span className="text-xs text-zinc-400 font-normal"> of {periodTotalTasks} tasks</span>
                            </div>
                          </div>
                          <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1.5 pt-1.5 border-t border-zinc-100 dark:border-zinc-800/80">
                            <span className="truncate">
                              {periodDelayedTasks > 0 ? `${periodDelayedTasks} exceeded time buffer` : 'All tasks delivered on time'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Segmented Task Progress Bar */}
                      <div className="space-y-1.5 pt-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                            <BarChart3 className="w-3.5 h-3.5 text-emerald-500" />
                            Task Breakdown: {periodDoneTasks} Done • {periodQATasks} In QA Review • {periodPendingTasks} In Progress • {periodDelayedTasks} Delayed
                          </span>
                          <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                            {periodDonePct}% Completed
                          </span>
                        </div>
                        <div className="w-full h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden flex">
                          {periodDonePct > 0 && (
                            <div style={{ width: `${periodDonePct}%` }} className="bg-emerald-500 h-full transition-all" />
                          )}
                          {periodQATasks > 0 && (
                            <div
                              style={{ width: `${Math.round((periodQATasks / (periodTotalTasks || 1)) * 100)}%` }}
                              className="bg-blue-500 h-full transition-all"
                            />
                          )}
                          {periodPendingTasks > 0 && (
                            <div
                              style={{ width: `${Math.round((periodPendingTasks / (periodTotalTasks || 1)) * 100)}%` }}
                              className="bg-amber-400 h-full transition-all"
                            />
                          )}
                          {periodDelayedTasks > 0 && (
                            <div
                              style={{ width: `${Math.round((periodDelayedTasks / (periodTotalTasks || 1)) * 100)}%` }}
                              className="bg-rose-500 h-full transition-all"
                            />
                          )}
                        </div>
                      </div>

                      {/* Full Executive Summary in 2-3 Paragraphs */}
                      <div className="space-y-2 pt-2 border-t border-zinc-200 dark:border-zinc-700 text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400 flex items-center gap-1">
                          <Award className="w-3.5 h-3.5" />
                          Executive Performance Summary ({dateRangeText || filterType.toUpperCase()})
                        </div>
                        {summaryParagraphs.map((para, idx) => (
                          <p key={idx} className="p-3 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-800">
                            {para}
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Daily Hours Spent Breakdown */}
              {(() => {
                const allPeriodTasks = singleUser.dailyEvaluations?.flatMap((d) => d.tasks) || [];
                const dailyList = (() => {
                  if (singleUser.dailyEvaluations && singleUser.dailyEvaluations.length > 0) {
                    return [...singleUser.dailyEvaluations].sort((a, b) => b.date.localeCompare(a.date));
                  }
                  const dayMap = new Map<string, typeof allPeriodTasks>();
                  for (const t of allPeriodTasks) {
                    const d = t.taskDate || 'Undated';
                    if (!dayMap.has(d)) dayMap.set(d, []);
                    dayMap.get(d)!.push(t);
                  }
                  return Array.from(dayMap.entries())
                    .map(([date, tasks]) => {
                      const scoreSum = tasks.reduce((sum, it) => sum + (it.evaluation?.overallScore || 0), 0);
                      const dayScore = tasks.length > 0 ? Math.round((scoreSum / tasks.length) * 10) / 10 : 8.5;
                      return {
                        date,
                        dayScore,
                        summary: `Completed ${tasks.length} task(s) on ${date}`,
                        tasks,
                      };
                    })
                    .sort((a, b) => b.date.localeCompare(a.date));
                })();

                const periodActualHours = allPeriodTasks.length > 0
                  ? Math.round(allPeriodTasks.reduce((s, t) => s + (Number(t.actualHours) || 0), 0) * 10) / 10
                  : (singleUser.filterSummary?.totalHoursLogged ?? 0);

                const periodCap = calculatePeriodCapacity(filterType, dateRangeText, startDate, endDate);
                const periodTotalTasks = allPeriodTasks.length > 0
                  ? allPeriodTasks.length
                  : (singleUser.filterSummary?.doneTasks ?? 0) + (singleUser.filterSummary?.pendingTasks ?? 0);

                let periodScore = 88;
                if (allPeriodTasks.length > 0) {
                  const scoredTasks = allPeriodTasks.filter((t) => t.evaluation?.overallScore != null);
                  if (scoredTasks.length > 0) {
                    const avgScore = scoredTasks.reduce((sum, t) => sum + (Number(t.evaluation?.overallScore) || 0), 0) / scoredTasks.length;
                    periodScore = avgScore <= 10 ? Math.round(avgScore * 10) : Math.round(avgScore);
                  } else if (singleUser.filterSummary?.weeklyAvgScore != null) {
                    periodScore = singleUser.filterSummary.weeklyAvgScore;
                  }
                } else if (singleUser.filterSummary?.weeklyAvgScore != null) {
                  periodScore = singleUser.filterSummary.weeklyAvgScore;
                }

                return (
                  <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-[#34c4f2]" />
                        Daily Hours Spent Breakdown ({dailyList.length} Active Days)
                      </h4>
                      <span className="text-[11px] text-zinc-500 dark:text-zinc-400 font-medium">
                        Daily Standard Capacity: <strong className="text-zinc-700 dark:text-zinc-300">8.0h / day</strong> ({periodCap.label})
                      </span>
                    </div>

                    <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden bg-white dark:bg-zinc-900 shadow-2xs">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-zinc-100 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-400 text-[10px] uppercase font-bold tracking-wider">
                            <tr>
                              <th className="py-2.5 px-4">Date</th>
                              <th className="py-2.5 px-3 text-center">Hours Spent</th>
                              <th className="py-2.5 px-3 text-center">Daily Capacity (8h)</th>
                              <th className="py-2.5 px-3">Progress</th>
                              <th className="py-2.5 px-3 text-center">Tasks</th>
                              <th className="py-2.5 px-3 text-right">Day Score</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                            {dailyList.length === 0 ? (
                              <tr>
                                <td colSpan={6} className="py-4 text-center text-zinc-400">
                                  No daily activity recorded for this period
                                </td>
                              </tr>
                            ) : (
                              dailyList.map((day) => {
                                const dayHours = Math.round(day.tasks.reduce((sum, t) => sum + (Number(t.actualHours) || 0), 0) * 10) / 10;
                                const dayTarget = 8.0;
                                const dayPct = Math.round((dayHours / dayTarget) * 100);
                                const dayVariance = Math.round((dayHours - dayTarget) * 10) / 10;
                                const isOvertime = dayVariance > 0;
                                const isUndertime = dayVariance < -0.5;

                                const dateObj = new Date(day.date);
                                const dateLabel = !Number.isNaN(dateObj.getTime())
                                  ? dateObj.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
                                  : day.date;

                                return (
                                  <tr key={day.date} className="hover:bg-zinc-50/70 dark:hover:bg-zinc-800/40 transition-colors">
                                    <td className="py-3 px-4 font-bold text-zinc-900 dark:text-white whitespace-nowrap">
                                      <div>{dateLabel}</div>
                                      <div className="text-[10px] font-normal text-zinc-400">{day.date}</div>
                                      <div className="text-[10px] text-zinc-500 dark:text-zinc-400 font-normal mt-0.5 line-clamp-1 max-w-[280px]">
                                        {day.tasks.map((t) => t.taskName).join(' • ')}
                                      </div>
                                    </td>
                                    <td className="py-3 px-3 text-center whitespace-nowrap">
                                      <span className="font-black text-sm text-[#34c4f2]">{dayHours}h</span>
                                      <span className="text-[10px] text-zinc-400 font-normal"> spent</span>
                                    </td>
                                    <td className="py-3 px-3 text-center whitespace-nowrap">
                                      <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                                        {dayHours} / {dayTarget}h
                                      </span>
                                      <div className={`text-[10px] font-bold ${
                                        isOvertime
                                          ? 'text-amber-500'
                                          : isUndertime
                                          ? 'text-zinc-400'
                                          : 'text-emerald-500'
                                      }`}>
                                        {isOvertime ? `+${dayVariance}h overtime` : isUndertime ? `${dayVariance}h undertime` : 'Target reached (8h)'}
                                      </div>
                                    </td>
                                    <td className="py-3 px-3 min-w-[140px]">
                                      <div className="flex items-center gap-2">
                                        <div className="flex-1 h-2 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
                                          <div
                                            style={{ width: `${Math.min(100, dayPct)}%` }}
                                            className={`h-full rounded-full transition-all ${
                                              dayPct >= 100
                                                ? 'bg-emerald-500'
                                                : dayPct >= 75
                                                ? 'bg-[#34c4f2]'
                                                : dayPct >= 50
                                                ? 'bg-amber-400'
                                                : 'bg-rose-400'
                                            }`}
                                          />
                                        </div>
                                        <span className="text-[11px] font-bold text-zinc-600 dark:text-zinc-300 shrink-0 w-9 text-right">
                                          {dayPct}%
                                        </span>
                                      </div>
                                    </td>
                                    <td className="py-3 px-3 text-center whitespace-nowrap">
                                      <span className="px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-[11px] font-bold text-zinc-700 dark:text-zinc-300">
                                        {day.tasks.length} task{day.tasks.length !== 1 ? 's' : ''}
                                      </span>
                                    </td>
                                    <td className="py-3 px-3 text-right whitespace-nowrap">
                                      <span className="font-black text-purple-600 dark:text-purple-400">
                                        {day.dayScore.toFixed(1)}
                                      </span>
                                      <span className="text-[10px] text-zinc-400">/10</span>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                          {dailyList.length > 0 && (
                            <tfoot className="bg-zinc-50 dark:bg-zinc-800/50 font-bold border-t border-zinc-200 dark:border-zinc-800 text-[11px]">
                              <tr>
                                <td className="py-2.5 px-4 text-zinc-900 dark:text-white">
                                  Total Across {dailyList.length} Active Day{dailyList.length !== 1 ? 's' : ''}
                                </td>
                                <td className="py-2.5 px-3 text-center text-[#34c4f2] font-black text-xs">
                                  {periodActualHours}h
                                </td>
                                <td className="py-2.5 px-3 text-center text-zinc-600 dark:text-zinc-400">
                                  Target: {periodCap.capacityHours}h ({periodCap.weeksCount} wk{periodCap.weeksCount > 1 ? 's' : ''})
                                </td>
                                <td className="py-2.5 px-3 text-xs text-emerald-600 dark:text-emerald-400">
                                  {Math.round((periodActualHours / (periodCap.capacityHours || 1)) * 100)}% Capacity Used
                                </td>
                                <td className="py-2.5 px-3 text-center text-zinc-600 dark:text-zinc-400">
                                  {periodTotalTasks} tasks
                                </td>
                                <td className="py-2.5 px-3 text-right text-purple-600 dark:text-purple-400 font-black">
                                  {periodScore}/100
                                </td>
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Task Log Details Table */}
              {(() => {
                const allTasks = singleUser.dailyEvaluations?.flatMap((d) => d.tasks) || [];
                return (
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                      Evaluated Task Breakdown ({allTasks.length})
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
                                  {t.taskName}
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
                                  {t.evaluation?.overallScore || 'N/A'}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-100 dark:border-zinc-800 flex justify-end bg-zinc-50/50 dark:bg-zinc-900/50">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 text-xs font-bold rounded-xl bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors cursor-pointer"
          >
            Close Report
          </button>
        </div>
      </div>
    </div>
  );
}
