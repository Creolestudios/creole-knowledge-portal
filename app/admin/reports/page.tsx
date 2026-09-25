'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  FileText,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Search,
  ThumbsUp,
  ThumbsDown,
  HelpCircle,
  Star,
  ChevronRight,
  Users,
  Loader2,
  ShieldAlert,
  TrendingUp,
  Clock,
} from 'lucide-react';

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
  recommendation: 'strong_yes' | 'yes' | 'maybe' | 'no' | null;
  recommendationRationale: string | null;
  flags: string[];
  voiceWarnings: number;
  faceWarnings: number;
  objectWarnings: number;
  hasReport: boolean;
}

const REC_CONFIG = {
  strong_yes: {
    label: 'Strong Hire',
    light: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    icon: Star,
  },
  yes: {
    label: 'Recommended',
    light: 'bg-[#34c4f2]/10 text-[#1689aa] border-[#34c4f2]/30',
    icon: ThumbsUp,
  },
  maybe: {
    label: 'Needs Review',
    light: 'bg-amber-50 text-amber-700 border-amber-200',
    icon: HelpCircle,
  },
  no: {
    label: 'Not Recommended',
    light: 'bg-red-50 text-red-700 border-red-200',
    icon: ThumbsDown,
  },
} as const;

function ScoreRing({ value, color }: { value: number | null; color: string }) {
  const pct = value ?? 0;
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (pct / 100) * circumference;

  return (
    <div className="relative flex items-center justify-center w-16 h-16">
      <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={radius} fill="none" stroke="#e4e4e7" strokeWidth="5" />
        <circle
          cx="32" cy="32" r={radius} fill="none"
          stroke={color} strokeWidth="5"
          strokeDasharray={circumference}
          strokeDashoffset={value === null ? circumference : dashOffset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <span className="absolute text-sm font-black text-zinc-900">
        {value === null ? '—' : value}
      </span>
    </div>
  );
}

type FilterType = 'all' | 'completed' | 'terminated' | 'in_progress';
type RecFilter = 'all' | 'strong_yes' | 'yes' | 'maybe' | 'no' | 'pending';

export default function InterviewReportsPage() {
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterType>('all');
  const [recFilter, setRecFilter] = useState<RecFilter>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/interview/reports');
      const json = await res.json() as { reports?: ReportSummary[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? 'Failed to load reports');
      setReports(json.reports ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial data fetch — setState calls are inside an async function, not synchronous.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const filtered = reports.filter((r) => {
    const q = search.toLowerCase();
    const matchSearch =
      !search ||
      r.candidateName.toLowerCase().includes(q) ||
      (r.candidateEmail ?? '').toLowerCase().includes(q) ||
      (r.jobTitle ?? '').toLowerCase().includes(q);
    const matchStatus = statusFilter === 'all' || r.status === statusFilter;
    const matchRec =
      recFilter === 'all' ||
      (recFilter === 'pending' && !r.recommendation) ||
      r.recommendation === recFilter;
    return matchSearch && matchStatus && matchRec;
  });

  const total = reports.length;
  const completed = reports.filter((r) => r.status === 'completed').length;
  const terminated = reports.filter((r) => r.status === 'terminated').length;
  const scored = reports.filter((r) => r.cognitiveScore !== null);
  const avgCognitive =
    scored.length > 0
      ? Math.round(scored.reduce((a, r) => a + (r.cognitiveScore ?? 0), 0) / scored.length)
      : null;

  return (
    <div className="min-h-screen bg-[#f8f9fa]" style={{ fontFamily: "'Inter', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');`}</style>

      {/* Header */}
      <header className="bg-white border-b border-zinc-200 sticky top-0 z-20 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/admin/dashboard" className="p-2 rounded-xl text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#34c4f2] text-zinc-900 flex items-center justify-center font-black shadow-sm">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-base font-black text-zinc-900 leading-tight">Interview Reports</h1>
                <p className="text-xs text-zinc-500 font-medium">All candidate evaluation summaries</p>
              </div>
            </div>
          </div>
          <button id="reports-refresh" type="button" onClick={() => void load()} className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-800 text-xs font-bold transition-all cursor-pointer">
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-7">

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Interviews', value: total, Icon: Users, iconColor: 'bg-[#34c4f2]/10 text-[#1689aa]' },
            { label: 'Completed', value: completed, Icon: CheckCircle2, iconColor: 'bg-emerald-50 text-emerald-700' },
            { label: 'Terminated', value: terminated, Icon: XCircle, iconColor: 'bg-red-50 text-red-700' },
            { label: 'Avg. Cognitive Score', value: avgCognitive !== null ? `${avgCognitive}/100` : '—', Icon: TrendingUp, iconColor: 'bg-[#34c4f2]/10 text-[#1689aa]' },
          ].map(({ label, value, Icon, iconColor }) => (
            <div key={label} className="bg-white rounded-2xl p-5 border border-zinc-200 shadow-card flex items-center gap-4">
              <div className={`w-11 h-11 rounded-xl ${iconColor} flex items-center justify-center flex-shrink-0`}>
                <Icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-black text-zinc-900">{value}</p>
                <p className="text-xs text-zinc-500 font-bold">{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="bg-white rounded-2xl border border-zinc-200 shadow-card p-4 flex flex-col md:flex-row gap-3 items-start md:items-center">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <input
              id="reports-search"
              type="text"
              placeholder="Search candidate name, email or role…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-zinc-50 border border-zinc-200 text-xs text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#34c4f2] focus:border-transparent font-medium transition-all"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(['all', 'completed', 'terminated', 'in_progress'] as FilterType[]).map((s) => (
              <button key={s} type="button" onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold capitalize transition-all cursor-pointer ${
                  statusFilter === s
                    ? 'bg-[#34c4f2] text-zinc-900 shadow-md shadow-[#34c4f2]/20'
                    : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900'
                }`}>
                {s === 'all' ? 'All' : s === 'in_progress' ? 'In Progress' : s}
              </button>
            ))}
            <span className="text-zinc-300 text-sm">|</span>
            {([
              { key: 'all' as RecFilter, label: 'All Verdicts' },
              { key: 'strong_yes' as RecFilter, label: '⭐ Strong Hire' },
              { key: 'yes' as RecFilter, label: '✅ Hire' },
              { key: 'maybe' as RecFilter, label: '⚠️ Review' },
              { key: 'no' as RecFilter, label: '❌ No' },
              { key: 'pending' as RecFilter, label: '⏳ Pending' },
            ]).map(({ key, label }) => (
              <button key={key} type="button" onClick={() => setRecFilter(key)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                  recFilter === key
                    ? 'bg-[#34c4f2] text-zinc-900 shadow-md shadow-[#34c4f2]/20'
                    : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200/70 hover:text-zinc-900'
                }`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Results count */}
        {!loading && !error && (
          <p className="text-xs text-zinc-500 font-bold -mt-4">
            Showing {filtered.length} of {reports.length} candidates
          </p>
        )}

        {/* List */}
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="w-8 h-8 animate-spin text-[#34c4f2]" />
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-sm text-red-700 font-medium">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-zinc-400">
            <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-lg font-bold text-zinc-700">No reports found</p>
            <p className="text-xs text-zinc-500 mt-1">{reports.length === 0 ? 'No interviews completed or terminated yet.' : 'Try adjusting your search or filters.'}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((r) => {
              const rec = r.recommendation;
              const recCfg = rec ? REC_CONFIG[rec] : null;
              const totalWarnings = r.voiceWarnings + r.faceWarnings + r.objectWarnings;
              const isTerminated = r.status === 'terminated';

              return (
                <Link key={r.id} href={`/admin/reports/${r.id}`}
                  className="group block bg-white rounded-2xl border border-zinc-200 shadow-card hover:border-[#34c4f2]/50 hover:shadow-lg transition-all duration-200">
                  <div className="p-5 flex flex-col md:flex-row md:items-center gap-5">

                    {/* Identity */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm flex-shrink-0 ${
                          isTerminated ? 'bg-red-500 text-white' : r.status === 'completed' ? 'bg-[#34c4f2] text-zinc-900' : 'bg-zinc-200 text-zinc-800'
                        }`}>
                          {r.candidateName.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-zinc-900 text-sm">{r.candidateName}</p>
                          <p className="text-xs text-zinc-500 font-medium truncate">{r.candidateEmail ?? '—'}</p>
                        </div>
                        {isTerminated ? (
                          <span className="flex items-center gap-1 bg-red-50 text-red-700 border border-red-200 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg flex-shrink-0">
                            <ShieldAlert className="w-3 h-3" /> Terminated
                          </span>
                        ) : r.status === 'completed' ? (
                          <span className="flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg flex-shrink-0">
                            <CheckCircle2 className="w-3 h-3" /> Completed
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 bg-[#34c4f2]/10 text-[#1689aa] border border-[#34c4f2]/30 text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-lg flex-shrink-0">
                            <Clock className="w-3 h-3" /> In Progress
                          </span>
                        )}
                      </div>
                      {r.jobTitle && <p className="text-xs text-[#1689aa] font-bold mb-1">🎯 {r.jobTitle}</p>}
                      <p className="text-xs text-zinc-500 font-medium">
                        {new Date(r.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                      {r.flags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {r.flags.map((f) => (
                            <span key={f} className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 rounded-lg px-2 py-0.5 font-bold">
                              {f.replaceAll('_', ' ')}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Scores */}
                    {r.hasReport ? (
                      <div className="flex items-center gap-5 flex-shrink-0">
                        <div className="text-center">
                          <ScoreRing value={r.cognitiveScore} color="#1689aa" />
                          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mt-1">Cognitive</p>
                        </div>
                        <div className="text-center">
                          <ScoreRing value={r.fluencyScore} color="#34c4f2" />
                          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mt-1">Fluency</p>
                        </div>
                        {r.fluencyCefr && (
                          <div className="text-center">
                            <div className="w-16 h-16 flex items-center justify-center">
                              <span className="text-2xl font-black text-[#1689aa]">{r.fluencyCefr}</span>
                            </div>
                            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">CEFR</p>
                          </div>
                        )}
                        {totalWarnings > 0 && (
                          <div className="flex flex-col items-center gap-1">
                            <div className="flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl px-3 py-1.5">
                              <AlertTriangle className="w-4 h-4" />
                              <span className="text-sm font-black">{totalWarnings}</span>
                            </div>
                            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Warnings</p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-zinc-500 text-xs font-bold flex-shrink-0 bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3">
                        <Loader2 className="w-4 h-4 text-[#34c4f2] animate-spin" /> Scoring pending
                      </div>
                    )}

                    {/* Verdict */}
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {recCfg ? (
                        <div className={`px-4 py-2.5 rounded-xl border text-xs font-black flex items-center gap-2 ${recCfg.light}`}>
                          <recCfg.icon className="w-4 h-4" />
                          {recCfg.label}
                        </div>
                      ) : (
                        <div className="px-4 py-2.5 rounded-xl border border-zinc-200 bg-zinc-50 text-xs font-bold text-zinc-400">
                          No verdict yet
                        </div>
                      )}
                      <ChevronRight className="w-5 h-5 text-zinc-300 group-hover:text-[#34c4f2] group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </div>

                  {/* Plain-English summary strip */}
                  {r.recommendationRationale && (
                    <div className="border-t border-zinc-100 px-5 py-3 bg-zinc-50/70 rounded-b-2xl">
                      <p className="text-xs text-zinc-700 leading-relaxed line-clamp-2">
                        <span className="font-bold text-zinc-900">Summary: </span>
                        {r.recommendationRationale}
                      </p>
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
