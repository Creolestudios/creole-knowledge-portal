'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Calendar,
  Sparkles,
  FileText,
  Clock,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ChevronRight,
  ArrowLeft,
  Bot,
} from 'lucide-react';
import ZohoFilterBar, { FilterState } from './zoho-filter-bar';
import ZohoTillDateSummary from './zoho-till-date-summary';
import ZohoTaskModal from './zoho-task-modal';
import ZohoReportModal from './zoho-report-modal';
import { ZohoUserSummary, ZohoTaskItem } from '@/lib/zoho/service';

export default function ZohoEvaluationManager() {
  const [users, setUsers] = useState<ZohoUserSummary[]>([]);
  const [selectedUser, setSelectedUser] = useState<ZohoUserSummary | null>(null);
  const [activeTask, setActiveTask] = useState<ZohoTaskItem | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [loading, setLoading] = useState(true);

  const [filter, setFilter] = useState<FilterState>({
    type: 'week',
    weekOffset: 0,
    monthOffset: 0,
    startDate: '',
    endDate: '',
    search: '',
  });

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('type', filter.type);
      params.set('weekOffset', String(filter.weekOffset));
      params.set('monthOffset', String(filter.monthOffset));
      if (filter.startDate) params.set('startDate', filter.startDate);
      if (filter.endDate) params.set('endDate', filter.endDate);
      if (filter.search) params.set('search', filter.search);

      const res = await fetch(`/api/admin/zoho/users?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load Zoho users');
      const data = await res.json();
      const userList: ZohoUserSummary[] = data.users || [];
      setUsers(userList);

      // If a user was already selected, update their reference; do NOT auto-select on initial load
      setSelectedUser((prev) => {
        if (!prev) return null;
        return userList.find((u) => u.userId === prev.userId) || null;
      });
    } catch (err) {
      console.error('[ZohoEvaluationManager] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleFilterChange = (updated: Partial<FilterState>) => {
    setFilter((prev) => ({ ...prev, ...updated }));
  };

  const filteredUsers = users.filter((u) => {
    if (!filter.search) return true;
    const q = filter.search.toLowerCase();
    return (
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q) ||
      u.aiSubscriptions?.some((s) => s.toLowerCase().includes(q))
    );
  });

  const getTimeStatusPill = (task: ZohoTaskItem) => {
    const evalData = task.evaluation;
    if (!evalData) {
      return (
        <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
          {task.actualHours}h spent / {task.plannedHours}h est
        </span>
      );
    }
    if (evalData.timeAssessmentLabel === 'SLIGHT_OVERRUN_TOLERATED' || evalData.timeAssessmentLabel === 'ON_TIME') {
      return (
        <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          <span>{task.actualHours}h spent / {task.plannedHours}h est</span>
          {evalData.timeVarianceMinutes > 0 && (
            <span className="text-[10px] bg-emerald-100 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded font-medium">
              +5m buffer (Tolerated)
            </span>
          )}
        </span>
      );
    }
    if (evalData.timeAssessmentLabel === 'UNEXPECTED_EARLY') {
      return (
        <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          <span>{task.actualHours}h spent / {task.plannedHours}h est</span>
          <span className="text-[10px] bg-amber-100 dark:bg-amber-950/60 px-1.5 py-0.5 rounded font-medium">
            Early finish (Gap flagged)
          </span>
        </span>
      );
    }
    return (
      <span className="text-[11px] font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1">
        <Clock className="w-3 h-3" />
        <span>{task.actualHours}h spent / {task.plannedHours}h est</span>
        <span className="text-[10px] bg-rose-100 dark:bg-rose-950/60 px-1.5 py-0.5 rounded font-medium">
          Overdue
        </span>
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {!selectedUser ? (
        /* View 1: List All Users */
        <div className="space-y-6">
          {/* Top Header */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#34c4f2]/10 text-[#34c4f2] flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-black text-zinc-900 dark:text-white tracking-tight">
                Zoho Employee Task Evaluations
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Select an employee to inspect their date-wise Zoho task titles, time adherence, and AI evaluation report
              </p>
            </div>
          </div>

          {/* Filter Bar */}
          <ZohoFilterBar filter={filter} onChange={handleFilterChange} />

          {/* Employees Grid */}
          {loading && users.length === 0 ? (
            <div className="p-16 text-center text-xs text-zinc-400 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl animate-pulse space-y-3">
              <Users className="w-8 h-8 text-zinc-300 dark:text-zinc-700 mx-auto animate-bounce" />
              <p>Loading employee evaluation directory...</p>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="p-16 text-center text-xs text-zinc-400 bg-white dark:bg-zinc-900 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-3xl space-y-2">
              <Users className="w-8 h-8 text-zinc-300 dark:text-zinc-600 mx-auto" />
              <p className="font-semibold text-zinc-700 dark:text-zinc-300 text-sm">No employees found</p>
              <p>Try modifying your search or date filter range.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredUsers.map((u) => {
                const totalPeriodTasks = u.dailyEvaluations.reduce((acc, d) => acc + d.tasks.length, 0);
                return (
                  <div
                    key={u.userId}
                    onClick={() => setSelectedUser(u)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') setSelectedUser(u);
                    }}
                    className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-[#34c4f2] dark:hover:border-[#34c4f2] transition-all cursor-pointer shadow-xs hover:shadow-md group flex flex-col justify-between space-y-4 text-left"
                  >
                    {/* Top Employee Info & Score */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#34c4f2]/20 to-purple-500/20 text-[#34c4f2] font-black text-sm flex items-center justify-center shrink-0 border border-[#34c4f2]/20">
                          {u.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-zinc-900 dark:text-white group-hover:text-[#34c4f2] transition-colors">
                            {u.name}
                          </h3>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            {u.email}
                          </p>
                          <p className="text-[11px] text-zinc-400 mt-0.5">
                            {u.role} • {u.seniorityLevel} ({u.yearsOfExperience} yrs exp)
                          </p>
                        </div>
                      </div>

                      {/* Weekly Avg Score */}
                      <div className="text-right shrink-0">
                        <span className="text-xs font-black px-2.5 py-1 rounded-xl bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                          {u.tillDateSummary.weeklyAvgScore} / 100
                        </span>
                        <div className="text-[9px] text-zinc-400 uppercase tracking-widest mt-1">Weekly Avg</div>
                      </div>
                    </div>

                    {/* AI Subscriptions Badges */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider flex items-center gap-1">
                        <Sparkles size={11} className="text-[#34c4f2]" />
                        AI:
                      </span>
                      {u.aiSubscriptions && u.aiSubscriptions.length > 0 ? (
                        u.aiSubscriptions.map((sub) => (
                          <span
                            key={sub}
                            className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-[#34c4f2]/10 text-[#1b7393] dark:text-[#34c4f2] border border-[#34c4f2]/20"
                          >
                            {sub}
                          </span>
                        ))
                      ) : (
                        <span className="text-[10px] text-zinc-400 italic">None assigned</span>
                      )}
                    </div>

                    {/* Till-Date Key Numbers */}
                    <div className="grid grid-cols-4 gap-2 pt-3 border-t border-zinc-100 dark:border-zinc-800 text-center">
                      <div className="p-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50">
                        <div className="text-xs font-black text-emerald-600 dark:text-emerald-400">
                          {u.tillDateSummary.doneTasks}
                        </div>
                        <div className="text-[9px] text-zinc-400 uppercase tracking-wider">Done</div>
                      </div>
                      <div className="p-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50">
                        <div className="text-xs font-black text-blue-600 dark:text-blue-400">
                          {u.tillDateSummary.pendingTasks}
                        </div>
                        <div className="text-[9px] text-zinc-400 uppercase tracking-wider">Pending</div>
                      </div>
                      <div className="p-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50">
                        <div className="text-xs font-black text-rose-600 dark:text-rose-400">
                          {u.tillDateSummary.delayedTasks}
                        </div>
                        <div className="text-[9px] text-zinc-400 uppercase tracking-wider">Delay</div>
                      </div>
                      <div className="p-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/50">
                        <div className="text-xs font-black text-zinc-700 dark:text-zinc-200">
                          {u.tillDateSummary.totalHoursLogged}h
                        </div>
                        <div className="text-[9px] text-zinc-400 uppercase tracking-wider">Hours</div>
                      </div>
                    </div>

                    {/* Bottom Action Footer */}
                    <div className="flex items-center justify-between text-xs font-semibold text-zinc-500 pt-2 border-t border-zinc-100 dark:border-zinc-800">
                      <span className="text-[11px] text-zinc-400">
                        {totalPeriodTasks} task{totalPeriodTasks === 1 ? '' : 's'} in selected period
                      </span>
                      <span className="text-[#34c4f2] group-hover:translate-x-1 transition-transform flex items-center gap-1 font-bold">
                        View Date-Wise Tasks <ChevronRight size={14} />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* View 2: Date-Wise Task Titles for Selected User */
        <div className="space-y-6">
          {/* Top Bar with Back Button & Report Action */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:border-[#34c4f2] text-xs font-bold transition-all cursor-pointer shadow-xs hover:text-[#34c4f2]"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back to All Users</span>
              </button>

              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-black text-zinc-900 dark:text-white">
                    {selectedUser.name}
                  </h2>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                    {selectedUser.role}
                  </span>
                </div>
                <p className="text-xs text-zinc-400">
                  Showing date-wise task breakdown, hours logged, and evaluation scores
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setShowReport(true)}
                className="text-xs font-bold px-4 py-2 rounded-xl bg-[#34c4f2] hover:bg-[#2eb0db] text-zinc-900 shadow-sm flex items-center gap-2 transition-all cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Generate Evaluation Report</span>
              </button>
            </div>
          </div>

          {/* Requirement 10: Till-Date Summary displayed above task evaluation list */}
          <ZohoTillDateSummary
            userName={selectedUser.name}
            userEmail={selectedUser.email}
            role={selectedUser.role}
            yearsOfExperience={selectedUser.yearsOfExperience}
            seniorityLevel={selectedUser.seniorityLevel}
            aiSubscriptions={selectedUser.aiSubscriptions}
            summary={selectedUser.tillDateSummary}
          />

          {/* Filter Bar for selecting Week, Month, Custom Range */}
          <ZohoFilterBar filter={filter} onChange={handleFilterChange} />

          {/* Date-Wise List of Task Titles */}
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[#34c4f2]" />
                Date-Wise Task Titles & Evaluations
              </h3>
              <span className="text-xs text-zinc-400">
                Click any task title to inspect comments, hours & evaluation details
              </span>
            </div>

            {selectedUser.dailyEvaluations.length === 0 ? (
              <div className="p-12 text-center text-xs text-zinc-400 bg-white dark:bg-zinc-900 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl space-y-2">
                <Calendar className="w-8 h-8 text-zinc-300 dark:text-zinc-600 mx-auto" />
                <p className="font-semibold text-zinc-700 dark:text-zinc-300 text-sm">
                  No tasks found for this date range
                </p>
                <p>Switch the filter to "Last Week", "This Month", or choose a custom date range above.</p>
              </div>
            ) : (
              selectedUser.dailyEvaluations.map((dayGroup) => (
                <div
                  key={dayGroup.date}
                  className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 shadow-sm space-y-4"
                >
                  {/* Day Group Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-100 dark:border-zinc-800">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                        <Calendar className="w-4 h-4 text-[#34c4f2]" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-black text-zinc-900 dark:text-white">
                            {dayGroup.date}
                          </span>
                          <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                            {dayGroup.tasks.length} task{dayGroup.tasks.length === 1 ? '' : 's'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Daily Score & Summary */}
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 italic max-w-md line-clamp-1">
                        {dayGroup.summary}
                      </span>
                      <span className="text-xs font-black px-2.5 py-1 rounded-xl bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-300 border border-purple-200 dark:border-purple-800 shrink-0">
                        Day Score: {dayGroup.dayScore} / 100
                      </span>
                    </div>
                  </div>

                  {/* Date-Wise List of Task Titles */}
                  <div className="space-y-3">
                    {dayGroup.tasks.map((task) => (
                      <div
                        key={task.id}
                        onClick={() => setActiveTask(task)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') setActiveTask(task);
                        }}
                        className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/60 hover:bg-white dark:hover:bg-zinc-800/80 hover:border-[#34c4f2] transition-all cursor-pointer group shadow-2xs hover:shadow-sm"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          {/* Left: Task Title & Subtitle */}
                          <div className="space-y-1.5 flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-[#34c4f2]/10 text-[#218dae] dark:text-[#34c4f2] shrink-0">
                                {task.projectName}
                              </span>
                              <h4 className="text-sm font-bold text-zinc-900 dark:text-white group-hover:text-[#34c4f2] transition-colors truncate">
                                {task.taskName}
                              </h4>
                            </div>

                            <div className="flex flex-wrap items-center gap-3 text-xs">
                              {getTimeStatusPill(task)}

                              {task.evaluation?.isRepetitive && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800 flex items-center gap-1">
                                  <AlertCircle className="w-3 h-3" />
                                  Repetitive Task ({task.evaluation.repetitionSimilarityPct}%)
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Right: Status, Score, Zoho Link */}
                          <div className="flex items-center gap-2.5 shrink-0">
                            {/* Status Badge */}
                            <span
                              className={`text-[10px] font-bold px-2 py-1 rounded-lg ${
                                task.isQAReview || task.zohoStatus.toLowerCase() === 'qa review'
                                  ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800'
                                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700'
                              }`}
                            >
                              {task.zohoStatus}
                            </span>

                            {/* Task Score */}
                            {task.evaluation && (
                              <span className="text-xs font-black px-2 py-1 rounded-lg bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                                {task.evaluation.overallScore} pts
                              </span>
                            )}

                            {/* Direct Zoho Link (Requirement 12) */}
                            <a
                              href={task.zohoLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              title="Open this task directly in Zoho Projects"
                              className="p-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-400 hover:text-[#34c4f2] hover:border-[#34c4f2] hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>

                            <ChevronRight className="w-4 h-4 text-zinc-400 group-hover:text-[#34c4f2] group-hover:translate-x-0.5 transition-all" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Task Details Modal (Requirement 3: Task Description, Hours, Comments, QA Status) */}
      <ZohoTaskModal task={activeTask} onClose={() => setActiveTask(null)} />

      {/* Evaluation Report Modal (Requirement 9) */}
      {showReport && (
        <ZohoReportModal
          isOpen={showReport}
          user={selectedUser}
          filterType={filter.type}
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
}
