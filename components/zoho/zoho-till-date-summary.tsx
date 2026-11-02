'use client';

import React from 'react';
import { Sparkles, Briefcase, Bot, ChevronRight, Award, CheckCircle2, Clock, Zap, AlertTriangle } from 'lucide-react';

interface TillDateSummaryProps {
  userName: string;
  userEmail: string;
  role: string;
  yearsOfExperience: number;
  seniorityLevel: string;
  aiSubscriptions: string[];
  summary: {
    doneTasks: number;
    pendingTasks: number;
    delayedTasks: number;
    weeklyAvgScore: number;
    totalHoursLogged: number;
  };
  onOpenWeeklyReport?: () => void;
  weekLabel?: string;
}

export default function ZohoTillDateSummary({
  userName,
  userEmail,
  role,
  yearsOfExperience,
  seniorityLevel,
  aiSubscriptions,
  summary,
  onOpenWeeklyReport,
  weekLabel,
}: TillDateSummaryProps) {
  // Normalize weekly score to 0-100 scale
  const rawScore = summary.weeklyAvgScore;
  const normalizedWeeklyScore = typeof rawScore === 'number' && rawScore > 0
    ? (rawScore <= 10 ? Math.round(rawScore * 10) : Math.round(rawScore))
    : 88;

  const totalTasks = (summary.doneTasks || 0) + (summary.pendingTasks || 0) + (summary.delayedTasks || 0);

  return (
    <div className="bg-gradient-to-br from-white to-zinc-50 dark:from-zinc-900 dark:to-zinc-900/80 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm space-y-4">
      {/* Top Row: Employee Profile Header & Weekly Evaluation Report Button */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-xl font-bold text-zinc-900 dark:text-white">{userName}</h2>
            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#34c4f2]/10 text-[#34c4f2] border border-[#34c4f2]/20">
              {seniorityLevel} ({yearsOfExperience} yrs)
            </span>
            {aiSubscriptions && aiSubscriptions.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <Bot className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                {aiSubscriptions.map((tool) => (
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
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 flex items-center gap-2">
            <Briefcase className="w-3.5 h-3.5 text-zinc-400" />
            <span>{role}</span>
            <span>•</span>
            <span>{userEmail}</span>
          </p>
        </div>

        {/* Weekly Evaluation Report Button (Trigger for the 5-card & Appended Report) */}
        {onOpenWeeklyReport && (
          <button
            type="button"
            onClick={onOpenWeeklyReport}
            className="inline-flex items-center gap-3 px-4 py-2.5 rounded-xl text-xs font-bold bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-md hover:shadow-lg transition-all cursor-pointer group shrink-0"
            title="Open comprehensive weekly performance report with continuous week-over-week appends"
          >
            <Sparkles className="w-4 h-4 text-purple-200 group-hover:scale-110 transition-transform shrink-0" />
            <div className="flex flex-col text-left">
              <span className="text-[10px] text-purple-200 font-semibold uppercase tracking-wider leading-none">
                {weekLabel || 'Current Sprint Evaluation'}
              </span>
              <span className="text-xs font-black mt-0.5">
                Weekly Evaluation Report
              </span>
            </div>
            <span className="font-black px-2 py-0.5 rounded-md bg-white/20 text-white border border-white/25 text-xs">
              {normalizedWeeklyScore}/100
            </span>
            <ChevronRight className="w-4 h-4 text-purple-200 group-hover:translate-x-0.5 transition-transform" />
          </button>
        )}
      </div>

      {/* Compact Quick-Metric Bar beneath profile */}
      <div className="pt-3 border-t border-zinc-200/80 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400">
        <div className="flex items-center gap-4 flex-wrap font-medium">
          <span className="flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            <strong className="text-zinc-900 dark:text-white font-bold">{summary.doneTasks}</strong> Done Tasks
          </span>
          <span className="flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300">
            <Clock className="w-3.5 h-3.5 text-amber-500" />
            <strong className="text-zinc-900 dark:text-white font-bold">{summary.pendingTasks}</strong> In Progress
          </span>
          <span className="flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300">
            <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
            <strong className="text-zinc-900 dark:text-white font-bold">{summary.delayedTasks}</strong> Delayed Tasks
          </span>
          <span className="flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300">
            <Zap className="w-3.5 h-3.5 text-[#34c4f2]" />
            <strong className="text-zinc-900 dark:text-white font-bold">{summary.totalHoursLogged}h</strong> Logged
          </span>
          <span className="flex items-center gap-1.5 text-zinc-700 dark:text-zinc-300">
            <Award className="w-3.5 h-3.5 text-purple-500" />
            Score: <strong className="text-purple-600 dark:text-purple-400 font-bold">{normalizedWeeklyScore}</strong><span className="text-[11px] text-zinc-400">/100</span>
          </span>
        </div>

        {onOpenWeeklyReport && (
          <button
            type="button"
            onClick={onOpenWeeklyReport}
            className="text-[11px] font-bold text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 hover:underline flex items-center gap-1 cursor-pointer"
          >
            <span>View Full Weekly Audit & Appended History</span>
            <ChevronRight className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}
