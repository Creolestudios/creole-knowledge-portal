'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  FileText,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Users,
  Loader2,
  ShieldAlert,
  TrendingUp,
  Clock,
  Video,
} from 'lucide-react';

function getPageNumbers(current: number, total: number): (number | string)[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  if (current <= 3) {
    return [1, 2, 3, 4, '...', total];
  }
  if (current >= total - 2) {
    return [1, '...', total - 3, total - 2, total - 1, total];
  }
  return [1, '...', current - 1, current, current + 1, '...', total];
}

interface ReportSummary {
  id: string;
  candidateName: string;
  candidateEmail: string | null;
  jobTitle: string | null;
  status: 'completed' | 'terminated' | 'in_progress';
  completedAt: string;
  cognitiveScore: number | null;
  fluencyScore: number | null;
  fluencyCefr: string | null;
  terminationReason: string | null;
  recommendation: 'strong_yes' | 'yes' | 'maybe' | 'no' | null;
  recommendationRationale: string | null;
  flags: string[];
  voiceWarnings: number;
  faceWarnings: number;
  objectWarnings: number;
  hasReport: boolean;
  recordingLink?: string | null;
}

function ScoreRing({ value, color }: { value: number | null; color: string }) {
  const pct = value ?? 0;
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (pct / 100) * circumference;

  return (
    <div className="relative flex items-center justify-center w-16 h-16">
      <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={radius} fill="none" className="stroke-zinc-200 dark:stroke-zinc-700" strokeWidth="5" />
        <circle
          cx="32" cy="32" r={radius} fill="none"
          stroke={color} strokeWidth="5"
          strokeDasharray={circumference}
          strokeDashoffset={value === null ? circumference : dashOffset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <span className="absolute text-sm font-black text-zinc-900 dark:text-zinc-100">
        {value === null ? '—' : value}
      </span>
    </div>
  );
}

export default function InterviewReportsPage() {
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<{
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  }>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 1,
  });
  const [stats, setStats] = useState<{
    total: number;
    completed: number;
    terminated: number;
    avgCognitive: number | null;
  }>({
    total: 0,
    completed: 0,
    terminated: 0,
    avgCognitive: null,
  });

  const load = useCallback(async (targetPage = page) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/interview/reports?page=${targetPage}&limit=10`);
      const json = (await res.json()) as {
        reports?: ReportSummary[];
        pagination?: { page: number; limit: number; total: number; totalPages: number };
        stats?: { total: number; completed: number; terminated: number; avgCognitive: number | null };
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? 'Failed to load reports');
      setReports(json.reports ?? []);
      if (json.pagination) {
        setPagination(json.pagination);
        setPage(json.pagination.page);
      }
      if (json.stats) {
        setStats(json.stats);
      } else {
        const list = json.reports ?? [];
        setStats({
          total: json.pagination?.total ?? list.length,
          completed: list.filter((r) => r.status === 'completed').length,
          terminated: list.filter((r) => r.status === 'terminated').length,
          avgCognitive: null,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [page]);

  // Fetch data on page change
  useEffect(() => {
    const timer = setTimeout(() => {
      void load(page);
    }, 0);
    return () => clearTimeout(timer);
  }, [load, page]);

  const startItem = pagination.total === 0 ? 0 : (page - 1) * pagination.limit + 1;
  const endItem = Math.min(page * pagination.limit, pagination.total);

  return (
    <div className="min-h-screen bg-[#f8f9fa] dark:bg-[#121212] transition-colors" style={{ fontFamily: "'Inter', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');`}</style>

      {/* Header */}
      <header className="bg-white dark:bg-[#1e1e1e] border-b border-zinc-200 dark:border-zinc-800 sticky top-0 z-20 shadow-sm transition-colors">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/admin/dashboard" className="p-2 rounded-xl text-zinc-400 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#34c4f2] text-zinc-900 flex items-center justify-center font-black shadow-sm">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-base font-black text-zinc-900 dark:text-white leading-tight">Interview Reports</h1>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">All candidate evaluation summaries</p>
              </div>
            </div>
          </div>
          <button id="reports-refresh" type="button" onClick={() => void load(page)} className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 text-xs font-bold transition-all cursor-pointer">
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-7">

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Interviews', value: stats.total, Icon: Users, iconColor: 'bg-[#34c4f2]/10 dark:bg-[#34c4f2]/20 text-[#1689aa] dark:text-[#34c4f2]' },
            { label: 'Completed', value: stats.completed, Icon: CheckCircle2, iconColor: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400' },
            { label: 'Terminated', value: stats.terminated, Icon: XCircle, iconColor: 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400' },
            { label: 'Avg. Cognitive Score', value: stats.avgCognitive !== null ? `${stats.avgCognitive}/100` : '—', Icon: TrendingUp, iconColor: 'bg-[#34c4f2]/10 dark:bg-[#34c4f2]/20 text-[#1689aa] dark:text-[#34c4f2]' },
          ].map(({ label, value, Icon, iconColor }) => (
            <div key={label} className="bg-white dark:bg-[#1f1f1f] rounded-2xl p-5 border border-zinc-200 dark:border-zinc-800 shadow-card flex items-center gap-4 transition-colors">
              <div className={`w-11 h-11 rounded-xl ${iconColor} flex items-center justify-center flex-shrink-0`}>
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-black text-zinc-900 dark:text-white">{value}</p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 font-bold">{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Results summary bar */}
        {!loading && !error && pagination.total > 0 && (
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400 font-bold -mt-2">
            <p>
              Showing {startItem}–{endItem} of {pagination.total} candidates
            </p>
            {pagination.totalPages > 1 && (
              <span className="text-zinc-400 dark:text-zinc-500 font-semibold">
                Page {page} of {pagination.totalPages}
              </span>
            )}
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-8 h-8 animate-spin text-[#34c4f2]" />
          </div>
        ) : error ? (
          <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 rounded-2xl p-6 text-sm text-red-700 dark:text-red-300 font-medium">{error}</div>
        ) : reports.length === 0 ? (
          <div className="text-center py-20 text-zinc-400">
            <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-lg font-bold text-zinc-700 dark:text-zinc-200">No reports found</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">No interviews completed or terminated yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {reports.map((r) => {
              const isTerminated = r.status === 'terminated';
              const isOpening = openingId === r.id;

              return (
                <Link
                  key={r.id}
                  href={`/admin/reports/${r.id}`}
                  onClick={() => setOpeningId(r.id)}
                  className={`group block bg-white dark:bg-[#1f1f1f] rounded-2xl border shadow-card transition-all duration-200 ${
                    isOpening
                      ? 'border-[#34c4f2] ring-2 ring-[#34c4f2]/20 bg-zinc-50/50 dark:bg-zinc-800/40'
                      : 'border-zinc-200 dark:border-zinc-800 hover:border-[#34c4f2]/50 hover:shadow-lg'
                  }`}
                >
                  <div className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-5">

                    {/* Identity */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm flex-shrink-0 ${
                          isTerminated ? 'bg-red-500 text-white' : r.status === 'completed' ? 'bg-[#34c4f2] text-zinc-900' : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-800 dark:text-zinc-200'
                        }`}>
                          {r.candidateName.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-zinc-900 dark:text-white text-sm">{r.candidateName}</p>
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium truncate">{r.candidateEmail ?? '—'}</p>
                        </div>
                        {isTerminated ? (
                          <span className="flex items-center gap-1 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800/60 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg flex-shrink-0">
                            <ShieldAlert className="w-3 h-3" /> Terminated
                          </span>
                        ) : r.status === 'completed' ? (
                          <span className="flex items-center gap-1 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg flex-shrink-0">
                            <CheckCircle2 className="w-3 h-3" /> Completed
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 bg-[#34c4f2]/10 dark:bg-[#34c4f2]/20 text-[#1689aa] dark:text-[#34c4f2] border border-[#34c4f2]/30 dark:border-[#34c4f2]/40 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg flex-shrink-0">
                            <Clock className="w-3 h-3" /> In Progress
                          </span>
                        )}
                      </div>
                      {r.jobTitle && <p className="text-xs text-[#1689aa] dark:text-[#34c4f2] font-bold mb-1">🎯 {r.jobTitle}</p>}
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
                        {new Date(r.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>

                      {/* Full Interview Video Recording Link */}
                      {r.recordingLink && (
                        <div className="mt-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              window.open(r.recordingLink!, '_blank', 'noopener,noreferrer');
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-900/60 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800/60 text-xs font-bold rounded-lg transition-colors shadow-2xs cursor-pointer"
                          >
                            <Video className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                            <span>Watch Interview Video</span>
                            <span className="text-[10px]">↗</span>
                          </button>
                        </div>
                      )}

                      {/* Termination reason shown on main page */}
                      {isTerminated && r.terminationReason && (
                        <div className="mt-2.5 flex items-start gap-2 bg-red-50/90 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded-xl px-3 py-2 text-xs text-red-800 dark:text-red-200">
                          <ShieldAlert className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                          <p className="font-semibold leading-relaxed">
                            <span className="font-black text-red-900 dark:text-red-300">Termination Reason: </span>
                            {r.terminationReason}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Scores (Cognitive and Fluency only) & Action Arrow */}
                    <div className="flex items-center gap-6 flex-shrink-0">
                      {r.hasReport ? (
                        <div className="flex items-center gap-5">
                          <div className="text-center">
                            <ScoreRing value={r.cognitiveScore} color="#1689aa" />
                            <p className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mt-1">Cognitive</p>
                          </div>
                          <div className="text-center">
                            <ScoreRing value={r.fluencyScore} color="#34c4f2" />
                            <p className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mt-1">Fluency</p>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 text-xs font-bold flex-shrink-0 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3">
                          <Loader2 className="w-4 h-4 text-[#34c4f2] animate-spin" /> Scoring pending
                        </div>
                      )}

                      {/* Arrow / Loading Symbol */}
                      <div className="flex items-center justify-center min-w-[40px]">
                        {isOpening ? (
                          <div className="p-2.5 rounded-xl text-[#1689aa] dark:text-[#34c4f2] bg-[#34c4f2]/10 border border-[#34c4f2]/30 flex items-center gap-1.5 shadow-sm">
                            <Loader2 className="w-5 h-5 text-[#34c4f2] animate-spin" />
                            <span className="text-[11px] font-bold text-zinc-700 dark:text-zinc-200 hidden sm:inline">Opening…</span>
                          </div>
                        ) : (
                          <div className="p-2.5 rounded-xl text-zinc-400 group-hover:text-[#34c4f2] group-hover:bg-[#34c4f2]/10 transition-all">
                            <ChevronRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* Pagination Controls */}
        {!loading && !error && pagination.totalPages > 1 && (
          <div className="bg-white dark:bg-[#1f1f1f] rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-card p-4 flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 transition-colors">
            <p className="text-xs text-zinc-500 dark:text-zinc-400 font-semibold">
              Showing <span className="font-bold text-zinc-900 dark:text-white">{startItem}</span> to{' '}
              <span className="font-bold text-zinc-900 dark:text-white">{endItem}</span> of{' '}
              <span className="font-bold text-zinc-900 dark:text-white">{pagination.total}</span> candidates
            </p>
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                id="reports-pagination-prev"
                type="button"
                disabled={page <= 1}
                onClick={() => {
                  if (page > 1) {
                    setPage((p) => p - 1);
                    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  }
                }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Previous
              </button>

              {getPageNumbers(page, pagination.totalPages).map((pNum, idx) =>
                typeof pNum === 'number' ? (
                  <button
                    key={pNum}
                    type="button"
                    onClick={() => {
                      setPage(pNum);
                      if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }
                    }}
                    className={`min-w-[32px] h-8 px-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      page === pNum
                        ? 'bg-[#34c4f2] text-zinc-900 shadow-md shadow-[#34c4f2]/20 font-black'
                        : 'bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300'
                    }`}
                  >
                    {pNum}
                  </button>
                ) : (
                  <span key={`ellipsis-${idx}`} className="px-1 text-xs text-zinc-400 font-bold">
                    …
                  </span>
                )
              )}

              <button
                id="reports-pagination-next"
                type="button"
                disabled={page >= pagination.totalPages}
                onClick={() => {
                  if (page < pagination.totalPages) {
                    setPage((p) => p + 1);
                    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }
                  }
                }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
              >
                Next
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
