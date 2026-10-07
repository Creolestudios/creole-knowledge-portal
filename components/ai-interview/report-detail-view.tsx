'use client';

import React, { useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Volume2,
  Eye,
  ShieldCheck,
  ShieldAlert,
  Mic,
  Star,
  MessageSquare,
  TrendingUp,
  User,
  Copy,
  Check,
  Sparkles,
  FileText,
  Video,
} from 'lucide-react';

export interface ReportDetailViewProps {
  session: {
    id: string;
    candidate_name?: string | null;
    candidate_email?: string | null;
    status: string;
    created_at: string;
    updated_at?: string | null;
    parsed_jd?: { jobTitle?: string } | null;
    // Injected server-side from proctoring_violation events (not a real column)
    termination_reason?: string | null;
    // Injected server-side from interview_invites.status
    invite_status?: string | null;
  };
  recording?: {
    fileId: string;
    webViewLink: string;
    previewUrl: string;
    fileName?: string;
  } | null;
  report: {
    id?: string;
    cognitive_composite?: number | null;
    reasoning_subscore?: number | null;
    clarity_subscore?: number | null;
    fluency_score?: number | null;
    fluency_cefr?: string | null;
    fluency_breakdown?: Record<string, unknown> | null;
    competency_scores?: Array<{
      ord: number;
      competency: string;
      score: number;
      justification: string;
      evidence?: Array<{ quote: string }>;
      bluff_suspected?: boolean;
    }> | null;
    local_metrics?: {
      wpm?: number;
      fillerRatio?: number;
      pauseRate?: number;
    } | null;
    recommendation?: 'strong_yes' | 'yes' | 'maybe' | 'no' | null;
    recommendation_rationale?: string | null;
    flags?: string[] | null;
  } | null;
  questions: Array<{
    id: string;
    question_order?: number;
    order_index?: number;
    question_text: string;
    competency?: string;
    category?: string;
    question_type?: string;
    is_mandatory_hr?: boolean;
  }>;
  answers: Array<{
    id: string;
    question_id: string;
    transcript?: string | null;
  }>;
  transcript: Array<{
    id: string;
    speaker: string;
    text: string;
    ts_ms?: number;
    is_flagged?: boolean;
    question_ord?: number;
  }>;
  voiceWarningCount: number;
  faceWarningCount: number;
  objectWarningCount: number;
  totalWarnings: number;
  proctoringWarnings?: ProctoringWarningItem[];
  followUpQuestions: string[];
}

export interface ProctoringWarningItem {
  id: string;
  strikeNumber?: number;
  category: 'voice' | 'face' | 'object' | 'general';
  categoryLabel: string;
  reason: string;
  timestamp?: string;
  severity?: string;
  snapshotPath?: string | null;
}

function starRating(score: number): { filled: number; label: string; color: string } {
  if (score <= 0) return { filled: 0, label: 'Not Scored', color: 'text-zinc-400 dark:text-[#9f9f9f]' };
  if (score >= 5) return { filled: 5, label: 'Excellent', color: 'text-amber-500' };
  if (score >= 4) return { filled: 4, label: 'Strong', color: 'text-amber-500' };
  if (score >= 3) return { filled: 3, label: 'Adequate', color: 'text-amber-500' };
  if (score >= 2) return { filled: 2, label: 'Needs Improvement', color: 'text-amber-500' };
  return { filled: 1, label: 'Poor', color: 'text-amber-500' };
}

function cefrToPlain(cefr: string): { label: string; desc: string } {
  const map: Record<string, { label: string; desc: string }> = {
    A2: { label: 'Basic English', desc: 'Can communicate simple ideas but struggles with complex sentences.' },
    B1: { label: 'Intermediate English', desc: 'Can handle everyday topics. Some errors in grammar or vocabulary.' },
    B2: { label: 'Good English (Professional)', desc: 'Communicates clearly, naturally, and effectively in workplace scenarios.' },
    C1: { label: 'Advanced English', desc: 'Speaks fluently, smoothly, and precisely with high technical nuance.' },
    C2: { label: 'Fluent English (Mastery)', desc: 'Near-native proficiency with exceptional vocabulary and coherence.' },
  };
  return map[cefr] ?? { label: cefr, desc: '' };
}

function ScoreGauge({ value, max = 100, color = '#34c4f2', label }: { value: number | null; max?: number; color?: string; label: string }) {
  const pct = value !== null ? Math.round((value / max) * 100) : 0;
  const r = 40;
  const circ = 2 * Math.PI * r;
  const dashOffset = circ - (pct / 100) * circ;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative w-20 h-20">
        <svg className="w-20 h-20 -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={r} fill="none" stroke="#f1f5f9" strokeWidth="8" />
          <circle
            cx="50" cy="50" r={r} fill="none"
            stroke={color} strokeWidth="8"
            strokeDasharray={circ}
            strokeDashoffset={value === null ? circ : dashOffset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.8s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-black text-zinc-900 dark:text-white">
            {value === null ? '—' : value}
          </span>
          <span className="text-[10px] text-zinc-500 dark:text-[#9f9f9f] font-bold">/{max}</span>
        </div>
      </div>
      <p className="text-[11px] font-bold text-zinc-600 uppercase tracking-wider text-center">{label}</p>
    </div>
  );
}

function ProgressBar({ value, color = '#34c4f2' }: { value: number; color?: string }) {
  return (
    <div className="h-2 rounded-full bg-zinc-100 dark:bg-[#2b2b2b] overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${Math.min(100, Math.max(0, value))}%`, backgroundColor: color }}
      />
    </div>
  );
}

function WarningIndicator({ count, max = 3, label }: { count: number; max?: number; label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex gap-1">
        {Array.from({ length: max }).map((_, i) => (
          <div
            key={i}
            className={`w-3.5 h-3.5 rounded-full border ${
              i < count
                ? 'bg-red-500 border-red-500'
                : 'bg-zinc-100 dark:bg-[#2b2b2b] border-zinc-300'
            }`}
          />
        ))}
      </div>
      <span className="text-xs font-bold text-zinc-700 dark:text-[#d9d9d9]">
        {count}/{max} {label}
      </span>
    </div>
  );
}

export function isHRQuestion(q: {
  category?: string;
  question_type?: string;
  is_mandatory_hr?: boolean;
  competency?: string;
  question_text?: string;
}): boolean {
  if (q.is_mandatory_hr) return true;
  const cat = (q.category || '').toLowerCase().trim();
  const type = (q.question_type || '').toLowerCase().trim();
  const comp = (q.competency || '').toLowerCase().trim();
  const text = (q.question_text || '').toLowerCase().trim();

  if (
    cat === 'hr' ||
    cat === 'behavioral' ||
    cat === 'culture_fit' ||
    cat === 'teamwork' ||
    cat === 'adaptability' ||
    cat === 'conflict_resolution' ||
    cat === 'work_preferences' ||
    cat === 'career_vision' ||
    cat === 'experience_overview' ||
    cat === 'role_alignment'
  ) {
    return true;
  }

  if (type === 'hr' || type === 'behavioral') {
    return true;
  }

  if (
    comp.includes('hr') ||
    comp.includes('culture') ||
    comp.includes('behavioral') ||
    comp.includes('soft') ||
    comp.includes('communication') ||
    comp.includes('teamwork') ||
    comp.includes('adaptability') ||
    comp.includes('conflict') ||
    comp.includes('self-awareness') ||
    comp.includes('work preference')
  ) {
    return true;
  }

  if (
    text.includes('introduce yourself') ||
    text.includes('notice period') ||
    text.includes('tell us about a time') ||
    text.includes('career journey') ||
    text.includes('team values')
  ) {
    return true;
  }

  return false;
}

