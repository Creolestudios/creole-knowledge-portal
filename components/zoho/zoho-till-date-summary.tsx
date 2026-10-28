'use client';

import React from 'react';
import { CheckCircle2, Clock, AlertTriangle, Award, Bot, Briefcase, Zap } from 'lucide-react';

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
}

export default function ZohoTillDateSummary({
  userName,
  userEmail,
  role,
  yearsOfExperience,
  seniorityLevel,
  aiSubscriptions,
  summary,
}: TillDateSummaryProps) {
  const getScoreColor = (score: number) => {
    if (score >= 85) return 'text-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800';
    if (score >= 70) return 'text-amber-500 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800';
    return 'text-rose-500 bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800';
  };

  return (
    <div className="bg-gradient-to-br from-white to-zinc-50 dark:from-zinc-900 dark:to-zinc-900/80 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm space-y-5">
      {/* Employee Profile Header & Badges */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-200/80 dark:border-zinc-800">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-bold text-zinc-900 dark:text-white">{userName}</h2>
            <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#34c4f2]/10 text-[#34c4f2] border border-[#34c4f2]/20">
              {seniorityLevel} ({yearsOfExperience} yrs)
            </span>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 flex items-center gap-2">
            <Briefcase className="w-3.5 h-3.5 text-zinc-400" />
            <span>{role}</span>
            <span>•</span>
            <span>{userEmail}</span>
          </p>
        </div>

        {/* AI Tools Tagging */}
        {aiSubscriptions && aiSubscriptions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1">
              <Bot className="w-3.5 h-3.5 text-indigo-400" /> AI Tools:
            </span>
            {aiSubscriptions.map((tool) => (
              <span
                key={tool}
                className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800"
              >
                {tool}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Till-Date Metric Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
        {/* Done Tasks */}
        <div className="p-4 rounded-xl bg-white dark:bg-zinc-800/60 border border-zinc-200/80 dark:border-zinc-700/60 shadow-xs flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-black text-zinc-900 dark:text-white leading-none">
              {summary.doneTasks}
            </div>
            <div className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 mt-1 uppercase tracking-wider">
              Done Tasks
            </div>
          </div>
        </div>

        {/* Not Done / Pending */}
        <div className="p-4 rounded-xl bg-white dark:bg-zinc-800/60 border border-zinc-200/80 dark:border-zinc-700/60 shadow-xs flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-black text-zinc-900 dark:text-white leading-none">
              {summary.pendingTasks}
            </div>
            <div className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 mt-1 uppercase tracking-wider">
              In Progress
            </div>
          </div>
        </div>

        {/* Delayed Tasks */}
        <div className="p-4 rounded-xl bg-white dark:bg-zinc-800/60 border border-zinc-200/80 dark:border-zinc-700/60 shadow-xs flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-black text-zinc-900 dark:text-white leading-none">
              {summary.delayedTasks}
            </div>
            <div className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 mt-1 uppercase tracking-wider">
              Delayed Tasks
            </div>
          </div>
        </div>

        {/* Logged Hours */}
        <div className="p-4 rounded-xl bg-white dark:bg-zinc-800/60 border border-zinc-200/80 dark:border-zinc-700/60 shadow-xs flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-[#34c4f2]/10 text-[#34c4f2] flex items-center justify-center shrink-0">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-black text-zinc-900 dark:text-white leading-none">
              {summary.totalHoursLogged}h
            </div>
            <div className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 mt-1 uppercase tracking-wider">
              Logged Hours
            </div>
          </div>
        </div>

        {/* Weekly Avg Score */}
        <div className="col-span-2 md:col-span-1 p-4 rounded-xl bg-white dark:bg-zinc-800/60 border border-zinc-200/80 dark:border-zinc-700/60 shadow-xs flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-500 flex items-center justify-center shrink-0">
            <Award className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <span className="text-2xl font-black text-zinc-900 dark:text-white leading-none">
                {summary.weeklyAvgScore}
              </span>
              <span className={`text-[10px] font-black px-1.5 py-0.5 rounded border ${getScoreColor(summary.weeklyAvgScore)}`}>
                / 100
              </span>
            </div>
            <div className="text-[11px] font-bold text-zinc-500 dark:text-zinc-400 mt-1 uppercase tracking-wider">
              Weekly Score
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
