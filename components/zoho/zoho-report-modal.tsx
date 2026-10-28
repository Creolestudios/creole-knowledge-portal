'use client';

import React from 'react';
import { X, Printer, Download, Award, Clock, CheckCircle2, AlertTriangle, FileText, Bot } from 'lucide-react';
import { ZohoUserSummary } from '@/lib/zoho/service';

interface ZohoReportModalProps {
  isOpen?: boolean;
  user: ZohoUserSummary | null;
  filterType: string;
  onClose: () => void;
}

export default function ZohoReportModal({ isOpen = true, user, filterType, onClose }: ZohoReportModalProps) {
  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !user) return null;

  const allTasks = user.dailyEvaluations.flatMap((d) => d.tasks);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200 cursor-pointer"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col cursor-default"
      >
        {/* Header */}
        <div className="p-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between sticky top-0 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-sm z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#34c4f2]/10 text-[#34c4f2] flex items-center justify-center">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-900 dark:text-white">
                Employee Evaluation Report
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Generated for {user.name} ({user.role}) • Period: {filterType.toUpperCase()}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="text-xs font-bold text-zinc-600 dark:text-zinc-300 hover:text-[#34c4f2] dark:hover:text-[#34c4f2] flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print / PDF</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Report Content */}
        <div className="p-8 space-y-6 text-zinc-900 dark:text-zinc-100 print:text-black">
          {/* Executive Scorecard */}
          <div className="p-6 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-800 grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
            <div>
              <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Evaluation Score</span>
              <div className="text-3xl font-black text-purple-600 dark:text-purple-400 mt-1">
                {user.tillDateSummary.weeklyAvgScore}
              </div>
              <span className="text-[10px] text-zinc-400">out of 100</span>
            </div>
            <div>
              <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Tasks Evaluated</span>
              <div className="text-3xl font-black text-zinc-900 dark:text-white mt-1">
                {user.tillDateSummary.doneTasks + user.tillDateSummary.pendingTasks}
              </div>
              <span className="text-[10px] text-emerald-500 font-bold">{user.tillDateSummary.doneTasks} Completed</span>
            </div>
            <div>
              <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Hours Logged</span>
              <div className="text-3xl font-black text-[#34c4f2] mt-1">
                {user.tillDateSummary.totalHoursLogged}h
              </div>
              <span className="text-[10px] text-zinc-400">tracked in Zoho</span>
            </div>
            <div>
              <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Delayed Tasks</span>
              <div className="text-3xl font-black text-rose-500 mt-1">
                {user.tillDateSummary.delayedTasks}
              </div>
              <span className="text-[10px] text-rose-400 font-bold">past tolerance</span>
            </div>
          </div>

          {/* AI Productivity & Executive Summary */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
              <Award className="w-3.5 h-3.5 text-purple-500" />
              Executive Evaluation Summary
            </h4>
            <div className="p-4 rounded-xl bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200/60 dark:border-purple-900/30 text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed">
              {user.tillDateSummary.weeklyAvgScore >= 85
                ? `${user.name} has demonstrated exemplary engineering discipline during this period. Tasks were consistently transitioned to QA Review with high punctuality, keeping overtime strictly within the 5-minute buffer allowance. Effective utilization of configured AI subscriptions (${user.aiSubscriptions.join(', ')}) was noted.`
                : `${user.name} maintained steady velocity; however, evaluations detected areas for improvement including early completion gap alerts (suggesting scope under-estimation) and minor repetition in task descriptions.`}
            </div>
          </div>

          {/* Task Log Details Table */}
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
                  {allTasks.map((t) => (
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
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-100 dark:border-zinc-800 flex justify-end bg-zinc-50/50 dark:bg-zinc-900/50">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 text-xs font-bold rounded-xl bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors"
          >
            Close Report
          </button>
        </div>
      </div>
    </div>
  );
}
