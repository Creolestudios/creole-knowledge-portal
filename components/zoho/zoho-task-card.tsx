'use client';

import React from 'react';
import { ExternalLink, Clock, MessageSquare, CheckCircle, AlertCircle, Sparkles, RefreshCw } from 'lucide-react';
import { ZohoTaskItem } from '@/lib/zoho/service';

interface ZohoTaskCardProps {
  task: ZohoTaskItem;
  onClick: (task: ZohoTaskItem) => void;
}

export default function ZohoTaskCard({ task, onClick }: ZohoTaskCardProps) {
  const evalData = task.evaluation;

  // Time status color pill
  const getTimeBadge = () => {
    if (!evalData) {
      return (
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
          {task.actualHours}h / {task.plannedHours}h
        </span>
      );
    }

    if (evalData.timeAssessmentLabel === 'NOT_LOGGED' || task.actualHours === 0) {
      return (
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {task.actualHours}h / {task.plannedHours}h (Not Logged)
        </span>
      );
    }

    if (evalData.timeAssessmentLabel === 'SLIGHT_OVERRUN_TOLERATED' || evalData.timeAssessmentLabel === 'ON_TIME') {
      return (
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {task.actualHours}h / {task.plannedHours}h (On Time)
        </span>
      );
    }

    if (evalData.timeAssessmentLabel === 'UNEXPECTED_EARLY') {
      return (
        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {task.actualHours}h / {task.plannedHours}h (Early Gap)
        </span>
      );
    }

    return (
      <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 flex items-center gap-1">
        <Clock className="w-3 h-3" />
        {task.actualHours}h / {task.plannedHours}h (Overdue)
      </span>
    );
  };

  return (
    <div
      onClick={() => onClick(task)}
      className="p-4 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-[#34c4f2] dark:hover:border-[#34c4f2] transition-all cursor-pointer shadow-xs hover:shadow-md group flex flex-col justify-between gap-3"
    >
      {/* Top Row: Project & Direct Zoho Task Link */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#34c4f2] bg-[#34c4f2]/10 px-2 py-0.5 rounded-md">
          {task.projectName}
        </span>

        {/* Direct Zoho Task Link Button (Requirement 12) */}
        <a
          href={task.zohoLink}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          title="Open this task directly in Zoho Projects"
          className="text-xs font-semibold text-zinc-400 hover:text-[#34c4f2] dark:hover:text-[#34c4f2] flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        >
          <span>Zoho</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Task Name & Preview */}
      <div>
        <h4 className="text-sm font-bold text-zinc-900 dark:text-white group-hover:text-[#34c4f2] transition-colors line-clamp-1">
          {task.taskName}
        </h4>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2 mt-1 leading-relaxed">
          {task.taskDescription || 'No description provided.'}
        </p>
      </div>

      {/* Bottom Metadata Row: Hours Pill, Comments count, Status, & AI Score */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          {getTimeBadge()}

          {/* Status Badge */}
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
              task.isQAReview || task.zohoStatus.toLowerCase() === 'qa review'
                ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
            }`}
          >
            {task.zohoStatus}
          </span>

          {/* Repetitive Flag indicator */}
          {evalData?.isRepetitive && (
            <span
              title={`Repetitive task detected (${evalData.repetitionSimilarityPct}% match)`}
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Repetitive
            </span>
          )}
        </div>

        {/* Right side: Comments count & AI Score */}
        <div className="flex items-center gap-3">
          {task.comments && task.comments.length > 0 && (
            <span className="text-xs text-zinc-400 flex items-center gap-1">
              <MessageSquare className="w-3.5 h-3.5" />
              <span>{task.comments.length}</span>
            </span>
          )}

          {evalData && (
            <span className="text-xs font-black px-2 py-0.5 rounded-lg bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-300 border border-purple-200 dark:border-purple-800 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-purple-500" />
              <span>{evalData.overallScore}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
