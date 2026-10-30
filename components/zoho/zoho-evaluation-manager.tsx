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
  Mail,
  Search,
  RefreshCw,
} from 'lucide-react';
import ZohoDateFilterPicker, { DateRangeSelection } from './zoho-date-filter-picker';
import ZohoUserSelectDropdown from './zoho-user-select-dropdown';
import ZohoFilterBar, { FilterState } from './zoho-filter-bar';
import ZohoTillDateSummary from './zoho-till-date-summary';
import ZohoTaskModal from './zoho-task-modal';
import ZohoReportModal from './zoho-report-modal';
import {
  ZohoUserSummary,
  ZohoTaskItem,
  getISOWeekNumber,
  formatDateDDMMYYYY,
  formatDateYYYYMMDD,
  getDefaultWeekSelection,
  getMockZohoData,
} from '@/lib/zoho/service';

export default function ZohoEvaluationManager() {
  const [users, setUsers] = useState<ZohoUserSummary[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [selectedUser, setSelectedUser] = useState<ZohoUserSummary | null>(null);
  const [activeTask, setActiveTask] = useState<ZohoTaskItem | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isLiveZoho, setIsLiveZoho] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailNotification, setEmailNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Zoho-style Date Selection (Week, Month, Range, Day)
  const [dateSelection, setDateSelection] = useState<DateRangeSelection>(getDefaultWeekSelection);

  // Quick search filter for user email list
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch users when dateSelection changes
  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('type', dateSelection.type);
      params.set('startDate', dateSelection.startDate);
      params.set('endDate', dateSelection.endDate);
      if (dateSelection.weekNumber) {
        params.set('weekNumber', String(dateSelection.weekNumber));
      }

      const res = await fetch(`/api/admin/zoho/users?${params.toString()}`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        console.warn('[ZohoEvaluationManager] Could not load users from API, falling back to mock data:', errorData?.error || res.status);
        setUsers(getMockZohoData());
        return;
      }
      const data = await res.json();
      const userList: ZohoUserSummary[] = data.users || [];
      setUsers(userList);
      if (data.isLive !== undefined) setIsLiveZoho(Boolean(data.isLive));
      if (data.lastSyncedAt) setLastSyncedAt(data.lastSyncedAt);

      // Update selectedUser reference if one was active
      setSelectedUser((prev) => {
        if (!prev) return null;
        return userList.find((u) => u.userId === prev.userId) || null;
      });
    } catch (err) {
      console.error('[ZohoEvaluationManager] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [dateSelection]);

  const handleSyncFromZoho = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch('/api/admin/zoho/sync', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setLastSyncedAt(data.lastSyncedAt);
        await fetchUsers();
      }
    } catch (err) {
      console.error('[ZohoEvaluationManager] Sync error:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Exclude admin users
  const nonAdminUsers = users.filter((u) => {
    const role = (u.role || '').toLowerCase();
    return role !== 'admin' && !role.includes('admin');
  });

  // Filtered by email search query
  const filteredUsers = nonAdminUsers.filter((u) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase().trim();
    return u.email.toLowerCase().includes(q);
  });

  // Handle single user checkbox toggle
  const handleToggleUser = (userId: string) => {
    if (selectedUserIds.includes(userId)) {
      setSelectedUserIds((prev) => prev.filter((id) => id !== userId));
    } else {
      setSelectedUserIds((prev) => [...prev, userId]);
    }
  };

  const handleSendEvaluationEmail = async () => {
    if (selectedUserIds.length === 0 || isSendingEmail) return;
    setIsSendingEmail(true);
    try {
      const res = await fetch('/api/admin/zoho/send-evaluation-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: selectedUserIds }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setEmailNotification({
          message: `Successfully dispatched evaluation emails to ${data.sentCount} user(s) and their reporting seniors!`,
          type: 'success',
        });
      } else {
        setEmailNotification({
          message: data.error || 'Failed to dispatch evaluation emails',
          type: 'error',
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setEmailNotification({ message: msg, type: 'error' });
    } finally {
      setIsSendingEmail(false);
      setTimeout(() => setEmailNotification(null), 5000);
    }
  };

  const handleToggleDailyEmail = async (userId: string, currentEnabled: boolean) => {
    const newEnabled = !currentEnabled;
    // Optimistic update
    setUsers((prev) =>
      prev.map((u) => (u.userId === userId ? { ...u, dailyEmailEnabled: newEnabled } : u))
    );

    try {
      const res = await fetch('/api/admin/zoho/users/daily-email', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, enabled: newEnabled }),
      });
      if (!res.ok) {
        // Rollback
        setUsers((prev) =>
          prev.map((u) => (u.userId === userId ? { ...u, dailyEmailEnabled: currentEnabled } : u))
        );
      }
    } catch {
      // Rollback
      setUsers((prev) =>
        prev.map((u) => (u.userId === userId ? { ...u, dailyEmailEnabled: currentEnabled } : u))
      );
    }
  };


  return (
    <div className="space-y-6">
      {!selectedUser ? (
        /* View 1: List All Users (Zoho Filter Bar, User Dropdown with All Users + Checkboxes, Generate Report) */
        <div className="space-y-6">
          {/* Header Title & Description */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-[#34c4f2]/10 text-[#34c4f2] flex items-center justify-center shrink-0">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-black text-zinc-900 dark:text-white tracking-tight">
                  Zoho Users
                </h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Select a user email to inspect their date-wise task data, or generate evaluation reports
                </p>
              </div>
            </div>

            {/* Quick search input by email */}
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search user email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-xs text-zinc-900 dark:text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#34c4f2]"
              />
            </div>
          </div>

          {/* Filter Toolbar Above User List: Week/Month/Range Selection + Users Dropdown + Generate Report Button */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                {/* 1. Zoho Date Filter Picker (Week / Month / Range Selection) */}
                <ZohoDateFilterPicker
                  value={dateSelection}
                  onChange={(newSel) => setDateSelection(newSel)}
                />

                {/* 2. Dropdown of All Users with 'All Users' checkbox and individual checkboxes */}
                <ZohoUserSelectDropdown
                  users={nonAdminUsers.map((u) => ({
                    userId: u.userId,
                    email: u.email,
                    name: u.name,
                  }))}
                  selectedUserIds={selectedUserIds}
                  onChange={(newSelected) => setSelectedUserIds(newSelected)}
                />

                {/* 3. Generate Report Button */}
                <button
                  type="button"
                  onClick={() => setShowReport(true)}
                  disabled={selectedUserIds.length === 0}
                  className={`text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-2 shadow-xs transition-all ${
                    selectedUserIds.length > 0
                      ? 'bg-[#34c4f2] hover:bg-[#2eb0db] text-zinc-900 shadow-sm shadow-[#34c4f2]/20 active:scale-95 cursor-pointer font-bold'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 border border-zinc-200 dark:border-zinc-700/60 cursor-not-allowed opacity-60'
                  }`}
                  title={
                    selectedUserIds.length > 0
                      ? `Generate evaluation report for ${selectedUserIds.length} users`
                      : 'Select at least one user to generate report'
                  }
                >
                  <FileText className="w-4 h-4" />
                  <span>
                    Generate Report {selectedUserIds.length > 0 ? `(${selectedUserIds.length})` : ''}
                  </span>
                </button>

                {/* 4. Send Evaluation Email to Selected Users */}
                <button
                  type="button"
                  onClick={handleSendEvaluationEmail}
                  disabled={selectedUserIds.length === 0 || isSendingEmail}
                  className={`text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-2 shadow-xs transition-all ${
                    selectedUserIds.length > 0 && !isSendingEmail
                      ? 'bg-purple-600 hover:bg-purple-700 text-white shadow-sm shadow-purple-600/20 active:scale-95 cursor-pointer font-bold'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500 border border-zinc-200 dark:border-zinc-700/60 cursor-not-allowed opacity-60'
                  }`}
                  title={
                    selectedUserIds.length > 0
                      ? `Send daily evaluation email to ${selectedUserIds.length} selected user(s) and their seniors`
                      : 'Select at least one user to send email'
                  }
                >
                  <Mail className={`w-4 h-4 ${isSendingEmail ? 'animate-bounce' : ''}`} />
                  <span>
                    {isSendingEmail ? 'Sending...' : `Send Email ${selectedUserIds.length > 0 ? `(${selectedUserIds.length})` : ''}`}
                  </span>
                </button>

                {/* 5. Sync Live Tasks from Zoho Button */}
                <button
                  type="button"
                  onClick={handleSyncFromZoho}
                  disabled={isSyncing}
                  className="text-xs font-bold px-3.5 py-2 rounded-xl bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-750 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700/80 flex items-center gap-1.5 shadow-xs transition-all cursor-pointer active:scale-95 disabled:opacity-60"
                  title="Synchronize real-time tasks, descriptions, and hours from Zoho Projects"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-[#34c4f2] ${isSyncing ? 'animate-spin' : ''}`} />
                  <span>{isSyncing ? 'Syncing...' : 'Sync from Zoho'}</span>
                </button>
              </div>

              {/* Status Indicators & Count Pill */}
              <div className="flex items-center gap-2">
                {isLiveZoho && (
                  <span
                    className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 px-2.5 py-1.5 rounded-xl flex items-center gap-1.5"
                    title={`Live Zoho Projects connected. Last synced: ${lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString() : 'Recently'}`}
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span>Live Zoho</span>
                  </span>
                )}

                <div className="text-xs text-zinc-500 dark:text-zinc-400 font-medium bg-zinc-50 dark:bg-zinc-800/60 px-3 py-1.5 rounded-xl border border-zinc-200/60 dark:border-zinc-800">
                  {selectedUserIds.length > 0
                    ? `${selectedUserIds.length} of ${nonAdminUsers.length} users selected`
                    : `${nonAdminUsers.length} active users`}
                </div>
              </div>
            </div>
          </div>

          {/* Email Notification Alert Banner */}
          {emailNotification && (
            <div
              className={`p-4 rounded-2xl border text-xs font-bold flex items-center gap-2.5 transition-all shadow-xs ${
                emailNotification.type === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                  : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300'
              }`}
            >
              {emailNotification.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
              )}
              <span>{emailNotification.message}</span>
            </div>
          )}

          {/* User Email List */}
          {loading && users.length === 0 ? (
            <div className="p-16 text-center text-xs text-zinc-400 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl animate-pulse space-y-3">
              <Users className="w-8 h-8 text-zinc-300 dark:text-zinc-700 mx-auto animate-bounce" />
              <p>Loading user list...</p>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="p-16 text-center text-xs text-zinc-400 bg-white dark:bg-zinc-900 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-3xl space-y-2">
              <Mail className="w-8 h-8 text-zinc-300 dark:text-zinc-600 mx-auto" />
              <p className="font-semibold text-zinc-700 dark:text-zinc-300 text-sm">No users found</p>
              <p>No active users match your search.</p>
            </div>
          ) : (
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl divide-y divide-zinc-100 dark:divide-zinc-800 shadow-xs overflow-hidden">
              {filteredUsers.map((u) => {
                const isChecked = selectedUserIds.includes(u.userId);
                return (
                  <div
                    key={u.userId}
                    className="w-full flex items-center justify-between p-4 px-5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-850 transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      {/* Checkbox for report selection */}
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleUser(u.userId)}
                        className="w-4 h-4 rounded text-[#34c4f2] bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700 focus:ring-[#34c4f2] focus:ring-offset-0 cursor-pointer accent-[#34c4f2] shrink-0"
                        title="Include in report"
                      />

                      {/* Icon */}
                      <div className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-500 group-hover:text-[#34c4f2] group-hover:bg-[#34c4f2]/10 transition-colors flex items-center justify-center shrink-0">
                        <Mail className="w-4 h-4" />
                      </div>

                      {/* User Email (Clickable to view task data) */}
                      <button
                        type="button"
                        onClick={() => setSelectedUser(u)}
                        className="text-sm font-semibold text-zinc-900 dark:text-white group-hover:text-[#34c4f2] transition-colors text-left cursor-pointer"
                      >
                        {u.email}
                      </button>
                    </div>

                    <div className="flex items-center gap-3">
                      {/* 10 PM Daily Mail Toggle Switch */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleDailyEmail(u.userId, u.dailyEmailEnabled !== false);
                        }}
                        className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-all flex items-center gap-1.5 cursor-pointer ${
                          u.dailyEmailEnabled !== false
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60 hover:bg-emerald-100'
                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-200'
                        }`}
                        title={`Click to ${u.dailyEmailEnabled !== false ? 'disable' : 'enable'} daily 10 PM evaluation emails for ${u.email}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${u.dailyEmailEnabled !== false ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-400'}`} />
                        <span>{u.dailyEmailEnabled !== false ? '10 PM Mail: Active' : '10 PM Mail: Off'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setSelectedUser(u)}
                        className="flex items-center gap-2 text-xs font-semibold text-zinc-400 group-hover:text-[#34c4f2] transition-colors cursor-pointer"
                      >
                        <span>View Task Data</span>
                        <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* View 2: Date-Wise Task Data for Selected User */
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

              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-[#34c4f2]/10 text-[#34c4f2]">
                  <Mail className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-lg font-black text-zinc-900 dark:text-white">
                    {selectedUser.email}
                  </h2>
                  <p className="text-xs text-zinc-400">
                    Date-wise task data and evaluations
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={handleSyncFromZoho}
                disabled={isSyncing}
                className="text-xs font-bold px-3 py-2 rounded-xl bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-750 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700/80 flex items-center gap-1.5 shadow-xs transition-all cursor-pointer active:scale-95 disabled:opacity-60"
                title="Synchronize latest tasks from Zoho Projects"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-[#34c4f2] ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? 'Syncing...' : 'Sync Zoho'}</span>
              </button>

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

          {/* Till-Date Summary displayed above task evaluation list */}
          <ZohoTillDateSummary
            userName={selectedUser.name}
            userEmail={selectedUser.email}
            role={selectedUser.role}
            yearsOfExperience={selectedUser.yearsOfExperience}
            seniorityLevel={selectedUser.seniorityLevel}
            aiSubscriptions={selectedUser.aiSubscriptions}
            summary={selectedUser.tillDateSummary}
          />

          {/* Date Picker Filter Bar above user tasks */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-zinc-500">Period:</span>
                <ZohoDateFilterPicker
                  value={dateSelection}
                  onChange={(newSel) => setDateSelection(newSel)}
                />
              </div>
              <span className="text-xs text-zinc-400">
                {selectedUser.dailyEvaluations.flatMap((d) => d.tasks).length} tasks in selected period
              </span>
            </div>
          </div>

          {/* Date-Wise Task Breakdown */}
          {selectedUser.dailyEvaluations.length === 0 ? (
            <div className="p-16 text-center text-xs text-zinc-400 bg-white dark:bg-zinc-900 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-3xl space-y-3">
              <Calendar className="w-8 h-8 text-zinc-300 dark:text-zinc-600 mx-auto" />
              <p className="font-semibold text-zinc-700 dark:text-zinc-300 text-sm">
                No tasks recorded for {dateSelection.label}
              </p>
              <p className="max-w-md mx-auto text-zinc-500">
                This user has {selectedUser.tillDateSummary.doneTasks} completed task{selectedUser.tillDateSummary.doneTasks === 1 ? '' : 's'} and {selectedUser.tillDateSummary.totalHoursLogged} logged hours in Zoho Projects. Adjust the date filter above to inspect earlier activities.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {selectedUser.dailyEvaluations.map((day) => (
                <div
                  key={day.date}
                  className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs space-y-4"
                >
                  {/* Day Header - Task Date only */}
                  <div className="flex items-center gap-2 pb-2.5 border-b border-zinc-100 dark:border-zinc-800">
                    <div className="w-6 h-6 rounded-lg bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center font-bold text-xs">
                      <Calendar className="w-3.5 h-3.5" />
                    </div>
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-white">
                      {day.date}
                    </h3>
                  </div>

                  {/* Tasks for this day - Only Project Name and Task Title */}
                  <div className="space-y-2">
                    {day.tasks.map((task) => (
                      <div
                        key={task.id}
                        className="p-3 rounded-xl bg-zinc-50/70 dark:bg-zinc-800/30 border border-zinc-100 dark:border-zinc-800/80 hover:border-zinc-300 dark:hover:border-zinc-700 transition-all flex items-center justify-between gap-3"
                      >
                        <div className="flex-1 min-w-0 flex items-center gap-2.5">
                          <span className="text-xs font-semibold px-2.5 py-0.5 rounded-md bg-zinc-200/60 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 shrink-0">
                            {task.projectName}
                          </span>
                          <button
                            type="button"
                            onClick={() => setActiveTask(task)}
                            className="text-xs font-bold text-zinc-900 dark:text-white hover:text-[#34c4f2] text-left truncate cursor-pointer transition-colors"
                            title={task.taskName}
                          >
                            {task.taskName}
                          </button>
                        </div>

                        <a
                          href={task.zohoLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 rounded-lg text-zinc-400 hover:text-[#34c4f2] hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors shrink-0"
                          title="Open in Zoho Projects"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Task Detail Modal */}
      {activeTask && (
        <ZohoTaskModal task={activeTask} onClose={() => setActiveTask(null)} />
      )}

      {/* Evaluation Report Modal */}
      {showReport && (
        <ZohoReportModal
          isOpen={showReport}
          user={selectedUser}
          users={!selectedUser ? nonAdminUsers.filter((u) => selectedUserIds.includes(u.userId)) : undefined}
          filterType={dateSelection.type}
          dateRangeText={dateSelection.label}
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
}
