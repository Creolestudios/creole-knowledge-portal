'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, RefreshCw, ListChecks } from 'lucide-react';
import { InterviewSession } from '@/lib/ai-interview/types';

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-zinc-100 dark:bg-slate-800 text-zinc-700 dark:text-slate-300 border-zinc-200 dark:border-slate-700',
  parsed: 'bg-zinc-100 dark:bg-slate-800 text-zinc-700 dark:text-slate-300 border-zinc-200 dark:border-slate-700',
  questions_generated: 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-500/30',
  invite_issued: 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-500/30',
  in_progress: 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-500/30',
  completed: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30',
  cancelled: 'bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-500/30',
};

export default function InterviewSessionsPage() {
  const [sessions, setSessions] = useState<InterviewSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/interviews');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load sessions');
      setSessions(json.sessions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadSessions();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-[#f8f9fa] dark:bg-slate-950 text-zinc-900 dark:text-slate-100 p-6 md:p-10 font-sans transition-colors">
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-zinc-200 dark:border-slate-800/80 pb-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-2">
              <ListChecks className="w-4 h-4" />
              <span>AI Interview Module</span>
            </div>
            <h1 className="text-3xl font-extrabold text-zinc-900 dark:text-white tracking-tight">Interview Sessions</h1>
            <p className="text-sm text-zinc-600 dark:text-slate-400 mt-1">
              Track every candidate session created from a resume + JD extraction.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              id="sessions-refresh"
              type="button"
              onClick={() => void loadSessions()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-900 hover:bg-zinc-50 dark:hover:bg-slate-800 text-zinc-700 dark:text-slate-300 text-sm font-medium rounded-xl border border-zinc-200 dark:border-slate-800 shadow-sm transition-all"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Refresh</span>
            </button>
            <Link
              href="/dashboard/ai-interview/extractor"
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-xl shadow-sm transition-all"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>New Session</span>
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-400 dark:text-slate-500" />
          </div>
        ) : error ? (
          <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-slate-500">
            No interview sessions yet. Create one from the extractor page.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-zinc-200 dark:border-slate-800 bg-white dark:bg-slate-900/30 shadow-sm">
            <table className="w-full text-sm text-left">
              <thead className="bg-zinc-50 dark:bg-slate-900/80 text-zinc-500 dark:text-slate-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Candidate</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-slate-800">
                {sessions.map((session) => (
                  <tr key={session.id} className="hover:bg-zinc-50/70 dark:hover:bg-slate-900/40 transition-colors">
                    <td className="px-4 py-3 font-medium text-zinc-900 dark:text-slate-100">
                      {session.candidate_name || 'Unnamed candidate'}
                    </td>
                    <td className="px-4 py-3 text-zinc-500 dark:text-slate-400">{session.candidate_email || '—'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
                          STATUS_STYLES[session.status] || STATUS_STYLES.draft
                        }`}
                      >
                        {session.status.replaceAll('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-500 dark:text-slate-400">
                      {session.created_at ? new Date(session.created_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-zinc-500 dark:text-slate-500">
          Note: for security, the invite link and passcode are shown only once, at the moment
          they are generated on the extractor page. Generate a fresh invite from a session&apos;s
          detail view if the original link was lost.
        </p>
      </div>
    </div>
  );
}
