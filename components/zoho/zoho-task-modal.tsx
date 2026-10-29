'use client';

import React from 'react';
import {
  X,
  ExternalLink,
  Clock,
  MessageSquare,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Bot,
  RefreshCw,
  Folder,
} from 'lucide-react';
import { ZohoTaskItem } from '@/lib/zoho/service';

interface ZohoTaskModalProps {
  task: ZohoTaskItem | null;
  onClose: () => void;
}

export default function ZohoTaskModal({ task, onClose }: ZohoTaskModalProps) {
  React.useEffect(() => {
    if (!task) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [task, onClose]);

  if (!task) return null;

  const evalData = task.evaluation;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200 cursor-pointer"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col cursor-default"
      >
        {/* Modal Header */}
        <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex items-start justify-between gap-4 sticky top-0 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-sm z-10">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[11px] font-bold text-[#34c4f2] bg-[#34c4f2]/10 px-2 py-0.5 rounded-md flex items-center gap-1">
                <Folder className="w-3 h-3" />
                {task.projectName}
              </span>
              <span
                className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                  task.isQAReview || task.zohoStatus.toLowerCase() === 'qa review'
                    ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
                }`}
              >
                {task.zohoStatus}
              </span>
            </div>
            <h3 className="text-lg font-bold text-zinc-900 dark:text-white leading-snug">
              {task.taskName}
            </h3>
          </div>

          <div className="flex items-center gap-2">
            {/* Direct Zoho Deep-Link Button */}
            <a
              href={task.zohoLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-bold text-zinc-600 dark:text-zinc-300 hover:text-[#34c4f2] dark:hover:text-[#34c4f2] flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              <span>Open in Zoho</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6">
          {/* Time & Hours Breakdown Bar */}
          <div className="grid grid-cols-3 gap-3 p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200/80 dark:border-zinc-800 text-center">
            <div>
              <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Planned Time</div>
              <div className="text-base font-black text-zinc-900 dark:text-white mt-0.5">{task.plannedHours} hrs</div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Actual Spent</div>
              <div className="text-base font-black text-zinc-900 dark:text-white mt-0.5">{task.actualHours} hrs</div>
            </div>
            <div>
              <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Variance & Status</div>
              <div className="text-xs font-bold mt-1 text-[#34c4f2]">
                {evalData?.timeAssessmentLabel === 'SLIGHT_OVERRUN_TOLERATED' && '+5m Overrun (Tolerated)'}
                {evalData?.timeAssessmentLabel === 'ON_TIME' && 'On Time'}
                {evalData?.timeAssessmentLabel === 'UNEXPECTED_EARLY' && 'Early Gap (>15m)'}
                {evalData?.timeAssessmentLabel === 'OVERDUE' && 'Overdue'}
                {!evalData && 'Pending Eval'}
              </div>
            </div>
          </div>

          {/* Task Description */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">
              Task Description
            </h4>
            <div className="p-4 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-line">
              {task.taskDescription || 'No description provided in Zoho Projects.'}
            </div>
          </div>

          {/* AI Task Evaluation Summary Section */}
          {evalData && (
            <div className="p-5 rounded-2xl bg-gradient-to-br from-purple-500/5 to-indigo-500/5 border border-purple-200/60 dark:border-purple-900/40 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-zinc-900 dark:text-white">AI Evaluation Summary</h4>
                    <span className="text-[10px] text-zinc-400">Powered by {evalData.aiModelUsed}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <div className="text-xs text-zinc-400">Task Score</div>
                    <div className="text-xl font-black text-purple-600 dark:text-purple-400">
                      {evalData.overallScore} <span className="text-xs text-zinc-400 font-normal">/ 100</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Repetitive Task Banner if flagged */}
              {evalData.isRepetitive && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2.5">
                  <RefreshCw className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
                  <div>
                    <span className="font-bold">Repetitive Task Flagged:</span> This task shares {evalData.repetitionSimilarityPct}% similarity with prior project tasks. Repeating identical descriptions reduces score.
                  </div>
                </div>
              )}

              {/* Sub-Scores Matrix */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                <div className="p-2.5 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700/60">
                  <span className="text-[10px] text-zinc-400 uppercase font-bold">Time Adherence</span>
                  <div className="text-sm font-black text-zinc-900 dark:text-white mt-0.5">{evalData.timeScore}%</div>
                </div>
                <div className="p-2.5 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700/60">
                  <span className="text-[10px] text-zinc-400 uppercase font-bold">Comments Quality</span>
                  <div className="text-sm font-black text-zinc-900 dark:text-white mt-0.5">{evalData.commentQualityScore}%</div>
                </div>
                <div className="p-2.5 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700/60">
                  <span className="text-[10px] text-zinc-400 uppercase font-bold">Complexity</span>
                  <div className="text-sm font-black text-zinc-900 dark:text-white mt-0.5">{evalData.complexityScore}%</div>
                </div>
                <div className="p-2.5 rounded-xl bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700/60">
                  <span className="text-[10px] text-zinc-400 uppercase font-bold">Originality</span>
                  <div className="text-sm font-black text-zinc-900 dark:text-white mt-0.5">{evalData.repetitionScore}%</div>
                </div>
              </div>

              {/* AI Summary Feedback Paragraph */}
              <p className="text-xs text-zinc-700 dark:text-zinc-300 bg-white/60 dark:bg-zinc-800/60 p-3 rounded-xl border border-zinc-200/50 dark:border-zinc-700/40 leading-relaxed">
                {evalData.summaryFeedback}
              </p>

              {/* Strengths & Improvements */}
              <div className="grid sm:grid-cols-2 gap-3 text-xs">
                {evalData.strengths.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 text-[11px]">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Strengths
                    </span>
                    <ul className="space-y-1 text-zinc-600 dark:text-zinc-300">
                      {evalData.strengths.map((str, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="text-emerald-500 font-bold">•</span>
                          <span>{str}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {evalData.improvements.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1 text-[11px]">
                      <AlertTriangle className="w-3.5 h-3.5" /> Key Improvements
                    </span>
                    <ul className="space-y-1 text-zinc-600 dark:text-zinc-300">
                      {evalData.improvements.map((imp, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="text-amber-500 font-bold">•</span>
                          <span>{imp}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Related Comments Thread */}
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2.5 flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5 text-[#34c4f2]" />
              Related Comments ({task.comments?.length || 0})
            </h4>

            {task.comments && task.comments.length > 0 ? (
              <div className="space-y-2.5">
                {task.comments.map((comment, index) => (
                  <div
                    key={index}
                    className="p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200/80 dark:border-zinc-800 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-bold text-zinc-900 dark:text-white">{comment.author}</span>
                      <span className="text-zinc-400">{comment.time}</span>
                    </div>
                    <p className="text-zinc-600 dark:text-zinc-300 leading-relaxed whitespace-pre-line">
                      {comment.content}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-400 italic bg-zinc-50 dark:bg-zinc-800/40 p-4 rounded-xl text-center">
                No comments logged for this task in Zoho Projects.
              </p>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-zinc-100 dark:border-zinc-800 flex justify-end bg-zinc-50/50 dark:bg-zinc-900/50">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 text-xs font-bold rounded-xl bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
