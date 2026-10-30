'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Calendar,
  Lock,
  ExternalLink,
  Sparkles,
  ArrowLeft,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import DashboardShell from '@/components/dashboard/DashboardShell';
import LogoutButton from '@/components/logout-button';
import ZohoDateFilterPicker, { DateRangeSelection } from '@/components/zoho/zoho-date-filter-picker';
import ZohoTillDateSummary from '@/components/zoho/zoho-till-date-summary';
import ZohoTaskModal from '@/components/zoho/zoho-task-modal';
import {
  ZohoUserSummary,
  ZohoTaskItem,
  getDefaultWeekSelection,
} from '@/lib/zoho/service';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import type { UserProfileSchema } from '@/types/contracts';

export default function MyZohoEvaluationPage() {
  return (
    <React.Suspense
      fallback={
        <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-[#34c4f2] border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <MyZohoEvaluationContent />
    </React.Suspense>
  );
}

function MyZohoEvaluationContent() {
  const [user, setUser] = useState<Pick<SupabaseUser, 'id' | 'email'> | null>(null);
  const [profile, setProfile] = useState<UserProfileSchema | null>(null);
  const [data, setData] = useState<ZohoUserSummary | null>(null);
  const [activeTask, setActiveTask] = useState<ZohoTaskItem | null>(null);
  const [loading, setLoading] = useState(true);

  // Default week filter matching admin dashboard
  const [dateSelection, setDateSelection] = useState<DateRangeSelection>(getDefaultWeekSelection);

  const supabase = createClient();

  useEffect(() => {
    async function getInitialAuth() {
      try {
        const {
          data: { user: authUser },
        } = await supabase.auth.getUser();
        if (authUser) {
          setUser(authUser);
          const { data: userProfile } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('user_id', authUser.id)
            .single();
          setProfile(userProfile as UserProfileSchema | null);
        }
      } catch (err) {
        console.warn('[MyZohoEvaluationPage] Auth fetch fallback:', err);
      }
    }
    void getInitialAuth();
  }, [supabase]);

  const fetchMyEvaluations = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('type', dateSelection.type);
      params.set('startDate', dateSelection.startDate);
      params.set('endDate', dateSelection.endDate);
      if (dateSelection.weekNumber) {
        params.set('weekNumber', String(dateSelection.weekNumber));
      }

      const res = await fetch(`/api/user/zoho/my-evaluations?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load evaluations');
      const json = await res.json();
      setData(json.evaluation || null);
    } catch (err) {
      console.error('[MyZohoEvaluationPage] Error loading data:', err);
    } finally {
      setLoading(false);
    }
  }, [dateSelection]);

  useEffect(() => {
    fetchMyEvaluations();
  }, [fetchMyEvaluations]);

  const totalTasksCount = data?.dailyEvaluations?.flatMap((d) => d.tasks).length || 0;

  return (
    <DashboardShell
      displayName={profile?.current_role || user?.email?.split('@')[0] || data?.name || 'there'}
      displayDomain={user?.email?.split('@')[1] || 'creolestudios.com'}
      user={user || (data ? { id: data.userId, email: data.email } : null)}
      profile={profile}
      footer={<LogoutButton variant="sidebar" />}
    >
      <div className="space-y-6">
        {/* Navigation & Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="p-2 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-zinc-900 dark:text-white">
                  My Zoho Task Evaluations
                </h1>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 flex items-center gap-1">
                  <Lock className="w-3 h-3" /> Read Only
                </span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Personal daily task performance, AI coaching summaries, and time adherence records
              </p>
            </div>
          </div>
        </div>

        {loading && !data ? (
          <div className="p-16 text-center text-xs text-zinc-400 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl animate-pulse space-y-3">
            <div className="w-8 h-8 rounded-full border-2 border-[#34c4f2] border-t-transparent animate-spin mx-auto" />
            <p>Loading your task evaluations...</p>
          </div>
        ) : data ? (
          <div className="space-y-6">
            {/* Till-Date Summary Card (Prominently above tasks) */}
            <ZohoTillDateSummary
              userName={data.name}
              userEmail={data.email}
              role={data.role}
              yearsOfExperience={data.yearsOfExperience}
              seniorityLevel={data.seniorityLevel}
              aiSubscriptions={data.aiSubscriptions}
              summary={data.tillDateSummary}
            />

            {/* Date Picker Filter Bar above user tasks - Matches image screenshot */}
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
                  {totalTasksCount} task{totalTasksCount === 1 ? '' : 's'} in selected period
                </span>
              </div>
            </div>

            {/* Date-Wise Task Breakdown */}
            {data.dailyEvaluations.length === 0 ? (
              <div className="p-16 text-center text-xs text-zinc-400 bg-white dark:bg-zinc-900 border border-dashed border-zinc-200 dark:border-zinc-800 rounded-3xl space-y-3">
                <Calendar className="w-8 h-8 text-zinc-300 dark:text-zinc-600 mx-auto" />
                <p className="font-semibold text-zinc-700 dark:text-zinc-300 text-sm">
                  No tasks recorded for {dateSelection.label}
                </p>
                <p className="max-w-md mx-auto text-zinc-500">
                  {data.tillDateSummary.doneTasks > 0
                    ? `You have ${data.tillDateSummary.doneTasks} completed tasks and ${data.tillDateSummary.totalHoursLogged} logged hours in Zoho Projects. Adjust the date filter above to inspect earlier activities.`
                    : 'No task activity recorded for this period in Zoho Projects.'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {data.dailyEvaluations.map((day) => (
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

                          {task.zohoLink && (
                            <a
                              href={task.zohoLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1 rounded-lg text-zinc-400 hover:text-[#34c4f2] hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors shrink-0"
                              title="Open in Zoho Projects"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="p-16 text-center text-xs text-zinc-400 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl">
            Could not find your Zoho integration profile.
          </div>
        )}

        {/* Task Detail Modal - With hideZohoLink={true} to remove Zoho task link for regular user */}
        {activeTask && (
          <ZohoTaskModal
            task={activeTask}
            onClose={() => setActiveTask(null)}
            hideZohoLink={true}
          />
        )}
      </div>
    </DashboardShell>
  );
}