export function ReportDetailView({
  session,
  recording,
  report,
  questions,
  answers,
  transcript,
  voiceWarningCount,
  faceWarningCount,
  objectWarningCount,
  totalWarnings,
  proctoringWarnings = [],
  followUpQuestions,
}: ReportDetailViewProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'hr' | 'technical' | 'transcript'>('hr');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const [reportGenError, setReportGenError] = useState<string | null>(null);

  const handleGenerateReport = useCallback(async () => {
    setIsGeneratingReport(true);
    setReportGenError(null);
    try {
      const res = await fetch(`/api/interview/${session.id}/score`, { method: 'POST' });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || `Scoring failed (${res.status})`);
      }
      // Force clean reload from server
      window.location.reload();
    } catch (err) {
      setReportGenError(err instanceof Error ? err.message : 'Failed to generate report.');
    } finally {
      setIsGeneratingReport(false);
    }
  }, [session.id]);

  const rawStatus = session.status || 'draft';
  const inviteStatus = session.invite_status || '';

  // Derive true status using BOTH session.status and invite.status.
  // DB session statuses: 'completed', 'cancelled', 'in_progress',
  //   'questions_generated', 'invite_issued', 'draft'
  // DB invite statuses: 'completed', 'revoked', 'active', 'in_progress'
  const isTerminated =
    rawStatus === 'cancelled' ||
    rawStatus === 'terminated' ||
    inviteStatus === 'revoked';
  const isCompleted =
    rawStatus === 'completed' ||
    inviteStatus === 'completed' ||
    (!isTerminated && Boolean(report?.recommendation));

  const rec = report?.recommendation ?? (isTerminated ? 'no' : isCompleted ? 'yes' : 'maybe');
  const cefr = report?.fluency_cefr ?? null;
  const cefrInfo = cefr ? cefrToPlain(cefr) : null;

  const VERDICT = {
    strong_yes: {
      emoji: '🌟',
      title: 'Strong Hire',
      desc: 'Candidate stood out with exceptional depth, structured thinking, clear English communication, and zero integrity flags.',
      badge: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      border: 'border-emerald-200',
    },
    yes: {
      emoji: '✅',
      title: 'Recommended to Hire',
      desc: 'Solid performance across technical competencies and communication. Recommended to advance to Round 2.',
      badge: 'bg-[#34c4f2]/10 text-[#1689aa] border-[#34c4f2]/30',
      border: 'border-[#34c4f2]/50',
    },
    maybe: {
      emoji: '⚠️',
      title: 'Needs Further Review',
      desc: 'Candidate showed potential but demonstrated noticeable gaps in depth, communication, or proctoring stability. Human interview review recommended.',
      badge: 'bg-amber-50 text-amber-700 border-amber-200',
      border: 'border-amber-200',
    },
    no: {
      emoji: '❌',
      title: 'Not Recommended',
      desc: 'Did not meet the role benchmark due to inaccurate technical answers, language barriers, or proctoring termination.',
      badge: 'bg-red-50 text-red-700 border-red-200',
      border: 'border-red-200',
    },
  } as const;

  const verdictCfg = VERDICT[rec as keyof typeof VERDICT] ?? VERDICT['maybe'];

  const candidateTranscript = transcript.filter((t) => t.speaker === 'candidate' && !t.is_flagged);

  // Fluency breakdown is the full parsed object from Gemini: { cefr, sub: { grammar, vocabulary, coherence, fluency }, summary, ... }
  const fluencyBreakdown = report?.fluency_breakdown as {
    cefr?: string;
    sub?: {
      grammar?: { band?: number; notes?: string };
      vocabulary?: { band?: number; notes?: string };
      coherence?: { band?: number; notes?: string };
      fluency?: { band?: number; notes?: string };
    };
    summary?: string;
    language_switch_detected?: boolean;
    non_english_percentage?: number;
    follow_up_recommendations?: string[];
  } | null;

  // sub is nested inside fluency_breakdown — NOT directly on fluency_breakdown
  const fluencySub = fluencyBreakdown?.sub ?? null;

  const competencyScores = (report?.competency_scores ?? []) as Array<{
    ord: number;
    competency: string;
    score: number;
    justification: string;
    evidence?: Array<{ quote: string }>;
    bluff_suspected?: boolean;
  }>;

  // ── Database Answer Retrieval ──────────────────────────────────────
  // 1. Map by question UUID: question_id -> transcript
  const answerByQuestionId = new Map(
    answers.filter((a) => a.question_id).map((a) => [a.question_id, (a.transcript || '').trim()])
  );

  // 2. Map by array index in answers (0-indexed)
  const answerByIndex = new Map(
    answers.map((a, idx) => [idx, (a.transcript || '').trim()])
  );

  // Retrieves the true verbatim candidate answer from database across all persistence strategies
  const getCandidateAnswer = (qId: string, ord: number, qIdx: number): string => {
    // A. Direct lookup by question UUID
    const byId = answerByQuestionId.get(qId);
    if (byId && byId.trim().length > 0) return byId.trim();

    // B. Direct lookup by stringified order ('1', '2', etc.)
    const byOrdStr = answerByQuestionId.get(String(ord));
    if (byOrdStr && byOrdStr.trim().length > 0) return byOrdStr.trim();

    // C. Lookup in answers list by question_id matching qId or ord
    const foundAns = answers.find(
      (a) => a.question_id === qId || a.question_id === String(ord)
    );
    if (foundAns?.transcript && foundAns.transcript.trim().length > 0) {
      return foundAns.transcript.trim();
    }

    // D. Positional match in answers array (only if answer does not have a conflicting question_id)
    const targetAns = answers[qIdx];
    if (targetAns && (!targetAns.question_id || targetAns.question_id === qId || targetAns.question_id === String(ord))) {
      const byIndex = (targetAns.transcript || '').trim();
      if (byIndex.length > 0) return byIndex;
    }

    // E. Match in interview_transcript table by tagged question_ord
    const transcriptByOrd = transcript
      .filter((t) => t.speaker === 'candidate' && !t.is_flagged && t.question_ord === ord && t.text?.trim())
      .map((t) => t.text.trim())
      .join(' ')
      .trim();
    if (transcriptByOrd.length > 0) return transcriptByOrd;

    // F. Match in interview_transcript table by sequence index if not tagged with question_ord (only if no structured answers exist)
    if (answers.length === 0) {
      const candidateUtterances = transcript.filter((t) => t.speaker === 'candidate' && !t.is_flagged && t.text?.trim());
      if (candidateUtterances[qIdx]?.text?.trim()) {
        return candidateUtterances[qIdx].text.trim();
      }
    }

    // G. Evidence quote from scoring report in DB
    const scoreEvidence = competencyScores.find((cs) => cs.ord === ord)?.evidence?.[0]?.quote?.trim();
    if (scoreEvidence && scoreEvidence.length > 0) {
      return scoreEvidence;
    }

    return '';
  };

  // Split questions into HR and Technical
  const hrQuestions = questions.filter(isHRQuestion);
  const techQuestions = questions.filter((q) => !isHRQuestion(q));

  const copyQuestionToClipboard = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      // fallback
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f9fa]" style={{ fontFamily: "'Inter', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');`}</style>

      {/* Sticky Top Header */}
      <header className="bg-white dark:bg-[#2b2b2b] border-b border-zinc-200 dark:border-[#4a4a4a] sticky top-0 z-20 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/admin/reports" className="p-2 rounded-xl text-zinc-400 dark:text-[#9f9f9f] hover:text-zinc-900 dark:text-white hover:bg-zinc-100 dark:hover:bg-[#1f1f1f] dark:bg-[#2b2b2b] transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#34c4f2] text-zinc-900 dark:text-white flex items-center justify-center font-black shadow-sm">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-base font-black text-zinc-900 dark:text-white leading-tight">
                  {session.candidate_name ?? 'Candidate'} — Interview Result
                </h1>
                <p className="text-xs text-zinc-500 dark:text-[#9f9f9f] font-medium">Session {session.id.slice(0, 8)}…</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider border ${
              isCompleted ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
              isTerminated ? 'bg-red-50 text-red-700 border-red-200' :
              'bg-[#34c4f2]/10 text-[#1689aa] border-[#34c4f2]/30'
            }`}>
              {isTerminated ? '🚫 Terminated' : isCompleted ? '✅ Completed' : '⏳ In Progress'}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-7">

        {/* ── 1. Termination Banner (if applicable) ───────── */}
        {isTerminated && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-red-950">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0 text-red-700">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-red-900 mb-1">Interview Terminated by Proctoring Guard</h2>
                <p className="text-red-800 text-xs leading-relaxed max-w-2xl">
                  The automated proctoring guard terminated this interview session due to integrity violations
                  {totalWarnings > 0 ? ` (${totalWarnings} total warning${totalWarnings === 1 ? '' : 's'})` : ''}. This candidate is flagged for HR review.
                </p>
                {(session.termination_reason || report?.recommendation_rationale) && (
                  <p className="mt-2 text-xs font-bold text-red-700 uppercase tracking-wider">
                    {session.termination_reason || report?.recommendation_rationale}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── 2. Verdict Hero ─────────────────────────────── */}
        {verdictCfg ? (
          <div className={`bg-white dark:bg-[#2b2b2b] rounded-2xl border-2 ${verdictCfg.border} shadow-card p-6 sm:p-7`}>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="space-y-3 max-w-2xl">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{verdictCfg.emoji}</span>
                  <div>
                    <span className={`inline-block px-2.5 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider border mb-1 ${verdictCfg.badge}`}>
                      Evaluation Verdict
                    </span>
                    <h2 className="text-2xl font-black text-zinc-900 dark:text-white">{verdictCfg.title}</h2>
                  </div>
                </div>
                <p className="text-sm leading-relaxed text-zinc-600 font-medium">{verdictCfg.desc}</p>
                {report?.recommendation_rationale && (
                  <div className="bg-zinc-50 dark:bg-[#1f1f1f] border border-zinc-200 dark:border-[#4a4a4a] rounded-xl px-4 py-3 text-xs leading-relaxed text-zinc-800 dark:text-[#d9d9d9]">
                    <span className="font-bold text-zinc-900 dark:text-white">Key Rationale: </span>
                    {report.recommendation_rationale}
                  </div>
                )}
              </div>
              {/* Score gauges */}
              <div className="flex flex-col items-end gap-3 flex-shrink-0">
                <div className="flex items-center gap-6 bg-zinc-50 dark:bg-[#1f1f1f] border border-zinc-200 dark:border-[#4a4a4a] rounded-xl px-6 py-4">
                  <ScoreGauge
                    value={
                      report?.cognitive_composite !== null && report?.cognitive_composite !== undefined
                        ? report.cognitive_composite
                        : isTerminated
                        ? 0
                        : null
                    }
                    color="#1689aa"
                    label="Technical Depth"
                  />
                  <ScoreGauge
                    value={
                      report?.fluency_score !== null && report?.fluency_score !== undefined
                        ? report.fluency_score
                        : isTerminated
                        ? 0
                        : null
                    }
                    color="#34c4f2"
                    label="Communication"
                  />
                </div>
                {/* Always offer Re-evaluate / Refresh Scores */}
                <button
                  type="button"
                  onClick={handleGenerateReport}
                  disabled={isGeneratingReport}
                  className="text-xs font-bold px-3.5 py-1.5 rounded-xl bg-zinc-100 dark:bg-[#2b2b2b] text-zinc-700 dark:text-[#d9d9d9] hover:bg-[#34c4f2] hover:text-zinc-900 dark:text-white border border-zinc-200 dark:border-[#4a4a4a] disabled:opacity-50 transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {isGeneratingReport ? '⏳ Re-evaluating…' : 'Re-evaluate Scores'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white dark:bg-[#2b2b2b] rounded-2xl border border-zinc-200 dark:border-[#4a4a4a] shadow-card p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <Clock className="w-8 h-8 text-zinc-400 dark:text-[#9f9f9f] flex-shrink-0" />
              <div className="flex-1">
                <h2 className="text-lg font-bold text-zinc-900 dark:text-white">Evaluation Pending</h2>
                <p className="text-xs text-zinc-500 dark:text-[#9f9f9f] mt-0.5">
                  Scoring runs automatically after the session ends. If scores are missing, click Generate Report.
                </p>
                {reportGenError && (
                  <p className="text-xs text-red-600 mt-1 font-medium">{reportGenError}</p>
                )}
              </div>
              <button
                type="button"
                onClick={handleGenerateReport}
                disabled={isGeneratingReport}
                className="px-5 py-2.5 rounded-xl bg-[#34c4f2] text-zinc-900 dark:text-white text-xs font-black hover:bg-[#2db0db] disabled:opacity-50 transition-all shadow-lg shadow-[#34c4f2]/20 flex items-center gap-2 cursor-pointer flex-shrink-0"
              >
                {isGeneratingReport ? (
                  <><span className="inline-block w-3.5 h-3.5 border-2 border-zinc-900/30 border-t-zinc-900 rounded-full animate-spin" />Generating…</>
                ) : (
                  <>⚡ Generate Report</>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ── 3. Quick-glance Candidate Overview ──────────── */}
        <div className="bg-white dark:bg-[#2b2b2b] rounded-2xl border border-zinc-200 dark:border-[#4a4a4a] shadow-card p-6">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-8 h-8 rounded-lg bg-[#34c4f2]/10 flex items-center justify-center text-[#1689aa]">
              <User className="w-4 h-4" />
            </div>
            <h2 className="text-sm font-black text-zinc-900 dark:text-white">Candidate Information</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            {[
              { label: 'Name', value: session.candidate_name ?? '—' },
              { label: 'Email', value: session.candidate_email ?? '—' },
              { label: 'Role Applied', value: session.parsed_jd?.jobTitle ?? '—' },
              { label: 'Interview Date', value: new Date(session.updated_at ?? session.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) },
            ].map(({ label, value }) => (
              <div key={label} className="bg-zinc-50 dark:bg-[#1f1f1f] rounded-xl p-3 border border-zinc-200 dark:border-[#4a4a4a]">
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-[#9f9f9f] mb-0.5">{label}</p>
                <p className="font-bold text-zinc-900 dark:text-white text-xs truncate">{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Full Interview Video Recording Card (Google Drive) ──── */}
        {recording && (
          <div
            id="report-video-recording-card"
            className="bg-white dark:bg-[#2b2b2b] rounded-2xl border border-zinc-200 dark:border-[#4a4a4a] shadow-card p-6 space-y-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-red-500/10 text-red-600 flex items-center justify-center font-black shadow-sm">
                  <Video className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-zinc-900 dark:text-white text-base">
                    Full Interview Video Recording
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-[#9f9f9f] font-medium">
                    Continuous Screen Share + Candidate Camera (PiP) + Audio stored in Google Drive
                  </p>
                </div>
              </div>
              <a
                id="open-drive-video-link"
                href={recording.webViewLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 hover:bg-[#1689aa] text-white text-xs font-bold rounded-xl transition-colors shadow-sm self-start sm:self-auto cursor-pointer"
              >
                <span>Open in Google Drive</span>
                <span className="text-xs">↗</span>
              </a>
            </div>

            {/* Embedded Drive Preview Player */}
            <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black border border-zinc-200 dark:border-zinc-800 shadow-inner">
              <iframe
                src={recording.previewUrl}
                title="Interview Video Recording"
                className="w-full h-full border-0"
                allow="autoplay; encrypted-media"
                allowFullScreen
              />
            </div>
          </div>
        )}

        {/* ── 4. Main Dual-Perspective Tab Switcher (Matching Portal Theme) ────────── */}
        <div className="bg-zinc-100 dark:bg-[#2b2b2b] p-1.5 rounded-2xl border border-zinc-200 dark:border-[#4a4a4a] inline-flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('hr')}
            className={`px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'hr'
                ? 'bg-[#34c4f2] text-zinc-900 dark:text-white shadow-md shadow-[#34c4f2]/20'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-white hover:bg-zinc-200/60'
            }`}
          >
            <User className="w-4 h-4" />
            <span>👔 HR & Non-Technical View</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('technical')}
            className={`px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'technical'
                ? 'bg-[#34c4f2] text-zinc-900 dark:text-white shadow-md shadow-[#34c4f2]/20'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-white hover:bg-zinc-200/60'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            <span>💻 Technical Evaluation & Round 2 Questions</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('transcript')}
            className={`px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'transcript'
                ? 'bg-[#34c4f2] text-zinc-900 dark:text-white shadow-md shadow-[#34c4f2]/20'
                : 'text-zinc-600 hover:text-zinc-900 dark:text-white hover:bg-zinc-200/60'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>📝 Full Transcript ({candidateTranscript.length})</span>
          </button>
        </div>

        {/* ═════════════════════════════════════════════════════════ */}
        {/* TAB 1: HR & Non-Technical View                          */}
        {/* ═════════════════════════════════════════════════════════ */}
        {activeTab === 'hr' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

              {/* Communication Card */}
              <div className="bg-white dark:bg-[#2b2b2b] rounded-2xl border border-zinc-200 dark:border-[#4a4a4a] shadow-card p-6 space-y-5">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#34c4f2]/10 flex items-center justify-center text-[#1689aa]">
                    <Volume2 className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-black text-zinc-900 dark:text-white text-sm">English Communication</h3>
                    <p className="text-xs text-zinc-500 dark:text-[#9f9f9f] font-medium">Fluency, vocabulary, and speaking clarity</p>
                  </div>
                </div>

                {/* CEFR or Zero-Speech Notice */}
                {cefrInfo ? (
                  <div className="text-center py-2 bg-[#34c4f2]/5 rounded-xl p-4 border border-[#34c4f2]/20">
                    <span className="text-3xl font-black text-[#1689aa]">{cefr}</span>
                    <p className="text-sm font-bold text-zinc-900 dark:text-white mt-0.5">{cefrInfo.label}</p>
                    <p className="text-xs text-zinc-600 mt-1 leading-relaxed max-w-md mx-auto">{cefrInfo.desc}</p>
                  </div>
                ) : (
                  <div className="text-center py-3 bg-zinc-50 dark:bg-[#1f1f1f] rounded-xl p-4 border border-zinc-200 dark:border-[#4a4a4a]">
                    <span className="text-2xl font-black text-zinc-800 dark:text-[#d9d9d9]">
                      {report?.fluency_score !== null && report?.fluency_score !== undefined && report.fluency_score > 0
                        ? `${report.fluency_score} / 100`
                        : '0 / 100'}
                    </span>
                    <p className="text-xs font-bold text-zinc-800 dark:text-[#d9d9d9] mt-0.5">
                      {report?.fluency_score !== null && report?.fluency_score !== undefined && report.fluency_score > 0
                        ? 'Spoken Fluency Score'
                        : 'No Verbal Responses Recorded'}
                    </p>
                    <p className="text-[11px] text-zinc-500 dark:text-[#9f9f9f] mt-1 leading-relaxed max-w-md mx-auto">
                      {report?.fluency_score !== null && report?.fluency_score !== undefined && report.fluency_score > 0
                        ? 'Evaluated across candidate spoken answers and speech cadence.'
                        : 'Candidate skipped questions or microphone audio was absent during interview turns.'}
                    </p>
                  </div>
                )}

                {/* Fluency Sub-Scores: Always Render All 4 Categories */}
                <div className="space-y-2.5">
                  {[
                    { key: 'grammar', label: 'Grammar & Accuracy' },
                    { key: 'vocabulary', label: 'Vocabulary Range' },
                    { key: 'coherence', label: 'Structured Coherence' },
                    { key: 'fluency', label: 'Fluency & Flow' },
                  ].map(({ key, label }) => {
                    const sub = fluencySub?.[key as keyof typeof fluencySub];
                    const bandScore =
                      sub?.band !== undefined && sub?.band !== null
                        ? sub.band
                        : report?.fluency_score !== null && report?.fluency_score !== undefined && report.fluency_score > 0
                        ? report.fluency_score
                        : 0;

                    return (
                      <div key={key}>
                        <div className="flex justify-between text-xs font-semibold mb-1">
                          <span className="text-zinc-600">{label}</span>
                          <span className="text-zinc-900 dark:text-white font-bold">{bandScore}/100</span>
                        </div>
                        <ProgressBar value={bandScore} color={bandScore > 0 ? '#1689aa' : '#cbd5e1'} />
                      </div>
                    );
                  })}
                </div>

                {/* Linguistic Summary note if available */}
                {fluencyBreakdown?.summary && (
                  <div className="bg-zinc-50 dark:bg-[#1f1f1f] rounded-xl p-3 border border-zinc-200 dark:border-[#4a4a4a] text-xs">
                    <p className="text-[10px] font-black uppercase tracking-wider text-zinc-500 dark:text-[#9f9f9f] mb-0.5">Linguistic Evaluation Note</p>
                    <p className="text-zinc-700 dark:text-[#d9d9d9] leading-relaxed font-medium">{fluencyBreakdown.summary}</p>
                  </div>
                )}

                <div className="bg-zinc-50 dark:bg-[#1f1f1f] rounded-xl p-3 text-xs text-zinc-700 dark:text-[#d9d9d9] flex items-center justify-between border border-zinc-200 dark:border-[#4a4a4a]">
                  <span className="font-bold text-zinc-800 dark:text-[#d9d9d9]">Speaking Pace:</span>
                  <span>
                    {report?.local_metrics?.wpm
                      ? `${report.local_metrics.wpm} words/min`
                      : report?.fluency_score === 0
                      ? '0 words/min (No speech)'
                      : 'Natural pace'}
                  </span>
                </div>
              </div>

              {/* Proctoring & Session Integrity Card */}
              <div className="bg-white dark:bg-[#2b2b2b] rounded-2xl border border-zinc-200 dark:border-[#4a4a4a] shadow-card p-6 space-y-5">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${totalWarnings === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                    {totalWarnings === 0 ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
                  </div>
                  <div>
                    <h3 className="font-black text-zinc-900 dark:text-white text-sm">Session Integrity & Proctoring</h3>
                    <p className="text-xs text-zinc-500 dark:text-[#9f9f9f] font-medium">Audio, webcam, and focus verification</p>
                  </div>
                </div>

                <div className={`rounded-xl p-3.5 text-xs font-bold flex items-center gap-2.5 ${
                  totalWarnings === 0 ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'
                }`}>
                  {totalWarnings === 0
                    ? <><CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-600" /> Verified Clean Session — No proctoring violations recorded</>
                    : <><AlertTriangle className="w-4 h-4 flex-shrink-0 text-red-600" /> {totalWarnings} integrity violation alert(s) detected during interview</>}
                </div>

                <div className="space-y-4">
                  {/* Single continuous total pool of 3 warnings */}
                  <div className="bg-zinc-50 dark:bg-[#1f1f1f] rounded-xl p-4 border border-zinc-200 dark:border-[#4a4a4a] space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black uppercase tracking-wider text-zinc-700 dark:text-[#d9d9d9]">
                        Continuous Warning Counter
                      </span>
                      <span className={`text-xs font-black px-2.5 py-1 rounded-lg ${
                        totalWarnings >= 3
                          ? 'bg-red-600 text-white shadow-sm'
                          : totalWarnings > 0
                          ? 'bg-amber-100 text-amber-900 border border-amber-300'
                          : 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                      }`}>
                        {totalWarnings} / 3 Warnings Used
                      </span>
                    </div>

                    {/* Strike 1, 2, 3 with exact violation reasons */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      {[1, 2, 3].map((slot) => {
                        const isUsed = slot <= totalWarnings;
                        const strikeWarning =
                          proctoringWarnings?.find((w) => w.strikeNumber === slot) ||
                          proctoringWarnings?.[slot - 1];

                        return (
                          <div
                            key={slot}
                            className={`p-3 rounded-xl border text-left transition-all ${
                              isUsed
                                ? 'bg-red-500/10 border-red-500/30 text-red-950 shadow-sm'
                                : 'bg-white dark:bg-[#2b2b2b] border-zinc-200 dark:border-[#4a4a4a] text-zinc-400 dark:text-[#9f9f9f]'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <span className={`text-xs font-black ${isUsed ? 'text-red-700' : 'text-zinc-400 dark:text-[#9f9f9f]'}`}>
                                Strike {slot} {isUsed ? '⚠️' : '✓'}
                              </span>
                              {isUsed && strikeWarning?.timestamp && (
                                <span className="text-[10px] font-bold text-red-600/80">{strikeWarning.timestamp}</span>
                              )}
                            </div>
                            {isUsed ? (
                              <div className="space-y-1">
                                <span className="inline-block text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-red-100 text-red-800 border border-red-200">
                                  {strikeWarning?.categoryLabel || 'Violation'}
                                </span>
                                <p className="text-[11px] font-semibold text-red-900 leading-snug">
                                  {strikeWarning?.reason || 'Proctoring violation recorded.'}
                                </p>
                                {strikeWarning?.snapshotPath && (
                                  <a
                                    href={`/api/interview/snapshots?path=${encodeURIComponent(strikeWarning.snapshotPath)}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-bold text-[#1689aa] hover:underline"
                                  >
                                    📷 View Evidence Snapshot
                                  </a>
                                )}
                              </div>
                            ) : (
                              <p className="text-[10px] text-zinc-400 dark:text-[#9f9f9f] font-medium">No violation recorded</p>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <p className="text-[11px] text-zinc-500 dark:text-[#9f9f9f] leading-relaxed">
                      Continuous rule: Any 3 warnings across Face, Object, or Voice immediately terminate the session.
                    </p>
                  </div>

                  {/* Breakdown of warnings by type */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-zinc-50 dark:bg-[#1f1f1f] rounded-xl p-3 border border-zinc-200 dark:border-[#4a4a4a] text-center">
                      <p className="text-[11px] font-bold text-zinc-600 flex items-center justify-center gap-1 mb-1">
                        <Eye className="w-3 h-3 text-[#1689aa]" /> Face / Gaze
                      </p>
                      <span className="text-base font-black text-zinc-900 dark:text-white">{faceWarningCount}</span>
                      <p className="text-[10px] text-zinc-400 dark:text-[#9f9f9f]">warning{faceWarningCount === 1 ? '' : 's'}</p>
                    </div>

                    <div className="bg-zinc-50 dark:bg-[#1f1f1f] rounded-xl p-3 border border-zinc-200 dark:border-[#4a4a4a] text-center">
                      <p className="text-[11px] font-bold text-zinc-600 flex items-center justify-center gap-1 mb-1">
                        <AlertTriangle className="w-3 h-3 text-[#1689aa]" /> Object / Phone
                      </p>
                      <span className="text-base font-black text-zinc-900 dark:text-white">{objectWarningCount}</span>
                      <p className="text-[10px] text-zinc-400 dark:text-[#9f9f9f]">warning{objectWarningCount === 1 ? '' : 's'}</p>
                    </div>

                    <div className="bg-zinc-50 dark:bg-[#1f1f1f] rounded-xl p-3 border border-zinc-200 dark:border-[#4a4a4a] text-center">
                      <p className="text-[11px] font-bold text-zinc-600 flex items-center justify-center gap-1 mb-1">
                        <Mic className="w-3 h-3 text-[#1689aa]" /> Voice / Audio
                      </p>
                      <span className="text-base font-black text-zinc-900 dark:text-white">{voiceWarningCount}</span>
                      <p className="text-[10px] text-zinc-400 dark:text-[#9f9f9f]">warning{voiceWarningCount === 1 ? '' : 's'}</p>
                    </div>
                  </div>

                  {/* Detailed incident log if warnings occurred */}
                  {proctoringWarnings && proctoringWarnings.length > 0 && (
                    <div className="pt-2 border-t border-zinc-200 dark:border-[#4a4a4a] space-y-2">
                      <div className="flex items-center justify-between">
                        <h4 className="text-[11px] font-black uppercase tracking-wider text-zinc-800 dark:text-[#d9d9d9] flex items-center gap-1.5">
                          <ShieldAlert className="w-3.5 h-3.5 text-red-600" />
                          Proctoring Warning Incident Log ({proctoringWarnings.length})
                        </h4>
                        <span className="text-[10px] font-bold text-zinc-400 dark:text-[#9f9f9f]">Stored in interview_events</span>
                      </div>
                      <div className="space-y-2">
                        {proctoringWarnings.map((warn, i) => (
                          <div
                            key={warn.id || i}
                            className="p-3 rounded-xl border border-red-200 bg-red-50/70 flex items-start gap-2.5 text-xs text-red-950"
                          >
                            <span className="px-2 py-0.5 rounded-md bg-red-600 text-white font-black text-[10px] uppercase flex-shrink-0 mt-0.5">
                              Strike {warn.strikeNumber ?? i + 1}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2 mb-0.5">
                                <span className="font-bold text-red-900 text-xs">{warn.categoryLabel}</span>
                                {warn.timestamp && (
                                  <span className="text-[10px] text-zinc-500 dark:text-[#9f9f9f] font-medium flex-shrink-0">{warn.timestamp}</span>
                                )}
                              </div>
                              <p className="text-[11px] text-zinc-800 dark:text-[#d9d9d9] font-medium leading-relaxed">{warn.reason}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Integrity Flags (if any) */}
            {(report?.flags ?? []).length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5">
                <h3 className="font-bold text-amber-900 text-sm mb-1.5 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-700" /> Integrity Flags for HR Review
                </h3>
                <p className="text-xs text-amber-700 mb-3 leading-relaxed">
                  These items were flagged during the automated interview session:
                </p>
                <div className="flex flex-wrap gap-2">
                  {(report!.flags as string[]).map((f) => (
                    <span key={f} className="bg-amber-100 text-amber-800 border border-amber-300 rounded-lg px-2.5 py-1 text-xs font-bold">
                      {f.replaceAll('_', ' ').replace(/(^\w)/, (c) => c.toUpperCase())}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* HR Questions & Respective Answers */}
            <div className="bg-white dark:bg-[#2b2b2b] rounded-2xl border border-zinc-200 dark:border-[#4a4a4a] shadow-card p-6 sm:p-7 space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#34c4f2]/10 flex items-center justify-center text-[#1689aa]">
                    <User className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-base font-black text-zinc-900 dark:text-white">HR & Behavioral Questions & Answers</h2>
                    <p className="text-xs text-zinc-500 dark:text-[#9f9f9f] font-medium">Questions asked during the HR & behavioral portion and the candidate&apos;s verbatim answers</p>
                  </div>
                </div>
                <span className="text-xs font-bold text-zinc-600 bg-zinc-100 dark:bg-[#2b2b2b] px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-[#4a4a4a]">
                  {hrQuestions.length} HR Question{hrQuestions.length === 1 ? '' : 's'}
                </span>
              </div>

              {hrQuestions.length > 0 ? (
                <div className="space-y-4">
                  {hrQuestions.map((q, idx) => {
                    const ord = q.question_order ?? q.order_index ?? idx + 1;
                    const scoreItem = competencyScores.find((cs) => cs.ord === ord);

                    const candidateAnswer = getCandidateAnswer(q.id, ord, idx);
                    const score = scoreItem?.score ?? (candidateAnswer ? 3 : 0);
                    const { filled, label: starLabel, color: starColor } = starRating(score);

                    return (
                      <div key={q.id} className="rounded-xl border border-zinc-200 dark:border-[#4a4a4a] p-5 space-y-3.5 hover:border-[#34c4f2]/50 transition-colors bg-white dark:bg-[#2b2b2b]">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <p className="text-[11px] font-black uppercase tracking-widest text-[#1689aa] mb-1">
                              HR Question {ord} · {(q.competency || q.category || 'Behavioral').replaceAll('_', ' ')}
                            </p>
                            <p className="text-sm font-bold text-zinc-900 dark:text-white leading-relaxed">
                              {q.question_text}
                            </p>
                          </div>
                          {scoreItem && (
                            <div className="flex-shrink-0 text-right">
                              <div className="flex items-center gap-0.5 justify-end mb-1">
                                {Array.from({ length: 5 }).map((_, i) => (
                                  <Star
                                    key={i}
                                    className={`w-3.5 h-3.5 ${i < filled ? starColor : 'text-zinc-200'}`}
                                    fill={i < filled ? 'currentColor' : 'none'}
                                  />
                                ))}
                              </div>
                              <span className={`text-xs font-bold ${starColor}`}>{starLabel} ({score}/5)</span>
                            </div>
                          )}
                        </div>

                        {/* Candidate Answer Box */}
                        <div className="bg-zinc-50 dark:bg-[#1f1f1f] rounded-xl p-4 border border-zinc-200 dark:border-[#4a4a4a]">
                          <p className="text-[10px] font-black uppercase tracking-wider text-zinc-500 dark:text-[#9f9f9f] mb-1">Candidate Answer (Verbatim):</p>
                          {candidateAnswer ? (
                            <p className="text-xs text-zinc-900 dark:text-white leading-relaxed whitespace-pre-wrap font-medium">
                              {candidateAnswer}
                            </p>
                          ) : (
                            <p className="text-xs text-zinc-500 dark:text-[#9f9f9f] italic leading-relaxed">
                              No verbal response recorded for this question (skipped or did not respond).
                            </p>
                          )}
                        </div>

                        {/* Evaluator Assessment */}
                        {scoreItem && (
                          <div className="bg-[#34c4f2]/5 rounded-xl p-4 border border-[#34c4f2]/20 space-y-2">
                            <p className="text-xs text-zinc-800 dark:text-[#d9d9d9] leading-relaxed">
                              <span className="font-bold text-[#1689aa]">HR Assessment: </span>
                              {scoreItem.justification}
                            </p>
                            {scoreItem.evidence && scoreItem.evidence.length > 0 && (
                              <div className="border-l-2 border-[#34c4f2] pl-3 mt-1.5">
                                <p className="text-[10px] font-bold text-[#1689aa] uppercase">Candidate Quote:</p>
                                <p className="text-xs italic text-zinc-700 dark:text-[#d9d9d9]">&ldquo;{scoreItem.evidence[0].quote}&rdquo;</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-zinc-500 dark:text-[#9f9f9f]">
                  <p className="text-xs font-bold">No specific HR questions recorded for this session.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═════════════════════════════════════════════════════════ */}
        {/* TAB 2: Technical Evaluation & Round 2 Questions         */}
        {/* ═════════════════════════════════════════════════════════ */}
        {activeTab === 'technical' && (
          <div className="space-y-6">

            {/* Follow-up Recommendations Box for Round 2 */}
            <div className="bg-white dark:bg-[#2b2b2b] rounded-2xl border border-zinc-200 dark:border-[#4a4a4a] shadow-card p-6 sm:p-7 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#34c4f2]/10 text-[#1689aa] flex items-center justify-center flex-shrink-0 font-bold">
                  <Sparkles className="w-5 h-5 text-[#1689aa]" />
                </div>
                <div>
                  <h3 className="text-base font-black text-zinc-900 dark:text-white">
                    Round 2 Technical Deep-Dive Recommendations
                  </h3>
                  <p className="text-zinc-500 dark:text-[#9f9f9f] text-xs leading-relaxed max-w-2xl mt-0.5">
                    Suggested questions for the human technical interviewer to probe in Round 2 based on weak spots and knowledge depth identified during AI screening:
                  </p>
                </div>
              </div>

              <div className="space-y-2.5 pt-1">
                {followUpQuestions.length > 0 ? (
                  followUpQuestions.map((fq, idx) => (
                    <div
                      key={idx}
                      className="bg-zinc-50 dark:bg-[#1f1f1f] border border-zinc-200 dark:border-[#4a4a4a] rounded-xl p-3.5 flex items-start justify-between gap-4 hover:border-[#34c4f2]/40 transition-colors"
                    >
                      <div className="flex items-start gap-2.5">
                        <span className="w-5 h-5 rounded-full bg-[#34c4f2] text-zinc-900 dark:text-white font-black text-[11px] flex items-center justify-center shrink-0 mt-0.5 shadow-sm">
                          {idx + 1}
                        </span>
                        <p className="text-xs text-zinc-900 dark:text-white font-semibold leading-relaxed">
                          {fq}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyQuestionToClipboard(fq, idx)}
                        className="px-2.5 py-1 rounded-lg bg-white dark:bg-[#2b2b2b] border border-zinc-200 dark:border-[#4a4a4a] hover:bg-zinc-100 dark:hover:bg-[#1f1f1f] dark:bg-[#2b2b2b] text-xs font-bold text-zinc-700 dark:text-[#d9d9d9] flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
                        title="Copy question text"
                      >
                        {copiedIndex === idx ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                            <span className="text-emerald-700">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5 text-zinc-400 dark:text-[#9f9f9f]" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-zinc-500 dark:text-[#9f9f9f] italic">
                    Follow-up questions will be generated automatically upon full score evaluation.
                  </p>
                )}
              </div>
            </div>

            {/* Question-by-Question Technical Audit */}
            <div className="bg-white dark:bg-[#2b2b2b] rounded-2xl border border-zinc-200 dark:border-[#4a4a4a] shadow-card p-6 sm:p-7 space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#34c4f2]/10 flex items-center justify-center text-[#1689aa]">
                    <MessageSquare className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-base font-black text-zinc-900 dark:text-white">Technical Questions & Answers</h2>
                    <p className="text-xs text-zinc-500 dark:text-[#9f9f9f] font-medium">Verbatim candidate response, AI score, and technical grounding</p>
                  </div>
                </div>
                <span className="text-xs font-bold text-zinc-600 bg-zinc-100 dark:bg-[#2b2b2b] px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-[#4a4a4a]">
                  {techQuestions.length} Technical Question{techQuestions.length === 1 ? '' : 's'}
                </span>
              </div>

              {techQuestions.length > 0 ? (
                <div className="space-y-4">
                  {techQuestions.map((q, idx) => {
                    const ord = q.question_order ?? q.order_index ?? idx + 1;
                    const scoreItem = competencyScores.find((cs) => cs.ord === ord);

                    const candidateAnswer = getCandidateAnswer(q.id, ord, idx);
                    const score = scoreItem?.score ?? (candidateAnswer ? 3 : 0);
                    const { filled, label: starLabel, color: starColor } = starRating(score);

                    return (
                      <div key={q.id} className="rounded-xl border border-zinc-200 dark:border-[#4a4a4a] p-5 space-y-3.5 hover:border-[#34c4f2]/50 transition-colors bg-white dark:bg-[#2b2b2b]">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <p className="text-[11px] font-black uppercase tracking-widest text-[#1689aa] mb-1">
                              Technical Question {ord} · {(q.competency || scoreItem?.competency || 'Role Competency').replaceAll('_', ' ')}
                            </p>
                            <p className="text-sm font-bold text-zinc-900 dark:text-white leading-relaxed">
                              {q.question_text}
                            </p>
                          </div>
                          <div className="flex-shrink-0 text-right">
                            <div className="flex items-center gap-0.5 justify-end mb-1">
                              {Array.from({ length: 5 }).map((_, i) => (
                                <Star
                                  key={i}
                                  className={`w-3.5 h-3.5 ${i < filled ? starColor : 'text-zinc-200'}`}
                                  fill={i < filled ? 'currentColor' : 'none'}
                                />
                              ))}
                            </div>
                            <span className={`text-xs font-bold ${starColor}`}>{starLabel} ({score}/5)</span>
                            {scoreItem?.bluff_suspected && (
                              <p className="text-[10px] text-amber-600 font-bold mt-1">⚠️ Surface-level / Bluff suspected</p>
                            )}
                          </div>
                        </div>

                        {/* Candidate Answer Box */}
                        <div className="bg-zinc-50 dark:bg-[#1f1f1f] rounded-xl p-4 border border-zinc-200 dark:border-[#4a4a4a]">
                          <p className="text-[10px] font-black uppercase tracking-wider text-zinc-500 dark:text-[#9f9f9f] mb-1">Candidate Answer (Verbatim):</p>
                          {candidateAnswer ? (
                            <p className="text-xs text-zinc-900 dark:text-white leading-relaxed whitespace-pre-wrap font-medium">
                              {candidateAnswer}
                            </p>
                          ) : (
                            <p className="text-xs text-zinc-500 dark:text-[#9f9f9f] italic leading-relaxed">
                              No verbal response recorded for this question (skipped or did not respond).
                            </p>
                          )}
                        </div>

                        {/* AI Evaluation */}
                        {scoreItem && (
                          <div className="bg-[#34c4f2]/5 rounded-xl p-4 border border-[#34c4f2]/20 space-y-2">
                            <p className="text-xs text-zinc-800 dark:text-[#d9d9d9] leading-relaxed">
                              <span className="font-bold text-[#1689aa]">AI Technical Assessment: </span>
                              {scoreItem.justification}
                            </p>
                            {scoreItem.evidence && scoreItem.evidence.length > 0 && (
                              <div className="border-l-2 border-[#34c4f2] pl-3 mt-1.5">
                                <p className="text-[10px] font-bold text-[#1689aa] uppercase">Cited Candidate Quote:</p>
                                <p className="text-xs italic text-zinc-700 dark:text-[#d9d9d9]">&ldquo;{scoreItem.evidence[0].quote}&rdquo;</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-zinc-500 dark:text-[#9f9f9f]">
                  <p className="text-xs font-bold">No specific Technical questions recorded for this session.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═════════════════════════════════════════════════════════ */}
        {/* TAB 3: Full Transcript                                  */}
        {/* ═════════════════════════════════════════════════════════ */}
        {activeTab === 'transcript' && (
          <div className="bg-white dark:bg-[#2b2b2b] rounded-2xl border border-zinc-200 dark:border-[#4a4a4a] shadow-card p-6 sm:p-7 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#34c4f2]/10 flex items-center justify-center text-[#1689aa]">
                  <MessageSquare className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-black text-zinc-900 dark:text-white">Verbatim Interview Log</h2>
                  <p className="text-xs text-zinc-500 dark:text-[#9f9f9f] font-medium">Recorded audio transcription segments with speaker attribution</p>
                </div>
              </div>
              <span className="text-xs font-bold text-zinc-600 bg-zinc-100 dark:bg-[#2b2b2b] px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-[#4a4a4a]">
                {transcript.length} speech segments
              </span>
            </div>

            <div className="space-y-2.5 max-h-[600px] overflow-y-auto pr-1">
              {(() => {
                // Build a lookup: question_ord → answer transcript text for fallback
                const answerByOrd = new Map<number, string>();
                answers.forEach((ans, idx) => {
                  // answers are ordered same as questions (1-indexed)
                  const ord = idx + 1;
                  if (ans.transcript?.trim()) answerByOrd.set(ord, ans.transcript.trim());
                });

                // Filter out transcript rows that have no text AND no fallback answer
                const displayRows = transcript
                  .map((t) => {
                    const isCandidate = t.speaker === 'candidate' && !t.is_flagged;
                    // For candidate rows with empty text, try to fill from answers by question_ord
                    const resolvedText =
                      t.text?.trim() ||
                      (isCandidate && t.question_ord ? answerByOrd.get(t.question_ord) ?? '' : '');
                    return { ...t, resolvedText };
                  })
                  .filter((t) => t.resolvedText.length > 0);

                if (displayRows.length > 0) {
                  return displayRows.map((t) => {
                    const isCandidate = t.speaker === 'candidate' && !t.is_flagged;
                    const isUnauthorized = t.speaker === 'unauthorized_voice' || t.is_flagged;

                    return (
                      <div
                        key={t.id}
                        className={`rounded-xl p-3.5 text-xs leading-relaxed border ${
                          isUnauthorized
                            ? 'bg-red-50 border-red-200 text-red-900'
                            : isCandidate
                            ? 'bg-zinc-50 dark:bg-[#1f1f1f] border-zinc-200 dark:border-[#4a4a4a] text-zinc-900 dark:text-white'
                            : 'bg-zinc-50/50 border-zinc-200/50 text-zinc-500 dark:text-[#9f9f9f] italic'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wider mb-1">
                          <span className={isUnauthorized ? 'text-red-700' : isCandidate ? 'text-[#1689aa]' : 'text-zinc-400 dark:text-[#9f9f9f]'}>
                            {isUnauthorized ? '⚠️ Unauthorized Voice' : isCandidate ? '🧑 Candidate' : '🤖 AI Interviewer'}
                          </span>
                          {t.ts_ms && (
                            <span className="text-zinc-400 dark:text-[#9f9f9f] font-normal">
                              {new Date(Number(t.ts_ms)).toLocaleTimeString()}
                            </span>
                          )}
                        </div>
                        <p className="font-medium text-zinc-800 dark:text-[#d9d9d9]">{t.resolvedText}</p>
                      </div>
                    );
                  });
                }

                // Full fallback: no transcript rows at all — render directly from answers
                if (answers.length > 0) {
                  return answers
                    .filter((ans) => ans.transcript?.trim())
                    .map((ans, idx) => (
                      <div key={ans.id} className="rounded-xl p-3.5 text-xs leading-relaxed bg-zinc-50 dark:bg-[#1f1f1f] border border-zinc-200 dark:border-[#4a4a4a] text-zinc-900 dark:text-white">
                        <p className="text-[10px] font-black uppercase tracking-wider text-[#1689aa] mb-1">
                          🧑 Candidate Answer {idx + 1}
                        </p>
                        <p className="font-medium text-zinc-800 dark:text-[#d9d9d9]">{ans.transcript}</p>
                      </div>
                    ));
                }

                return null;
              })()}

              {/* Empty state — shown only when both transcript and answers are truly empty */}
              {transcript.length === 0 && answers.length === 0 && (
                <div className="text-center py-10 text-zinc-500 dark:text-[#9f9f9f]">
                  <p className="text-xs font-bold">No transcript segments recorded</p>
                </div>
              )}
            </div>

          </div>
        )}

        {/* ── Action Bar ───────────────────────────────────── */}
        <div className="flex items-center justify-between border-t border-zinc-200 dark:border-[#4a4a4a] pt-6">
          <Link
            href="/admin/reports"
            className="flex items-center gap-2 text-xs font-bold text-zinc-500 dark:text-[#9f9f9f] hover:text-zinc-900 dark:text-white transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Result Board
          </Link>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-zinc-100 dark:bg-[#2b2b2b] hover:bg-zinc-200 text-zinc-800 dark:text-[#d9d9d9] text-xs font-bold rounded-xl transition-all cursor-pointer"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={handleGenerateReport}
              disabled={isGeneratingReport}
              className="px-4 py-2 bg-[#34c4f2] hover:bg-[#2db0db] text-zinc-900 dark:text-white text-xs font-bold rounded-xl transition-all cursor-pointer disabled:opacity-50"
            >
              {isGeneratingReport ? '⏳ Re-evaluating…' : 'Re-evaluate Report'}
            </button>
          </div>
        </div>

      </main>
    </div>
  );
}
