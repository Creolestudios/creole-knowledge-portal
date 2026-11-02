'use client';

import React, { useState } from 'react';
import { X, Printer, Award, Clock, CheckCircle2, AlertTriangle, FileText, Bot, Users, BarChart3, RefreshCw, History } from 'lucide-react';
import { ZohoUserSummary, buildWeeklyPerformanceReports } from '@/lib/zoho/service';

interface ZohoReportModalProps {
  isOpen?: boolean;
  user?: ZohoUserSummary | null;
  users?: ZohoUserSummary[];
  filterType: string;
  dateRangeText?: string;
  onClose: () => void;
}

export default function ZohoReportModal({
  isOpen = true,
  user,
  users = [],
  filterType,
  dateRangeText,
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
    return () => window.removeEventListener('keydown', handleKeyDown);
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
  const totalTasksDone = effectiveUsers.reduce((sum, u) => sum + (u.tillDateSummary?.doneTasks || 0), 0);
  const totalTasksPending = effectiveUsers.reduce((sum, u) => sum + (u.tillDateSummary?.pendingTasks || 0), 0);
  const totalTasksDelayed = effectiveUsers.reduce((sum, u) => sum + (u.tillDateSummary?.delayedTasks || 0), 0);
  const totalHoursLogged = Math.round(effectiveUsers.reduce((sum, u) => sum + (u.tillDateSummary?.totalHoursLogged || 0), 0) * 10) / 10;
  const avgTeamScore = Math.round(
    effectiveUsers.reduce((sum, u) => sum + (u.tillDateSummary?.weeklyAvgScore || 0), 0) / (effectiveUsers.length || 1)
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200 cursor-pointer"
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
                      {effectiveUsers.map((u) => (
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
                            {u.tillDateSummary?.weeklyAvgScore ?? 85}
                          </td>
                          <td className="py-3 px-3 text-center text-emerald-600 font-bold">
                            {u.tillDateSummary?.doneTasks ?? 0}
                          </td>
                          <td className="py-3 px-3 text-center text-rose-500 font-bold">
                            {u.tillDateSummary?.delayedTasks ?? 0}
                          </td>
                          <td className="py-3 px-3 text-center font-bold text-[#34c4f2]">
                            {u.tillDateSummary?.totalHoursLogged ?? 0}h
                          </td>
                          <td className="py-3 px-3 text-right">
                            <span className="text-[11px] font-bold text-[#34c4f2] hover:underline">
                              Inspect Tasks →
                            </span>
                          </td>
                        </tr>
                      ))}
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

              {/* Weekly Performance Reports - Starts with This Week & Appends Past Weeks */}
              {(() => {
                const weeklyReports = buildWeeklyPerformanceReports(singleUser);
                const thisWeek = weeklyReports[0];
                const pastWeeks = weeklyReports.slice(1);

                return (
                  <div className="space-y-6">
                    {/* THIS WEEK REPORT */}
                    <div className="p-6 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-200 dark:border-zinc-700">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="px-2.5 py-0.5 rounded-md text-xs font-bold bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300">
                              CURRENT SPRINT
                            </span>
                            <h4 className="text-sm font-bold text-zinc-900 dark:text-white">
                              {thisWeek?.label || 'This Week Performance Report'}
                            </h4>
                          </div>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                            Cumulative audit combining time adherence, work justification, complexity & repetition
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Overall Score:</span>
                          <span className="text-2xl font-black text-purple-600 dark:text-purple-400">
                            {thisWeek?.overallScore ?? 88}
                          </span>
                          <span className="text-xs text-zinc-400">/ 100</span>
                        </div>
                      </div>

                      {/* Metrics Row: Hours, Progress Bar 3/5, Repetitive Rate */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="p-3.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800">
                          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Hours Logged</span>
                          <div className="text-xl font-black text-[#34c4f2] mt-0.5">
                            {thisWeek?.totalActualHours ?? 0}h
                            <span className="text-xs text-zinc-400 font-normal"> / {thisWeek?.totalPlannedHours ?? 0}h planned</span>
                          </div>
                        </div>

                        <div className="p-3.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800">
                          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Repetitive Tasks</span>
                          <div className="text-xl font-black text-purple-600 dark:text-purple-400 mt-0.5 flex items-center gap-1.5">
                            <RefreshCw className="w-4 h-4 text-purple-500" />
                            {thisWeek?.repetitivenessPct ?? 0}%
                            <span className="text-xs text-zinc-400 font-normal">({thisWeek?.repetitiveCount ?? 0} flagged)</span>
                          </div>
                        </div>

                        <div className="p-3.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800">
                          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Completion Velocity</span>
                          <div className="text-xl font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
                            {thisWeek?.doneTasks ?? 0} / {thisWeek?.totalTasks ?? 0}
                            <span className="text-xs text-zinc-400 font-normal"> ({thisWeek?.donePct ?? 100}%)</span>
                          </div>
                        </div>
                      </div>

                      {/* Segmented Task Progress Bar (3/5 Done Style) */}
                      <div className="space-y-1.5 pt-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                            <BarChart3 className="w-3.5 h-3.5 text-emerald-500" />
                            Task Breakdown: {thisWeek?.doneTasks} Done • {thisWeek?.inProgressTasks} In Progress • {thisWeek?.delayedTasks} Delayed
                          </span>
                          <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                            {thisWeek?.donePct}% Completed
                          </span>
                        </div>
                        <div className="w-full h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden flex">
                          {(thisWeek?.donePct ?? 0) > 0 && (
                            <div style={{ width: `${thisWeek?.donePct}%` }} className="bg-emerald-500 h-full transition-all" />
                          )}
                          {((thisWeek?.inProgressTasks ?? 0) > 0) && (
                            <div
                              style={{ width: `${Math.round(((thisWeek?.inProgressTasks ?? 0) / (thisWeek?.totalTasks || 1)) * 100)}%` }}
                              className="bg-amber-400 h-full transition-all"
                            />
                          )}
                          {((thisWeek?.delayedTasks ?? 0) > 0) && (
                            <div
                              style={{ width: `${Math.round(((thisWeek?.delayedTasks ?? 0) / (thisWeek?.totalTasks || 1)) * 100)}%` }}
                              className="bg-rose-500 h-full transition-all"
                            />
                          )}
                        </div>
                      </div>

                      {/* Full Week Executive Summary in 2-3 Paragraphs */}
                      <div className="space-y-2 pt-2 border-t border-zinc-200 dark:border-zinc-700 text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400 flex items-center gap-1">
                          <Award className="w-3.5 h-3.5" />
                          Executive Performance Summary (Week {thisWeek?.weekNumber})
                        </div>
                        {thisWeek?.summaryParagraphs.map((para, idx) => (
                          <p key={idx} className="p-3 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200/70 dark:border-zinc-800">
                            {para}
                          </p>
                        ))}
                      </div>
                    </div>

                    {/* APPENDED PREVIOUS WEEKS (Rolling Cumulative Timeline) */}
                    {pastWeeks.length > 0 && (
                      <div className="space-y-3 pt-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                            <History className="w-3.5 h-3.5 text-zinc-400" />
                            Appended Performance History ({pastWeeks.length} Previous Week{pastWeeks.length === 1 ? '' : 's'})
                          </h4>
                          <span className="text-[11px] text-zinc-400">
                            Rolling multi-week record automatically updated
                          </span>
                        </div>

                        <div className="space-y-3">
                          {pastWeeks.map((pw) => (
                            <div
                              key={pw.weekNumber}
                              className="p-5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 space-y-3"
                            >
                              <div className="flex items-center justify-between pb-2 border-b border-zinc-200/70 dark:border-zinc-700/70">
                                <div>
                                  <span className="text-xs font-bold text-zinc-900 dark:text-white">
                                    {pw.label}
                                  </span>
                                  <span className="text-[11px] text-zinc-500 ml-2">
                                    • {pw.totalActualHours}h logged • {pw.repetitivenessPct}% Repetitive
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                                    {pw.doneTasks}/{pw.totalTasks} Done
                                  </span>
                                  <span className="text-sm font-black text-purple-600 dark:text-purple-400">
                                    {pw.overallScore}/100
                                  </span>
                                </div>
                              </div>

                              <div className="space-y-1.5 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                                {pw.summaryParagraphs.map((para, idx) => (
                                  <p key={idx} className="p-2 rounded-lg bg-white/70 dark:bg-zinc-900/60 border border-zinc-200/50 dark:border-zinc-800/50">
                                    {para}
                                  </p>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
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
