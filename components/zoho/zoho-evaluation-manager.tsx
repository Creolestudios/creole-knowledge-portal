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
  Briefcase,
  Mail,
  Search,
  RefreshCw,
} from 'lucide-react';
import ZohoDateFilterPicker, { DateRangeSelection } from './zoho-date-filter-picker';
import ZohoTillDateSummary from './zoho-till-date-summary';
import ZohoTaskModal from './zoho-task-modal';
import ZohoDailyEvaluationModal from './zoho-daily-evaluation-modal';
import ZohoWeeklyEvaluationModal from './zoho-weekly-evaluation-modal';
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

function getUrlUserEmail(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('tab')) return null;
    return params.get('user')?.toLowerCase().trim() || null;
  } catch {
    return null;
  }
}

export default function ZohoEvaluationManager() {
  const [users, setUsers] = useState<ZohoUserSummary[]>([]);
  const [selectedUser, setSelectedUser] = useState<ZohoUserSummary | null>(null);
  const [activeTask, setActiveTask] = useState<ZohoTaskItem | null>(null);
  const [activeDailyEval, setActiveDailyEval] = useState<{ day: any; userName: string; userRole: string } | null>(null);
  const [showWeeklyReport, setShowWeeklyReport] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isLiveZoho, setIsLiveZoho] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
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
        const mockList = getMockZohoData();
        setUsers(mockList);
        const urlUserEmail = getUrlUserEmail();
        setSelectedUser((prev) => {
          if (prev) {
            return mockList.find((u) => u.userId === prev.userId || u.email.toLowerCase() === prev.email.toLowerCase()) || null;
          }
          if (urlUserEmail) {
            return mockList.find((u) => u.email.toLowerCase() === urlUserEmail) || null;
          }
          return null;
        });
        return;
      }
      const data = await res.json();
      const userList: ZohoUserSummary[] = data.users || [];
      setUsers(userList);
      if (data.isLive !== undefined) setIsLiveZoho(Boolean(data.isLive));
      if (data.lastSyncedAt) setLastSyncedAt(data.lastSyncedAt);

      // Update selectedUser reference if one was active or specified in URL
      const urlUserEmail = getUrlUserEmail();
      setSelectedUser((prev) => {
        if (prev) {
          return userList.find((u) => u.userId === prev.userId || u.email.toLowerCase() === prev.email.toLowerCase()) || null;
        }
        if (urlUserEmail) {
          return userList.find((u) => u.email.toLowerCase() === urlUserEmail) || null;
        }
        return null;
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
    void Promise.resolve().then(fetchUsers);
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

  const handleSelectUser = (u: ZohoUserSummary | null) => {
    setDateSelection(getDefaultWeekSelection());
    setSelectedUser(u);
    if (typeof window !== 'undefined') {
      try {
        const url = new URL(window.location.href);
        if (url.searchParams.has('tab')) {
          if (u?.email) {
            url.searchParams.set('user', u.email);
          } else {
            url.searchParams.delete('user');
          }
          window.history.replaceState(null, '', url.pathname + url.search);
        }
      } catch (err) {
        console.warn('[ZohoEvaluationManager] Failed to update URL state:', err);
      }
    }
  };

  useEffect(() => {
    const handlePopState = () => {
      const email = getUrlUserEmail();
      if (!email) {
        setSelectedUser(null);
      } else {
        setSelectedUser((prev) => {
          if (prev?.email.toLowerCase() === email) return prev;
          return users.find((u) => u.email.toLowerCase() === email) || null;
        });
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [users]);

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
                  Select a user email to inspect their date-wise task data and evaluations
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              {loading && users.length > 0 && (
                <span className="hidden sm:flex items-center gap-1.5 text-xs text-[#34c4f2] font-semibold animate-pulse">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Loading...</span>
                </span>
              )}

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

              {/* Sync Live Tasks from Zoho Button */}
              <button
                type="button"
                onClick={handleSyncFromZoho}
                disabled={isSyncing}
                className="text-xs font-bold px-3.5 py-2 rounded-xl bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-750 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700/80 flex items-center gap-1.5 shadow-xs transition-all cursor-pointer active:scale-95 disabled:opacity-60 shrink-0"
                title="Synchronize real-time tasks, descriptions, and hours from Zoho Projects"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-[#34c4f2] ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? 'Syncing...' : 'Sync from Zoho'}</span>
              </button>
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
            <div className={`bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl divide-y divide-zinc-100 dark:divide-zinc-800 shadow-xs overflow-hidden transition-opacity duration-200 ${loading ? 'opacity-60' : 'opacity-100'}`}>
              {filteredUsers.map((u) => {
                return (
                  <div
                    key={u.userId}
                    className="w-full flex items-center justify-between p-4 px-5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-850 transition-colors group cursor-pointer"
                    onClick={() => handleSelectUser(u)}
                  >
                    <div className="flex items-center gap-3">
                      {/* Icon */}
                      <div className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-500 group-hover:text-[#34c4f2] group-hover:bg-[#34c4f2]/10 transition-colors flex items-center justify-center shrink-0">
                        <Mail className="w-4 h-4" />
                      </div>

                      {/* User Email & Name (Clickable to view task data) */}
                      <div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectUser(u);
                          }}
                          className="text-sm font-semibold text-zinc-900 dark:text-white group-hover:text-[#34c4f2] transition-colors text-left cursor-pointer"
                        >
                          {u.email}
                        </button>
                        {u.name && (
                          <p className="text-[11px] text-zinc-400">{u.name} · {u.role || 'Developer'}</p>
                        )}
                      </div>
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
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectUser(u);
                        }}
                        className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400 group-hover:text-[#34c4f2] transition-colors cursor-pointer"
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
          {/* Header Row: Back Arrow, User Name & Email, Sync Action */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
            <div className="flex items-center gap-3">
              {/* Back Arrow Button */}
              <button
                type="button"
                onClick={() => handleSelectUser(null)}
                className="p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:border-[#34c4f2] text-xs font-bold transition-all cursor-pointer shadow-xs hover:text-[#34c4f2] hover:bg-[#34c4f2]/5 shrink-0"
                title="Back to All Users"
                aria-label="Back to All Users"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="sr-only">Back to All Users</span>
              </button>

              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-xl bg-[#34c4f2]/10 text-[#34c4f2] shrink-0 self-start">
                  <Mail className="w-4 h-4" />
                </div>
                <div className="space-y-1">
                  {/* Row 1: Name, Email, Seniority & Experience, Subscriptions */}
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-black text-zinc-900 dark:text-white">
                      {selectedUser.name || selectedUser.email}
                    </h2>
                    {selectedUser.name && (
                      <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        ({selectedUser.email})
                      </span>
                    )}
                    {selectedUser.seniorityLevel && (
                      <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#34c4f2]/10 text-[#34c4f2] border border-[#34c4f2]/20">
                        {selectedUser.seniorityLevel} ({selectedUser.yearsOfExperience} yrs)
                      </span>
                    )}
                    {selectedUser.aiSubscriptions && selectedUser.aiSubscriptions.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Bot className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                        {selectedUser.aiSubscriptions.map((tool) => (
                          <span
                            key={tool}
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
                          >
                            {tool}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Row 2: Role + Description */}
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-2 flex-wrap">
                    {selectedUser.role && (
                      <span className="flex items-center gap-1.5 font-medium text-zinc-600 dark:text-zinc-300">
                        <Briefcase className="w-3.5 h-3.5 text-zinc-400" />
                        <span>{selectedUser.role}</span>
                      </span>
                    )}
                    {selectedUser.role && <span>•</span>}
                    <span className="text-zinc-400">Date-wise task data and evaluations</span>
                  </p>
                </div>
              </div>
            </div>

            {/* Sync Zoho Button on Top Right */}
            <div className="flex items-center gap-2.5 shrink-0 self-start sm:self-auto">
              <button
                type="button"
                onClick={handleSyncFromZoho}
                disabled={isSyncing}
                className="text-xs font-bold px-3.5 py-2 rounded-xl bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-750 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700/80 flex items-center gap-1.5 shadow-xs transition-all cursor-pointer active:scale-95 disabled:opacity-60"
                title="Synchronize latest tasks from Zoho Projects"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-[#34c4f2] ${isSyncing ? 'animate-spin' : ''}`} />
                <span>{isSyncing ? 'Syncing...' : 'Sync Zoho'}</span>
              </button>
            </div>
          </div>

          {/* Filter Bar Below User Info: Date Filter Picker & Generate Report Button */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-3 px-4 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                {/* Date Filter Picker (Week / Month / Range Selection) */}
                <ZohoDateFilterPicker
                  value={dateSelection}
                  onChange={(newSel) => setDateSelection(newSel)}
                  loading={loading}
                />

                {/* Generate Report for this user */}
                <button
                  type="button"
                  onClick={() => setShowReport(true)}
                  disabled={loading}
                  className="text-xs font-bold px-4 py-2 rounded-xl bg-[#34c4f2] hover:bg-[#2eb0db] disabled:opacity-60 disabled:cursor-not-allowed text-zinc-900 shadow-sm flex items-center gap-2 transition-all cursor-pointer active:scale-95"
                  title={`Generate evaluation report for ${selectedUser.name || selectedUser.email}`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Generate Report</span>
                </button>
              </div>

              {loading ? (
                <span className="flex items-center gap-1.5 text-xs text-[#34c4f2] font-semibold animate-pulse">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Loading {dateSelection.label}...</span>
                </span>
              ) : (
                <span className="text-xs text-zinc-400">
                  {selectedUser.dailyEvaluations.flatMap((d) => d.tasks).length} tasks in {dateSelection.label}
                </span>
              )}
            </div>
          </div>

          {/* Till-Date Summary displayed above task evaluation list */}
          <div className={`transition-opacity duration-200 ${loading ? 'opacity-60 pointer-events-none' : 'opacity-100'}`}>
            <ZohoTillDateSummary
              hideProfileHeader={true}
              userName={selectedUser.name}
              userEmail={selectedUser.email}
              role={selectedUser.role}
              yearsOfExperience={selectedUser.yearsOfExperience}
              seniorityLevel={selectedUser.seniorityLevel}
              aiSubscriptions={selectedUser.aiSubscriptions}
              summary={selectedUser.tillDateSummary}
              onOpenWeeklyReport={() => setShowWeeklyReport(true)}
              weekLabel={getDefaultWeekSelection().label.toUpperCase()}
            />
          </div>

          {/* Section Header: Tasks in selected period */}
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-bold text-zinc-900 dark:text-white">
              Daily Task Activity
            </h3>
          </div>

          {/* Date-Wise Task Breakdown */}
          {loading ? (
            <div className="p-16 text-center text-xs text-zinc-400 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl space-y-3 shadow-xs animate-pulse">
              <RefreshCw className="w-8 h-8 text-[#34c4f2] mx-auto animate-spin" />
              <p className="font-bold text-sm text-zinc-800 dark:text-zinc-200">
                Loading Tasks & Evaluations...
              </p>
              <p className="max-w-md mx-auto text-zinc-500">
                Fetching date-wise activity and heuristic evaluations for {dateSelection.label}
              </p>
            </div>
          ) : selectedUser.dailyEvaluations.length === 0 ? (
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
                  {/* Day Header - Task Date & Daily Evaluation Button */}
                  <div className="flex items-center justify-between pb-2.5 border-b border-zinc-100 dark:border-zinc-800">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center font-bold text-xs">
                        <Calendar className="w-3.5 h-3.5" />
                      </div>
                      <h3 className="text-sm font-bold text-zinc-900 dark:text-white">
                        {day.date}
                      </h3>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setActiveDailyEval({
                          day,
                          userName: selectedUser.name,
                          userRole: selectedUser.role,
                        })
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800/60 hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-all cursor-pointer shadow-2xs hover:shadow-xs group"
                      title={`View complete daily evaluation audit for ${day.date}`}
                    >
                      <Sparkles className="w-3.5 h-3.5 text-purple-500 group-hover:scale-110 transition-transform" />
                      <span>Daily Evaluation</span>
                      <span className="font-black px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/60 text-purple-800 dark:text-purple-200">
                        {day.dayScore.toFixed(1)}/10
                      </span>
                    </button>
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

      {/* Daily Evaluation Modal */}
      {activeDailyEval && (
        <ZohoDailyEvaluationModal
          day={activeDailyEval.day}
          userName={activeDailyEval.userName}
          userRole={activeDailyEval.userRole}
          userSummary={selectedUser || undefined}
          onClose={() => setActiveDailyEval(null)}
          onSelectTask={(task) => {
            setActiveDailyEval(null);
            setActiveTask(task);
          }}
        />
      )}

      {/* Weekly Evaluation Modal */}
      {showWeeklyReport && selectedUser && (
        <ZohoWeeklyEvaluationModal
          user={selectedUser}
          onClose={() => setShowWeeklyReport(false)}
        />
      )}

      {/* Task Detail Modal */}
      {activeTask && (
        <ZohoTaskModal task={activeTask} onClose={() => setActiveTask(null)} />
      )}

      {/* Evaluation Report Modal */}
      {showReport && selectedUser && (
        <ZohoReportModal
          isOpen={showReport}
          user={selectedUser}
          filterType={dateSelection.type}
          dateRangeText={dateSelection.label}
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
}
