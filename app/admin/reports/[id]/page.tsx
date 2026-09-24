import { notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase/admin';
import Link from 'next/link';
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  XCircle,
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
} from 'lucide-react';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

/* ── Helpers ─────────────────────────────────────────────── */

function starRating(score: number): { filled: number; label: string; color: string } {
  if (score >= 5) return { filled: 5, label: 'Excellent', color: 'text-emerald-500' };
  if (score >= 4) return { filled: 4, label: 'Strong', color: 'text-blue-500' };
  if (score >= 3) return { filled: 3, label: 'Adequate', color: 'text-amber-500' };
  if (score >= 2) return { filled: 2, label: 'Needs Improvement', color: 'text-orange-500' };
  return { filled: 1, label: 'Poor', color: 'text-red-500' };
}

function cefrToPlain(cefr: string): { label: string; desc: string } {
  const map: Record<string, { label: string; desc: string }> = {
    A2: { label: 'Basic English', desc: 'Can communicate simple ideas but struggles with complex sentences.' },
    B1: { label: 'Intermediate English', desc: 'Can handle everyday topics. Some errors in grammar/vocabulary.' },
    B2: { label: 'Good English', desc: 'Communicates clearly and naturally in most situations.' },
    C1: { label: 'Advanced English', desc: 'Speaks fluently and precisely. Very strong professional communication.' },
    C2: { label: 'Fluent English', desc: 'Near-native proficiency. Exceptional vocabulary and coherence.' },
  };
  return map[cefr] ?? { label: cefr, desc: '' };
}

function ScoreGauge({ value, max = 100, color, label }: { value: number | null; max?: number; color: string; label: string }) {
  const pct = value !== null ? Math.round((value / max) * 100) : 0;
  const r = 44;
  const circ = 2 * Math.PI * r;
  const dashOffset = circ - (pct / 100) * circ;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-28 h-28">
        <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={r} fill="none" stroke="#f1f5f9" strokeWidth="8" />
          <circle
            cx="50" cy="50" r={r} fill="none"
            stroke={color} strokeWidth="8"
            strokeDasharray={circ}
            strokeDashoffset={value === null ? circ : dashOffset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 1s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-black text-zinc-900">
            {value === null ? '—' : value}
          </span>
          <span className="text-[10px] text-zinc-400 font-semibold">/{max}</span>
        </div>
      </div>
      <p className="text-xs font-bold text-zinc-600 uppercase tracking-wider text-center">{label}</p>
    </div>
  );
}

function ProgressBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-2 rounded-full bg-zinc-100 overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${value}%`, backgroundColor: color }}
      />
    </div>
  );
}

function WarningIndicator({ count, max = 3, label }: { count: number; max?: number; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex gap-1">
        {Array.from({ length: max }).map((_, i) => (
          <div
            key={i}
            className={`w-5 h-5 rounded-full border-2 ${
              i < count
                ? 'bg-red-500 border-red-500'
                : 'bg-zinc-100 border-zinc-300'
            }`}
          />
        ))}
      </div>
      <span className="text-sm font-semibold text-zinc-700">
        {count}/{max} {label}
      </span>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────── */

export default async function AdminInterviewReportPage({ params }: PageProps) {
  const { id } = await params;

  const [
    { data: session },
    { data: report },
    { data: transcript },
    { data: questions },
    { data: warnings },
  ] = await Promise.all([
    supabaseAdmin.from('interview_sessions').select('*').eq('id', id).single(),
    supabaseAdmin.from('interview_reports').select('*').eq('session_id', id).maybeSingle(),
    supabaseAdmin.from('interview_transcript').select('*').eq('session_id', id).order('ts_ms', { ascending: true }),
    supabaseAdmin.from('interview_questions').select('*').eq('session_id', id).order('order_index', { ascending: true }),
    supabaseAdmin.from('interview_events').select('*').eq('session_id', id).eq('severity', 'warning'),
  ]);

  if (!session) notFound();

  const isTerminated = session.status === 'terminated';
  const isCompleted = session.status === 'completed';
  const rec = report?.recommendation ?? null;
  const cefr = report?.fluency_cefr ?? null;
  const cefrInfo = cefr ? cefrToPlain(cefr) : null;

  const VERDICT = {
    strong_yes: {
      emoji: '🌟',
      title: 'Strong Hire',
      desc: 'This candidate stood out. They answered questions with depth, communicated clearly, and showed no integrity concerns. We highly recommend moving forward.',
      headerBg: 'bg-gradient-to-br from-emerald-500 to-teal-600',
      badge: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    },
    yes: {
      emoji: '✅',
      title: 'Recommended to Hire',
      desc: 'This candidate performed well across technical and communication areas. They are a good fit and we recommend proceeding to the next round.',
      headerBg: 'bg-gradient-to-br from-blue-500 to-indigo-600',
      badge: 'bg-blue-50 text-blue-800 border-blue-200',
    },
    maybe: {
      emoji: '⚠️',
      title: 'Needs Further Review',
      desc: 'The candidate showed some potential but also had areas of concern — either in their answers, communication, or session integrity. A human review is recommended before deciding.',
      headerBg: 'bg-gradient-to-br from-amber-500 to-orange-500',
      badge: 'bg-amber-50 text-amber-800 border-amber-200',
    },
    no: {
      emoji: '❌',
      title: 'Not Recommended',
      desc: 'Based on the evaluation, this candidate did not meet the required standards — either due to weak answers, poor communication, or integrity violations during the interview.',
      headerBg: 'bg-gradient-to-br from-red-500 to-rose-600',
      badge: 'bg-red-50 text-red-800 border-red-200',
    },
  } as const;

  const verdictCfg = rec ? VERDICT[rec as keyof typeof VERDICT] : null;
  const voiceWarningCount = (session.voice_warning_count ?? 0) +
    (warnings ?? []).filter((w) => w.category === 'unauthorized_voice' || w.category === 'bg_voice').length;
  const faceWarningCount = session.face_warning_count ?? 0;
  const objectWarningCount = session.object_warning_count ?? 0;
  const totalWarnings = voiceWarningCount + faceWarningCount + objectWarningCount;

  const candidateTranscript = (transcript ?? []).filter((t) => t.speaker === 'candidate' && !t.is_flagged);
  const fluencyBreakdown = report?.fluency_breakdown as Record<string, { band?: number; notes?: string }> | null;
  const fluencySub = fluencyBreakdown?.sub as
    | { grammar?: { band?: number; notes?: string }; vocabulary?: { band?: number; notes?: string }; coherence?: { band?: number; notes?: string }; fluency?: { band?: number; notes?: string } }
    | undefined;
  const competencyScores = (report?.competency_scores ?? []) as Array<{
    ord: number;
    competency: string;
    score: number;
    justification: string;
    evidence?: Array<{ quote: string }>;
    bluff_suspected?: boolean;
  }>;

  return (
    <div className="min-h-screen bg-[#f4f6fb]" style={{ fontFamily: "'Inter', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');`}</style>

      {/* Sticky Header */}
      <header className="bg-white border-b border-zinc-200 sticky top-0 z-20 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/admin/reports" className="p-2 rounded-xl text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-lg font-black text-zinc-900">{session.candidate_name ?? 'Candidate'} — Interview Report</h1>
              <p className="text-xs text-zinc-400 font-medium">Session {session.id.slice(0, 8)}…</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-wider border ${
              isCompleted ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
              isTerminated ? 'bg-red-50 text-red-800 border-red-200' :
              'bg-zinc-100 text-zinc-700 border-zinc-200'
            }`}>
              {isTerminated ? '🚫 Terminated' : isCompleted ? '✅ Completed' : session.status}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">

        {/* ── 1. Termination Banner (if applicable) ───────── */}
        {isTerminated && (
          <div className="bg-red-600 rounded-3xl p-7 text-white shadow-xl">
            <div className="flex items-start gap-5">
              <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center flex-shrink-0">
                <ShieldAlert className="w-8 h-8 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-black mb-2">🚫 This Interview Was Terminated</h2>
                <p className="text-red-100 text-sm leading-relaxed max-w-2xl">
                  The system automatically ended this interview because the candidate violated session integrity rules.
                  This typically means they received 3 or more proctoring warnings — such as looking away from the camera,
                  using a second device, or having someone else speak during the interview.
                </p>
                <p className="mt-3 text-xs font-bold text-red-200 uppercase tracking-wider">
                  ⚠️ This candidate is flagged for manual HR review before any further consideration.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── 2. Verdict Hero ─────────────────────────────── */}
        {verdictCfg ? (
          <div className={`${verdictCfg.headerBg} rounded-3xl p-8 text-white shadow-xl`}>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="space-y-3 max-w-2xl">
                <div className="flex items-center gap-3">
                  <span className="text-4xl">{verdictCfg.emoji}</span>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-white/70 mb-0.5">Final Verdict</p>
                    <h2 className="text-3xl font-black">{verdictCfg.title}</h2>
                  </div>
                </div>
                <p className="text-sm leading-relaxed text-white/90">{verdictCfg.desc}</p>
                {report?.recommendation_rationale && (
                  <div className="bg-white/20 rounded-2xl px-5 py-4 text-sm leading-relaxed text-white/95">
                    {report.recommendation_rationale}
                  </div>
                )}
              </div>
              {/* Score gauges */}
              <div className="flex items-center gap-8 flex-shrink-0 bg-white/15 rounded-2xl px-8 py-6">
                <ScoreGauge value={report?.cognitive_composite ?? null} color="#a78bfa" label="Problem Solving" />
                <ScoreGauge value={report?.fluency_score ?? null} color="#38bdf8" label="Communication" />
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-zinc-800 rounded-3xl p-8 text-white shadow-xl">
            <div className="flex items-center gap-4">
              <Clock className="w-10 h-10 text-zinc-400" />
              <div>
                <h2 className="text-xl font-black">Scoring In Progress</h2>
                <p className="text-sm text-zinc-400 mt-1">
                  The AI evaluation engine is analysing this interview. Results will appear here automatically.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── 3. Quick-glance Candidate Info ──────────────── */}
        <div className="bg-white rounded-3xl border border-zinc-200/80 shadow-sm p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
              <User className="w-5 h-5 text-indigo-600" />
            </div>
            <h2 className="text-lg font-black text-zinc-900">Candidate Overview</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            {[
              { label: 'Name', value: session.candidate_name ?? '—' },
              { label: 'Email', value: session.candidate_email ?? '—' },
              { label: 'Role Applied', value: (session.parsed_jd as { jobTitle?: string } | null)?.jobTitle ?? '—' },
              { label: 'Interview Date', value: new Date(session.updated_at ?? session.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) },
            ].map(({ label, value }) => (
              <div key={label} className="bg-zinc-50 rounded-2xl p-4 border border-zinc-100">
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-1">{label}</p>
                <p className="font-bold text-zinc-900 text-sm truncate">{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── 4. Score Breakdown (Plain English) ──────────── */}
        {report && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

            {/* Problem Solving */}
            <div className="bg-white rounded-3xl border border-zinc-200/80 shadow-sm p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-violet-600" />
                </div>
                <div>
                  <h3 className="font-black text-zinc-900 text-sm">Problem Solving Ability</h3>
                  <p className="text-xs text-zinc-400">How well the candidate thinks and answers</p>
                </div>
              </div>
              <div className="text-center py-2">
                <span className="text-5xl font-black text-violet-600">{report.cognitive_composite ?? '—'}</span>
                <span className="text-zinc-400 text-lg font-semibold">/100</span>
              </div>
              <div className="space-y-2">
                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span className="text-zinc-600">Reasoning Quality</span>
                    <span className="text-zinc-800">{report.reasoning_subscore ?? '—'}/100</span>
                  </div>
                  <ProgressBar value={report.reasoning_subscore ?? 0} color="#7c3aed" />
                </div>
                <div>
                  <div className="flex justify-between text-xs font-semibold mb-1">
                    <span className="text-zinc-600">Clarity of Thought</span>
                    <span className="text-zinc-800">{report.clarity_subscore ?? '—'}/100</span>
                  </div>
                  <ProgressBar value={report.clarity_subscore ?? 0} color="#a78bfa" />
                </div>
              </div>
              <p className="text-xs text-zinc-500 bg-zinc-50 rounded-xl p-3 leading-relaxed">
                {(report.cognitive_composite ?? 0) >= 80
                  ? '✅ Excellent analytical skills. Candidate demonstrates strong depth of understanding.'
                  : (report.cognitive_composite ?? 0) >= 60
                  ? '👍 Good problem-solving ability. Meets role expectations with minor gaps.'
                  : '⚠️ Below average. Candidate struggled with depth or accuracy in their responses.'}
              </p>
            </div>

            {/* Communication */}
            <div className="bg-white rounded-3xl border border-zinc-200/80 shadow-sm p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-sky-50 flex items-center justify-center">
                  <Volume2 className="w-5 h-5 text-sky-600" />
                </div>
                <div>
                  <h3 className="font-black text-zinc-900 text-sm">English Communication</h3>
                  <p className="text-xs text-zinc-400">Language quality and speaking fluency</p>
                </div>
              </div>
              {cefrInfo && (
                <div className="text-center py-2">
                  <span className="text-4xl font-black text-sky-600">{cefr}</span>
                  <p className="text-sm font-bold text-zinc-700 mt-1">{cefrInfo.label}</p>
                  <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{cefrInfo.desc}</p>
                </div>
              )}
              {fluencySub && (
                <div className="space-y-2">
                  {[
                    { key: 'grammar', label: 'Grammar' },
                    { key: 'vocabulary', label: 'Vocabulary' },
                    { key: 'coherence', label: 'Coherence' },
                    { key: 'fluency', label: 'Fluency' },
                  ].map(({ key, label }) => {
                    const sub = fluencySub[key as keyof typeof fluencySub];
                    return (
                      <div key={key}>
                        <div className="flex justify-between text-xs font-semibold mb-1">
                          <span className="text-zinc-600">{label}</span>
                          <span className="text-zinc-800">{sub?.band ?? '—'}/100</span>
                        </div>
                        <ProgressBar value={sub?.band ?? 0} color="#0ea5e9" />
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="bg-zinc-50 rounded-xl p-3">
                <p className="text-xs font-bold text-zinc-700 mb-1">Speaking Pace</p>
                <p className="text-xs text-zinc-500">
                  {report.local_metrics?.wpm ? `${report.local_metrics.wpm} words/min` : '—'}
                  {report.local_metrics?.wpm
                    ? report.local_metrics.wpm < 100
                      ? ' — Speaking slowly (could indicate hesitation)'
                      : report.local_metrics.wpm > 180
                      ? ' — Speaking quite fast'
                      : ' — Good pace'
                    : ''}
                </p>
              </div>
            </div>

            {/* Session Integrity */}
            <div className="bg-white rounded-3xl border border-zinc-200/80 shadow-sm p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${totalWarnings === 0 ? 'bg-emerald-50' : 'bg-red-50'}`}>
                  {totalWarnings === 0
                    ? <ShieldCheck className="w-5 h-5 text-emerald-600" />
                    : <ShieldAlert className="w-5 h-5 text-red-600" />}
                </div>
                <div>
                  <h3 className="font-black text-zinc-900 text-sm">Interview Integrity</h3>
                  <p className="text-xs text-zinc-400">Was the session fair and monitored?</p>
                </div>
              </div>
              <div className="space-y-4">
                <div className={`rounded-2xl p-4 text-sm font-semibold flex items-center gap-3 ${
                  totalWarnings === 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'
                }`}>
                  {totalWarnings === 0
                    ? <><CheckCircle2 className="w-5 h-5 flex-shrink-0" /> Clean session — no violations detected</>
                    : <><AlertTriangle className="w-5 h-5 flex-shrink-0" /> {totalWarnings} violation(s) detected</>}
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-bold text-zinc-700 mb-1.5 flex items-center gap-2">
                      <Mic className="w-3.5 h-3.5" /> Unauthorized Voice Warnings
                    </p>
                    <WarningIndicator count={voiceWarningCount} label="warnings" />
                    <p className="text-[11px] text-zinc-400 mt-1">Someone else speaking during the candidate&apos;s answers</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-zinc-700 mb-1.5 flex items-center gap-2">
                      <Eye className="w-3.5 h-3.5" /> Camera / Face Warnings
                    </p>
                    <WarningIndicator count={faceWarningCount} label="warnings" />
                    <p className="text-[11px] text-zinc-400 mt-1">Candidate looking away or leaving the frame</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-zinc-700 mb-1.5 flex items-center gap-2">
                      <AlertTriangle className="w-3.5 h-3.5" /> Prohibited Object Warnings
                    </p>
                    <WarningIndicator count={objectWarningCount} label="warnings" />
                    <p className="text-[11px] text-zinc-400 mt-1">Phone, earbuds, or notes detected on camera</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── 5. Per-Question Evaluations (Star-based, plain English) ── */}
        {competencyScores.length > 0 && (
          <div className="bg-white rounded-3xl border border-zinc-200/80 shadow-sm p-8 space-y-6">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
                <MessageSquare className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <h2 className="text-lg font-black text-zinc-900">Question-by-Question Results</h2>
                <p className="text-xs text-zinc-400">How did the candidate answer each question?</p>
              </div>
            </div>

            <div className="space-y-4">
              {competencyScores.map((item) => {
                const { filled, label: starLabel, color: starColor } = starRating(item.score);
                const q = (questions ?? []).find((x) => (x.order_index ?? x.question_order) === item.ord);

                return (
                  <div key={item.ord} className="rounded-2xl border border-zinc-100 p-5 space-y-3 hover:border-indigo-100 transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <p className="text-[11px] font-black uppercase tracking-widest text-indigo-500 mb-1">
                          Question {item.ord} · {item.competency.replaceAll('_', ' ')}
                        </p>
                        {q && (
                          <p className="text-sm text-zinc-700 font-medium leading-relaxed">
                            {q.question_text}
                          </p>
                        )}
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <div className="flex items-center gap-0.5 justify-end mb-1">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star
                              key={i}
                              className={`w-4 h-4 ${i < filled ? starColor : 'text-zinc-200'}`}
                              fill={i < filled ? 'currentColor' : 'none'}
                            />
                          ))}
                        </div>
                        <span className={`text-xs font-bold ${starColor}`}>{starLabel}</span>
                        {item.bluff_suspected && (
                          <p className="text-[10px] text-amber-600 font-bold mt-1">⚠️ Possible bluffing detected</p>
                        )}
                      </div>
                    </div>

                    <div className="bg-zinc-50 rounded-xl p-3">
                      <p className="text-xs text-zinc-700 leading-relaxed font-medium">
                        <span className="font-bold text-zinc-900">Evaluator note: </span>
                        {item.justification}
                      </p>
                    </div>

                    {item.evidence && item.evidence.length > 0 && (
                      <div className="border-l-4 border-indigo-200 pl-4">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">Candidate said:</p>
                        <p className="text-xs italic text-zinc-600">&ldquo;{item.evidence[0].quote}&rdquo;</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── 6. What the Candidate Said (Transcript) ─────── */}
        {candidateTranscript.length > 0 && (
          <div className="bg-white rounded-3xl border border-zinc-200/80 shadow-sm p-8 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-sky-50 flex items-center justify-center">
                  <MessageSquare className="w-5 h-5 text-sky-600" />
                </div>
                <div>
                  <h2 className="text-lg font-black text-zinc-900">What the Candidate Said</h2>
                  <p className="text-xs text-zinc-400">Verbatim transcript of candidate answers only</p>
                </div>
              </div>
              <span className="text-xs font-semibold text-zinc-400 bg-zinc-100 px-3 py-1.5 rounded-lg">
                {candidateTranscript.length} responses recorded
              </span>
            </div>

            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
              {(transcript ?? []).map((t) => {
                const isCandidate = t.speaker === 'candidate' && !t.is_flagged;
                const isUnauthorized = t.speaker === 'unauthorized_voice' || t.is_flagged;

                return (
                  <div
                    key={t.id}
                    className={`rounded-2xl p-4 text-sm leading-relaxed ${
                      isUnauthorized
                        ? 'bg-amber-50 border border-amber-200 text-amber-900'
                        : isCandidate
                        ? 'bg-indigo-50/50 border border-indigo-100 text-zinc-900'
                        : 'bg-zinc-50 border border-zinc-100 text-zinc-500 italic'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wider mb-2">
                      <span className={isUnauthorized ? 'text-amber-700' : isCandidate ? 'text-indigo-600' : 'text-zinc-400'}>
                        {isUnauthorized ? '⚠️ Unknown Voice (Excluded from scoring)' : isCandidate ? '🧑 Candidate' : '🤖 AI Interviewer'}
                      </span>
                      <span className="text-zinc-400 font-normal">
                        {new Date(Number(t.ts_ms)).toLocaleTimeString()}
                      </span>
                    </div>
                    <p>{t.text}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── 7. No report yet placeholder ─────────────────── */}
        {!report && (
          <div className="bg-zinc-50 rounded-3xl border border-zinc-200 p-10 text-center space-y-3">
            <Clock className="w-12 h-12 text-zinc-300 mx-auto" />
            <h3 className="text-lg font-black text-zinc-700">Evaluation Pending</h3>
            <p className="text-sm text-zinc-500 max-w-md mx-auto leading-relaxed">
              The AI scoring engine has not processed this session yet. This usually happens within
              a few minutes after the interview ends. Refresh the page to check for updates.
            </p>
          </div>
        )}

        {/* ── 8. Flags footer ──────────────────────────────── */}
        {(report?.flags ?? []).length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-3xl p-6">
            <h3 className="font-black text-amber-900 text-sm mb-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Integrity Flags
            </h3>
            <p className="text-xs text-amber-700 mb-3 leading-relaxed">
              These flags were automatically raised by the system. They may indicate areas that require
              manual HR review before making a final hiring decision.
            </p>
            <div className="flex flex-wrap gap-2">
              {(report.flags as string[]).map((f) => (
                <span key={f} className="bg-amber-100 text-amber-800 border border-amber-300 rounded-xl px-3 py-1.5 text-xs font-bold">
                  {f.replaceAll('_', ' ').replace(/(^\w)/, (c) => c.toUpperCase())}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── 9. Action Bar ─────────────────────────────────── */}
        <div className="flex items-center justify-between border-t border-zinc-200 pt-6">
          <Link
            href="/admin/reports"
            className="flex items-center gap-2 text-sm font-semibold text-zinc-500 hover:text-zinc-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to All Reports
          </Link>
          <div className="flex items-center gap-3">
            {isCompleted && !report && (
              <form action={`/api/interview/${id}/score`} method="POST">
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold rounded-xl transition-all shadow"
                >
                  Generate Score Report
                </button>
              </form>
            )}
            <Link
              href={`/admin/reports/${id}`}
              className="px-5 py-2.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 text-sm font-bold rounded-xl transition-all"
            >
              Refresh Report
            </Link>
          </div>
        </div>

      </main>
    </div>
  );
}
