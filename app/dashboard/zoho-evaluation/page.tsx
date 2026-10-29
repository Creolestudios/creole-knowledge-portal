'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Sparkles,
  ArrowLeft,
  Calendar,
  Lock,
  Clock,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Bot,
  Briefcase,
} from 'lucide-react';
import ZohoTillDateSummary from '@/components/zoho/zoho-till-date-summary';
import ZohoFilterBar, { FilterState } from '@/components/zoho/zoho-filter-bar';
import ZohoTaskCard from '@/components/zoho/zoho-task-card';
import ZohoTaskModal from '@/components/zoho/zoho-task-modal';
import { ZohoUserSummary, ZohoTaskItem } from '@/lib/zoho/service';

export default function MyZohoEvaluationPage() {
  const [data, setData] = useState<ZohoUserSummary | null>(null);
  const [activeTask, setActiveTask] = useState<ZohoTaskItem | null>(null);
  const [loading, setLoading] = useState(true);

  const [filter, setFilter] = useState<FilterState>({
    type: 'week',
    weekOffset: 0,
    monthOffset: 0,
    startDate: '',
    endDate: '',
    search: '',
  });

  const fetchMyEvaluations = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('type', filter.type);
      params.set('weekOffset', String(filter.weekOffset));
      params.set('monthOffset', String(filter.monthOffset));
      if (filter.startDate) params.set('startDate', filter.startDate);
      if (filter.endDate) params.set('endDate', filter.endDate);

      const res = await fetch(`/api/user/zoho/my-evaluations?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load evaluations');
      const json = await res.json();
      setData(json.evaluation || null);
    } catch (err) {
      console.error('[MyZohoEvaluationPage] Error loading data:', err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchMyEvaluations();
  }, [fetchMyEvaluations]);

  const handleFilterChange = (updated: Partial<FilterState>) => {
    setFilter((prev) => ({ ...prev, ...updated }));
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-6 md:p-10 lg:p-12">
      <div className="max-w-5xl mx-auto space-y-6">
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

        {/* Filter Bar */}
        <ZohoFilterBar filter={filter} onChange={handleFilterChange} />

        {loading ? (
          <div className="p-12 text-center text-xs text-zinc-400 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl animate-pulse">
            Loading your task evaluations...
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

            {/* Daily Task Groups */}
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400">
                  Daily Task Breakdown
                </h3>
                <span className="text-xs text-zinc-400">
                  Click any task to see hours analysis & comments
                </span>
              </div>

              {data.dailyEvaluations.length === 0 ? (
                <div className="p-10 text-center text-xs text-zinc-400 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl">
                  No task activity recorded for this period in Zoho Projects.
                </div>
              ) : (
                data.dailyEvaluations.map((day) => (
                  <div
                    key={day.date}
                    className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm space-y-4"
                  >
                    {/* Day Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-zinc-100 dark:border-zinc-800">
                      <div className="flex items-center gap-2">
                        <div className="p-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                          <Calendar className="w-4 h-4" />
                        </div>
                        <div>
                          <span className="text-sm font-bold text-zinc-900 dark:text-white">
                            {day.date}
                          </span>
                          <span className="text-xs text-zinc-400 ml-2">
                            ({day.tasks.length} task{day.tasks.length === 1 ? '' : 's'})
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="text-xs text-zinc-500 dark:text-zinc-400 italic max-w-md line-clamp-1">
                          {day.summary}
                        </span>
                        <span className="text-xs font-black px-2.5 py-1 rounded-xl bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-300 border border-purple-200 dark:border-purple-800 shrink-0">
                          Score: {day.dayScore} / 100
                        </span>
                      </div>
                    </div>

                    {/* Task Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {day.tasks.map((task) => (
                        <ZohoTaskCard
                          key={task.id}
                          task={task}
                          onClick={(t) => setActiveTask(t)}
                        />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="p-12 text-center text-xs text-zinc-400 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl">
            Could not find your Zoho integration profile.
          </div>
        )}

        {/* Task Details Modal */}
        <ZohoTaskModal task={activeTask} onClose={() => setActiveTask(null)} />
      </div>
    </div>
  );
}
