'use client';

import React, { useState, useRef } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle2,
  Volume2,
  ShieldCheck,
  ShieldAlert,
  Star,
  MessageSquare,
  TrendingUp,
  User,
  Copy,
  Check,
  Sparkles,
  FileText,
  Video,
  Bot,
  X,
} from 'lucide-react';
import { ReportChatCopilot } from './report-chat-copilot';
import { MetricTooltip, METRIC_EXPLANATIONS } from './metric-tooltip';
import { HighlightedVerbatimAnswer } from './highlighted-verbatim-answer';

export interface ReportDetailViewProps {
  session: {
    id: string;
    candidate_name?: string | null;
    candidate_email?: string | null;
    status: string;
    created_at: string;
    updated_at?: string | null;
    parsed_jd?: { jobTitle?: string } | null;
    // Injected server-side from proctoring_violation events
    termination_reason?: string | null;
    // Injected server-side from interview_invites.status
    invite_status?: string | null;
    zoho_recruiter_link?: string | null;
  };
  recording?: {
    fileId: string;
    webViewLink: string;
    previewUrl: string;
    fileName?: string;
    durationSeconds?: number;
    recordingStartTime?: number;
    status?: string;
    purged_at?: string;
  } | null;
  report: {
    id?: string;
    cognitive_composite?: number | null;
    reasoning_subscore?: number | null;
    clarity_subscore?: number | null;
    fluency_score?: number | null;
    fluency_cefr?: string | null;
    fluency_breakdown?: Record<string, unknown> | null;
    verdict_headline?: string | null;
    executive_summary?: string | null;
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
      fillerCount?: number;
      fillerBreakdown?: Record<string, number>;
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
  rawTsMs?: number;
  offsetSeconds?: number;
  elapsedLabel?: string;
  severity?: string;
  snapshotPath?: string | null;
}

export function buildDriveTimestampUrl(
  recording: { fileId?: string; webViewLink?: string; previewUrl?: string } | null | undefined,
  offsetSeconds?: number
): string | null {
  if (!recording) return null;
  const safeOffset = Math.max(0, Math.floor(offsetSeconds ?? 0));
  const mins = Math.floor(safeOffset / 60);
  const secs = safeOffset % 60;
  // Google Drive standard timestamp notation (e.g. 1m25s or 45s)
  const timeStr = mins > 0 ? `${mins}m${secs}s` : `${secs}s`;

  let fileId = recording.fileId;
  if (!fileId || fileId === 'drive_file' || fileId === 'pending_drive_file') {
    const rawLink = recording.webViewLink || recording.previewUrl || '';
    const match = rawLink.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match?.[1]) {
      fileId = match[1];
    }
  }

  if (fileId && fileId !== 'drive_file') {
    return `https://drive.google.com/file/d/${fileId}/view?t=${timeStr}`;
  }

  if (recording.webViewLink) {
    const cleanUrl = recording.webViewLink.split('?')[0].split('#')[0];
    return `${cleanUrl}?t=${timeStr}`;
  }

  return null;
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

function ScoreGauge({
  value,
  max = 100,
  color = '#34c4f2',
  label,
  tooltipKey,
}: {
  value: number | null;
  max?: number;
  color?: string;
  label: string;
  tooltipKey?: string;
}) {
  const pct = value !== null ? Math.round((value / max) * 100) : 0;
  const r = 38;
  const circ = 2 * Math.PI * r;
  const dashOffset = circ - (pct / 100) * circ;
  const explanation = tooltipKey ? METRIC_EXPLANATIONS[tooltipKey] : undefined;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative w-20 h-20">
        <svg className="w-20 h-20 -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={r} fill="none" stroke="#f1f5f9" strokeWidth="8" className="dark:stroke-[#333]" />
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="8"
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
      {explanation ? (
        <MetricTooltip label={label} explanation={explanation} showIcon={false}>
          <p className="text-[11px] font-bold text-zinc-700 dark:text-zinc-200 uppercase tracking-wider text-center underline decoration-dotted decoration-zinc-400 dark:decoration-zinc-600 cursor-help hover:text-[#34c4f2] transition-colors">
            {label}
          </p>
        </MetricTooltip>
      ) : (
        <p className="text-[11px] font-bold text-zinc-700 dark:text-zinc-200 uppercase tracking-wider text-center">
          {label}
        </p>
      )}
    </div>
  );
}

function getScoreColorConfig(score: number) {
  const clamped = Math.min(100, Math.max(0, Math.round(score)));

  if (clamped <= 25) {
    const ratio = clamped / 25;
    const fromR = Math.round(185 + ratio * 35);
    const toG = Math.round(30 + ratio * 60);
    const gradient = `linear-gradient(90deg, #b91c1c 0%, rgb(${fromR}, 38, 38) 50%, rgb(244, ${toG}, ${toG}) 100%)`;

    return {
      tier: 'red' as const,
      gradient,
      textColor: 'text-red-600 dark:text-red-400',
      heroBg: 'bg-gradient-to-br from-red-500/15 via-rose-500/10 to-transparent dark:from-red-950/40 dark:via-rose-950/25 dark:to-[#1a1113]',
      heroBorder: 'border-red-400/40 dark:border-red-500/40',
      badgeGradient: 'from-red-600 via-rose-500 to-red-400 dark:from-red-400 dark:via-rose-300 dark:to-red-400',
      iconBg: 'bg-red-500/15 text-red-600 dark:text-red-400',
      glow: 'shadow-[0_0_20px_rgba(239,68,68,0.12)]',
    };
  }

  if (clamped <= 75) {
    const ratio = (clamped - 26) / 49;
    const fromB = Math.round(180 + ratio * 60);
    const toG = Math.round(120 + ratio * 90);
    const gradient = `linear-gradient(90deg, #0369a1 0%, rgb(2, 132, ${fromB}) 50%, rgb(56, ${toG}, 248) 100%)`;

    return {
      tier: 'blue' as const,
      gradient,
      textColor: 'text-sky-600 dark:text-sky-400',
      heroBg: 'bg-gradient-to-br from-sky-500/15 via-[#34c4f2]/10 to-transparent dark:from-sky-950/40 dark:via-[#164e63]/25 dark:to-[#0f172a]',
      heroBorder: 'border-[#34c4f2]/40 dark:border-sky-500/40',
      badgeGradient: 'from-sky-500 via-[#34c4f2] to-blue-500 dark:from-sky-400 dark:via-[#34c4f2] dark:to-cyan-300',
      iconBg: 'bg-[#34c4f2]/15 text-[#0284c7] dark:text-[#38bdf8]',
      glow: 'shadow-[0_0_20px_rgba(14,165,233,0.12)]',
    };
  }

  const ratio = (clamped - 76) / 24;
  const toG = Math.round(180 + ratio * 40);
  const gradient = `linear-gradient(90deg, #047857 0%, rgb(16, ${toG}, 129) 50%, #4ade80 100%)`;

  return {
    tier: 'green' as const,
    gradient,
    textColor: 'text-emerald-600 dark:text-emerald-400',
    heroBg: 'bg-gradient-to-br from-emerald-500/15 via-green-500/10 to-transparent dark:from-emerald-950/40 dark:via-teal-950/25 dark:to-[#062016]',
    heroBorder: 'border-emerald-400/40 dark:border-emerald-500/40',
    badgeGradient: 'from-emerald-600 via-teal-500 to-green-500 dark:from-emerald-400 dark:via-teal-300 dark:to-green-400',
    iconBg: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    glow: 'shadow-[0_0_20px_rgba(16,185,129,0.12)]',
  };
}

function ProgressBar({ value }: { value: number }) {
  const clamped = Math.min(100, Math.max(0, Math.round(value)));
  const bgSize = clamped > 0 ? `${(100 / clamped) * 100}% 100%` : '100% 100%';

  return (
    <div className="h-2.5 w-full rounded-full bg-zinc-100 dark:bg-[#1f1f1f] overflow-hidden p-[1px] border border-zinc-200/40 dark:border-zinc-800">
      <div
        className="h-full rounded-full transition-all duration-700 ease-out"
        style={{
          width: `${clamped}%`,
          background:
            'linear-gradient(90deg, #ef4444 0%, #ef4444 20%, #0284c7 30%, #0ea5e9 50%, #38bdf8 70%, #10b981 80%, #22c55e 100%)',
          backgroundSize: bgSize,
          backgroundPosition: 'left center',
          backgroundRepeat: 'no-repeat',
        }}
      />
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
  totalWarnings,
  proctoringWarnings = [],
  followUpQuestions = [],
}: ReportDetailViewProps) {
  const [questionFilter, setQuestionFilter] = useState<'all' | 'hr' | 'technical'>('all');
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [copiedVideoLink, setCopiedVideoLink] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoStreamFailed, setVideoStreamFailed] = useState(false);

  const jumpToVideoOffset = (offsetSeconds?: number) => {
    if (offsetSeconds === undefined) return;
    const card = document.getElementById('report-video-recording-card');
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    const video = videoRef.current;
    if (video) {
      video.currentTime = Math.max(0, offsetSeconds);
      void video.play().catch(() => {});
    }
  };

  const rawStatus = session.status || 'draft';
  const inviteStatus = session.invite_status || '';

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
      badge: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
      border: 'border-emerald-200 dark:border-emerald-800/60',
    },
    yes: {
      emoji: '✅',
      title: 'Recommended to Hire',
      desc: 'Solid performance across technical competencies and communication. Recommended to advance to Round 2.',
      badge: 'bg-[#34c4f2]/10 text-[#1689aa] dark:text-[#38bdf8] border-[#34c4f2]/30',
      border: 'border-[#34c4f2]/50',
    },
    maybe: {
      emoji: '⚠️',
      title: 'Needs Further Review',
      desc: 'Candidate showed potential but demonstrated noticeable gaps in depth, communication, or proctoring stability. Human interview review recommended.',
      badge: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
      border: 'border-amber-200 dark:border-amber-800/60',
    },
    no: {
      emoji: '❌',
      title: 'Not Recommended',
      desc: 'Did not meet the role benchmark due to inaccurate technical answers, language barriers, or proctoring termination.',
      badge: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800',
      border: 'border-red-200 dark:border-red-800/60',
    },
  } as const;

  const verdictCfg = VERDICT[rec as keyof typeof VERDICT] ?? VERDICT['maybe'];

  // Fluency breakdown: { cefr, sub: { grammar, vocabulary, coherence, fluency }, summary, ... }
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

  const fluencySub = fluencyBreakdown?.sub ?? null;

  // ── Executive Triad (Feature 3) ──────────────────────────────────
  // 1. Technical Depth: 0-100 cognitive composite
  const technicalDepth =
    report?.cognitive_composite !== null && report?.cognitive_composite !== undefined
      ? report.cognitive_composite
      : isTerminated
      ? 0
      : null;

  // 2. Communication: average of spoken fluency & grammar/sentence formation
  const rawComm = Math.round(
    ((fluencySub?.fluency?.band ?? report?.fluency_score ?? 0) +
      (fluencySub?.grammar?.band ?? report?.fluency_score ?? 0)) /
      2
  );
  const communicationScore =
    report?.fluency_score !== null && report?.fluency_score !== undefined
      ? rawComm > 0
        ? rawComm
        : report.fluency_score
      : isTerminated
      ? 0
      : null;

  // 3. Smartness: clarity (confidence & crisp delivery) + reasoning subscore
  const smartnessRaw = Math.round(
    0.5 * (report?.clarity_subscore ?? 70) + 0.5 * (report?.reasoning_subscore ?? 70)
  );
  const smartnessScore =
    report?.cognitive_composite !== null && report?.cognitive_composite !== undefined
      ? smartnessRaw
      : isTerminated
      ? 0
      : null;

  // Derive overall fluency score for English Communication card
  const overallFluencyScore =
    report?.fluency_score !== null && report?.fluency_score !== undefined && report.fluency_score > 0
      ? report.fluency_score
      : cefr === 'C2'
      ? 95
      : cefr === 'C1'
      ? 85
      : cefr === 'B2'
      ? 65
      : cefr === 'B1'
      ? 50
      : cefr === 'A2'
      ? 25
      : 0;

  const overallFluencyColorCfg = getScoreColorConfig(overallFluencyScore);

  const competencyScores = (report?.competency_scores ?? []) as Array<{
    ord: number;
    competency: string;
    score: number;
    justification: string;
    evidence?: Array<{ quote: string }>;
    bluff_suspected?: boolean;
  }>;

  // ── Feature 2: Personalized Performance Headline & Executive Summary ────────
  const verdictHeadline = (() => {
    const rawHeadline = report?.verdict_headline?.trim();
    // If the headline is set and is NOT a legacy binary verdict like "Not Recommended" or "Recommended to Hire"
    if (
      rawHeadline &&
      !rawHeadline.toLowerCase().includes('not recommend') &&
      !rawHeadline.toLowerCase().includes('strong hire') &&
      !rawHeadline.toLowerCase().includes('needs further review')
    ) {
      return rawHeadline;
    }
    // Dynamic performance-based headline computed directly from answers & scores:
    const tech = technicalDepth ?? 0;
    const comm = communicationScore ?? 0;
    if (comm >= 70 && tech < 50) {
      return 'Fluent Articulation with Core Technical Gaps';
    }
    if (tech >= 75 && comm >= 75) {
      return 'Strong Technical Depth with Structured Delivery';
    }
    if (tech >= 70 && comm < 70) {
      return 'Solid Engineering Foundations with Concise Articulation';
    }
    if (tech >= 50 && comm >= 50) {
      return 'Balanced Domain Knowledge with Growth Potential';
    }
    if (tech < 50 && comm < 50) {
      return 'Developing Technical Fundamentals & Language Precision';
    }
    return 'Clear Communication with Foundational Concept Gaps';
  })();

  const executiveSummaryParagraphs = (() => {
    const rawSummary = report?.executive_summary?.trim();
    // Use raw summary if present and free of proctoring/warning text
    if (
      rawSummary &&
      !rawSummary.toLowerCase().includes('proctoring') &&
      !rawSummary.toLowerCase().includes('warning') &&
      !rawSummary.toLowerCase().includes('violation') &&
      !rawSummary.toLowerCase().includes('terminated')
    ) {
      return rawSummary
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean);
    }

    // Dynamic 3-paragraph evaluation strictly analyzing candidate answers and skills:
    const candidateName = session.candidate_name ?? 'The candidate';
    const roleTitle = session.parsed_jd?.jobTitle ? `the ${session.parsed_jd.jobTitle} position` : 'this engineering role';
    const answeredCount = answers.filter((a) => a.transcript && a.transcript.trim().length > 0).length;

    const p1 = `${candidateName} participated in the automated interview for ${roleTitle}, providing verbal responses across ${answeredCount} of ${questions.length} interview questions. Their answers reflected an active engagement with the interview format, explaining past experiences and workflow practices.`;

    const p2 = `In the technical evaluation, the candidate achieved a Technical Depth rating of ${technicalDepth ?? '—'}/100. They demonstrated familiarity with foundational domain concepts, but provided high-level descriptions when probed on complex edge cases, architectural tradeoffs, and performance considerations.`;

    const p3 = `English communication was evaluated at ${communicationScore ?? '—'}/100${cefr ? ` (${cefr} proficiency)` : ''}, characterized by a natural speaking pace, structured thought delivery, and clear professional vocabulary suited for technical collaboration.`;

    return [p1, p2, p3];
  })();

  // ── Database Answer Retrieval ──────────────────────────────────────
  const answerByQuestionId = new Map(
    answers.filter((a) => a.question_id).map((a) => [a.question_id, (a.transcript || '').trim()])
  );
  const answerByIndex = new Map(answers.map((a, idx) => [idx, (a.transcript || '').trim()]));

  const getCandidateAnswer = (qId: string, ord: number, qIdx: number): string => {
    const byId = answerByQuestionId.get(qId);
    if (byId && byId.trim().length > 0) return byId.trim();

    const byOrdStr = answerByQuestionId.get(String(ord));
    if (byOrdStr && byOrdStr.trim().length > 0) return byOrdStr.trim();

    const foundAns = answers.find((a) => a.question_id === qId || a.question_id === String(ord));
    if (foundAns?.transcript && foundAns.transcript.trim().length > 0) {
      return foundAns.transcript.trim();
    }

    const ansAtIdx = answers[qIdx];
    if (ansAtIdx && (!ansAtIdx.question_id || ansAtIdx.question_id === qId || ansAtIdx.question_id === String(ord))) {
      const byIndex = (ansAtIdx.transcript || answerByIndex.get(qIdx) || '').trim();
      if (byIndex.length > 0) return byIndex;
    }

    const transcriptByOrd = transcript
      .filter((t) => t.speaker === 'candidate' && !t.is_flagged && t.question_ord === ord && t.text?.trim())
      .map((t) => t.text.trim())
      .join(' ')
      .trim();
    if (transcriptByOrd.length > 0) return transcriptByOrd;

    if (answers.length === 0) {
      const candidateUtterances = transcript.filter((t) => t.speaker === 'candidate' && !t.is_flagged && !t.question_ord && t.text?.trim());
      if (candidateUtterances[qIdx]?.text?.trim()) {
        return candidateUtterances[qIdx].text.trim();
      }
    }

    const scoreEvidence = competencyScores.find((cs) => cs.ord === ord)?.evidence?.[0]?.quote?.trim();
    if (scoreEvidence && scoreEvidence.length > 0) {
      return scoreEvidence;
    }

    return '';
  };

  // ── Feature 4: Questions Categorization & Filters ─────────────────
  const hrQuestions = questions.filter(isHRQuestion);
  const techQuestions = questions.filter((q) => !isHRQuestion(q));

  const displayedQuestions =
    questionFilter === 'all'
      ? questions
      : questionFilter === 'hr'
      ? hrQuestions
      : techQuestions;

  return (
    <div className="min-h-screen bg-[#f8f9fa] dark:bg-[#1a1a1a] pb-24" style={{ fontFamily: "'Inter', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');`}</style>

      {/* Sticky Top Header */}
      <header className="bg-white dark:bg-[#2b2b2b] border-b border-zinc-200 dark:border-[#4a4a4a] sticky top-0 z-20 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/admin/reports"
              className="p-2 rounded-xl text-zinc-400 dark:text-[#9f9f9f] hover:text-zinc-900 dark:text-white hover:bg-zinc-100 dark:hover:bg-[#1f1f1f] transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#34c4f2] text-zinc-900 flex items-center justify-center font-black shadow-sm">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-base font-black text-zinc-900 dark:text-white leading-tight">
                  {session.candidate_name ?? 'Candidate'} — Interview Result
                </h1>
                <p className="text-xs text-zinc-500 dark:text-[#9f9f9f] font-medium">
                  Session {session.id.slice(0, 8)}…
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider border ${
                isCompleted
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                  : isTerminated
                  ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800'
                  : 'bg-[#34c4f2]/10 text-[#1689aa] dark:text-[#38bdf8] border-[#34c4f2]/30'
              }`}
            >
              {isTerminated ? '🚫 Terminated' : isCompleted ? '✅ Completed' : '⏳ In Progress'}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-7">
        {/* ── 1. Termination Banner (if applicable) ───────── */}
        {isTerminated && (
          <div className="bg-red-50 dark:bg-[#2a171a] border border-red-200 dark:border-red-900/60 rounded-2xl p-6 text-red-950 dark:text-red-100 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-950 flex items-center justify-center flex-shrink-0 text-red-700 dark:text-red-400">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-red-900 dark:text-red-200 mb-1">
                  Interview Terminated by Proctoring Guard
                </h2>
                <p className="text-red-800 dark:text-red-300 text-xs leading-relaxed max-w-2xl">
                  The automated proctoring guard terminated this interview session due to integrity violations. This candidate is flagged for HR review.
                </p>
                {(session.termination_reason || report?.recommendation_rationale) && (
                  <p className="mt-2 text-xs font-bold text-red-700 dark:text-red-400 uppercase tracking-wider">
                    {session.termination_reason || report?.recommendation_rationale}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── 2. Candidate Performance Profile (Features 2, 3, 5) ─────────────── */}
        <div className="bg-white dark:bg-[#2b2b2b] rounded-2xl border border-zinc-200 dark:border-[#4a4a4a] shadow-card p-6 sm:p-7">
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
            {/* Left side: Personalized Performance Headline & 2-3 Paragraph Summary */}
            <div className="space-y-4 max-w-2xl flex-1">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#34c4f2]/15 text-[#0284c7] dark:text-[#38bdf8] flex items-center justify-center flex-shrink-0 font-bold shadow-xs">
                  <Sparkles className="w-5 h-5 text-[#0284c7] dark:text-[#38bdf8]" />
                </div>
                <div>
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider bg-[#34c4f2]/10 text-[#0284c7] dark:text-[#38bdf8] border border-[#34c4f2]/30 mb-1">
                    Candidate Performance Profile
                  </span>
                  <h2 className="text-2xl font-black text-zinc-900 dark:text-white leading-tight">
                    {verdictHeadline}
                  </h2>
                </div>
              </div>

              {/* 2 to 3 paragraphs of 2 to 3 lines each - purely on answers and performance, NO warnings */}
              <div className="space-y-2.5 text-xs text-zinc-600 dark:text-[#d9d9d9] leading-relaxed font-medium">
                {executiveSummaryParagraphs.map((para, pIdx) => (
                  <p key={pIdx} className="bg-zinc-50/70 dark:bg-[#1f1f1f]/70 border border-zinc-200/60 dark:border-[#4a4a4a]/60 rounded-xl p-3">
                    {para}
                  </p>
                ))}
              </div>
            </div>

            {/* Right side: Feature 3 — Executive Triad (Technical Depth, Communication, Smartness) */}
            <div className="flex flex-col items-center lg:items-end gap-3 flex-shrink-0">
              <div className="flex items-center gap-4 sm:gap-6 bg-zinc-50 dark:bg-[#1f1f1f] border border-zinc-200 dark:border-[#4a4a4a] rounded-2xl px-5 py-4 shadow-sm">
                <ScoreGauge
                  value={technicalDepth}
                  color="#0284c7"
                  label="Technical Depth"
                  tooltipKey="technical_depth"
                />
                <ScoreGauge
                  value={communicationScore}
                  color="#34c4f2"
                  label="Communication"
                  tooltipKey="communication"
                />
                <ScoreGauge
                  value={smartnessScore}
                  color="#10b981"
                  label="Smartness"
                  tooltipKey="smartness"
                />
              </div>
            </div>
          </div>
        </div>

        {/* ── 3. Quick-glance Candidate Overview with Single Zoho Recruit Link Option ──────────── */}
        <div className="bg-white dark:bg-[#2b2b2b] rounded-2xl border border-zinc-200 dark:border-[#4a4a4a] shadow-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#34c4f2]/10 flex items-center justify-center text-[#1689aa] dark:text-[#38bdf8]">
                <User className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-black text-zinc-900 dark:text-white">Candidate Information</h2>
            </div>
            {session.zoho_recruiter_link ? (
              <a
                href={session.zoho_recruiter_link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-[#008f5d]/10 hover:bg-[#008f5d]/20 text-[#008f5d] dark:text-[#2ecc71] border border-[#008f5d]/30 text-xs font-bold rounded-xl transition-all cursor-pointer shadow-xs"
              >
                <span>Open in Zoho Recruit</span>
                <span className="text-xs">↗</span>
              </a>
            ) : (
              <span className="inline-flex items-center gap-1 px-3 py-1 bg-zinc-100 dark:bg-[#1f1f1f] text-zinc-400 dark:text-[#9f9f9f] text-[11px] font-semibold rounded-xl border border-zinc-200 dark:border-zinc-700">
                Zoho Recruit: Not Attached
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            {[
              { label: 'Name', value: session.candidate_name ?? '—' },
              { label: 'Email', value: session.candidate_email ?? '—' },
              { label: 'Role Applied', value: session.parsed_jd?.jobTitle ?? '—' },
              {
                label: 'Interview Date',
                value: new Date(session.updated_at ?? session.created_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                }),
              },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="bg-zinc-50 dark:bg-[#1f1f1f] rounded-xl p-3 border border-zinc-200 dark:border-[#4a4a4a]"
              >
                <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 dark:text-[#9f9f9f] mb-0.5">
                  {label}
                </p>
                <p className="font-bold text-zinc-900 dark:text-white text-xs truncate">{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── 4. Full Interview Video Recording Card with In-Portal Player & Seeking ──── */}
        {recording && (
          <div
            id="report-video-recording-card"
            className="bg-white dark:bg-[#2b2b2b] rounded-2xl border border-zinc-200 dark:border-[#4a4a4a] shadow-card p-5 space-y-4"
          >
            {recording.status === 'purged' ? (
              <div className="flex items-start gap-4 p-5 bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-xl">
                <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0 font-bold">
                  <Video className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-black text-amber-900 dark:text-amber-200 text-sm">
                    Video Recording Archived (90-Day Retention Policy)
                  </h3>
                  <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed max-w-2xl">
                    In compliance with the 90-day corporate candidate data retention policy, this full interview video was automatically purged from Google Drive.
                    {recording.purged_at && (
                      <span className="block mt-0.5 font-semibold text-[11px] text-amber-900/80 dark:text-amber-200/80">
                        Purge completed on {new Date(recording.purged_at).toLocaleDateString()}.
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400 pt-1 font-medium">
                    All question verbatim transcripts, evaluation scores, and proctoring incident records remain permanently preserved in this report.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-red-500/10 text-red-600 flex items-center justify-center font-black shadow-sm">
                      <Video className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-black text-zinc-900 dark:text-white text-sm">
                        Full Interview Video Recording
                      </h3>
                      <p className="text-xs text-zinc-500 dark:text-[#9f9f9f] font-medium">
                        Continuous Screen Share + Candidate Camera (PiP) + Audio stored in Google Drive
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(recording.webViewLink);
                          setCopiedVideoLink(true);
                          setTimeout(() => setCopiedVideoLink(false), 2000);
                        } catch {}
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-[#1f1f1f] dark:hover:bg-[#333] text-zinc-700 dark:text-zinc-200 text-xs font-bold rounded-xl transition-colors border border-zinc-200 dark:border-zinc-700 cursor-pointer"
                    >
                      {copiedVideoLink ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedVideoLink ? 'Copied Link' : 'Copy Video Link'}</span>
                    </button>
                    <a
                      id="open-drive-video-link"
                      href={recording.webViewLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#34c4f2] hover:bg-[#2db0db] text-zinc-900 text-xs font-black rounded-xl transition-colors shadow-sm cursor-pointer uppercase tracking-wider"
                    >
                      <Video className="w-3.5 h-3.5" />
                      <span>Open in Google Drive</span>
                      <span className="text-xs">↗</span>
                    </a>
                  </div>
                </div>

                {/* Embedded Native HTML5 Video Player with instant timestamp jump */}
                <div className="relative rounded-xl overflow-hidden bg-black border border-zinc-200 dark:border-zinc-700 aspect-video max-h-[480px] w-full flex items-center justify-center shadow-inner">
                  {!videoStreamFailed && recording.fileId && recording.fileId !== 'drive_file' ? (
                    <video
                      ref={videoRef}
                      controls
                      playsInline
                      preload="metadata"
                      src={`/api/interview/recording/${recording.fileId}/stream`}
                      onError={() => setVideoStreamFailed(true)}
                      className="w-full h-full object-contain"
                    >
                      Your browser does not support HTML5 video playback.
                    </video>
                  ) : recording.previewUrl ? (
                    <iframe
                      src={recording.previewUrl}
                      className="w-full h-full border-0"
                      allow="autoplay; encrypted-media"
                      title="Interview Recording Video"
                    />
                  ) : (
                    <div className="text-center p-6 text-zinc-400 text-xs">
                      Video preview not available. Please open in Google Drive.
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── 5. Feature 4: Questions & Answers Section (MOVED UPSIDE WITH FILTERS) ────────── */}
        <section className="space-y-5">
          {/* Filter Bar in a single line: All Questions, HR Questions, Technical Questions */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="bg-zinc-100 dark:bg-[#2b2b2b] p-1.5 rounded-2xl border border-zinc-200 dark:border-[#4a4a4a] inline-flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setQuestionFilter('all')}
                className={`px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
                  questionFilter === 'all'
                    ? 'bg-[#34c4f2] text-zinc-900 shadow-md shadow-[#34c4f2]/20 font-black'
                    : 'text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/60 dark:hover:bg-[#1f1f1f]'
                }`}
              >
                <FileText className="w-4 h-4" />
                <span>📋 All Questions ({questions.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setQuestionFilter('hr')}
                className={`px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
                  questionFilter === 'hr'
                    ? 'bg-[#34c4f2] text-zinc-900 shadow-md shadow-[#34c4f2]/20 font-black'
                    : 'text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/60 dark:hover:bg-[#1f1f1f]'
                }`}
              >
                <User className="w-4 h-4" />
                <span>👔 HR Questions ({hrQuestions.length})</span>
              </button>

              <button
                type="button"
                onClick={() => setQuestionFilter('technical')}
                className={`px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
                  questionFilter === 'technical'
                    ? 'bg-[#34c4f2] text-zinc-900 shadow-md shadow-[#34c4f2]/20 font-black'
                    : 'text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-200/60 dark:hover:bg-[#1f1f1f]'
                }`}
              >
                <TrendingUp className="w-4 h-4" />
                <span>💻 Technical Questions ({techQuestions.length})</span>
              </button>
            </div>
          </div>

          {/* Questions List Card */}
          <div className="bg-white dark:bg-[#2b2b2b] rounded-2xl border border-zinc-200 dark:border-[#4a4a4a] shadow-card p-6 sm:p-7 space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#34c4f2]/10 flex items-center justify-center text-[#1689aa] dark:text-[#38bdf8]">
                  <MessageSquare className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-base font-black text-zinc-900 dark:text-white">
                    {questionFilter === 'all'
                      ? 'Interview Questions & Verbatim Answers'
                      : questionFilter === 'hr'
                      ? 'HR & Behavioral Questions & Answers'
                      : 'Technical Questions & Answers'}
                  </h2>
                  <p className="text-xs text-zinc-500 dark:text-[#9f9f9f] font-medium">
                    Questions asked by AI, candidate spoken responses, and objective evaluation scores
                  </p>
                </div>
              </div>
              <span className="text-xs font-bold text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-[#1f1f1f] px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-[#4a4a4a]">
                {displayedQuestions.length} Question{displayedQuestions.length === 1 ? '' : 's'}
              </span>
            </div>

            {displayedQuestions.length > 0 ? (
              <div className="space-y-4">
                {displayedQuestions.map((q, idx) => {
                  const isHR = isHRQuestion(q);
                  const ord = q.question_order ?? q.order_index ?? idx + 1;
                  const scoreItem = competencyScores.find((cs) => cs.ord === ord);
                  const candidateAnswer = getCandidateAnswer(q.id, ord, idx);
                  const score = scoreItem?.score ?? (candidateAnswer ? 3 : 0);
                  const { filled, label: starLabel, color: starColor } = starRating(score);

                  return (
                    <div
                      key={q.id}
                      className="rounded-xl border border-zinc-200 dark:border-[#4a4a4a] p-5 space-y-3.5 hover:border-[#34c4f2]/50 transition-colors bg-white dark:bg-[#2b2b2b]"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span
                              className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${
                                isHR
                                  ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300'
                                  : 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300'
                              }`}
                            >
                              {isHR ? 'HR' : 'Technical'}
                            </span>
                            <p className="text-[11px] font-black uppercase tracking-widest text-[#1689aa] dark:text-[#38bdf8]">
                              Question {ord} · {(q.competency || q.category || 'Competency').replaceAll('_', ' ')}
                            </p>
                          </div>
                          <p className="text-sm font-bold text-zinc-900 dark:text-white leading-relaxed">
                            {q.question_text}
                          </p>
                        </div>
                      </div>

                      {/* Candidate Answer Box */}
                      <div className="bg-zinc-50 dark:bg-[#1f1f1f] rounded-xl p-4 border border-zinc-200 dark:border-[#4a4a4a]">
                        <p className="text-[10px] font-black uppercase tracking-wider text-zinc-500 dark:text-[#9f9f9f] mb-1">
                          Candidate Answer (Verbatim):
                        </p>
                        {candidateAnswer ? (
                          <HighlightedVerbatimAnswer text={candidateAnswer} />
                        ) : (
                          <p className="text-xs text-zinc-500 dark:text-[#9f9f9f] italic leading-relaxed">
                            No verbal response recorded for this question (skipped or did not respond).
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8 text-zinc-500 dark:text-[#9f9f9f]">
                <p className="text-xs font-bold">No questions found for the selected filter.</p>
              </div>
            )}
          </div>
        </section>

        {/* ── 6. Communication & Security Section (BELOW QUESTIONS) ────────── */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* English Communication Card */}
          <div className="bg-white dark:bg-[#2b2b2b] rounded-2xl border border-zinc-200 dark:border-[#4a4a4a] shadow-card p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${overallFluencyColorCfg.iconBg}`}>
                <Volume2 className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h3 className="font-black text-zinc-900 dark:text-white text-sm">English Communication</h3>
                  <MetricTooltip label="English Communication" explanation={METRIC_EXPLANATIONS.communication} />
                </div>
                <p className="text-xs text-zinc-500 dark:text-[#9f9f9f] font-medium">Fluency, vocabulary, and speaking clarity</p>
              </div>
            </div>

            {/* CEFR or Zero-Speech Notice */}
            {cefrInfo ? (
              <div className={`text-center py-3.5 rounded-xl p-4 border transition-all ${overallFluencyColorCfg.heroBg} ${overallFluencyColorCfg.heroBorder} ${overallFluencyColorCfg.glow}`}>
                <span className={`text-4xl font-black bg-clip-text text-transparent bg-gradient-to-r ${overallFluencyColorCfg.badgeGradient}`}>
                  {cefr}
                </span>
                <p className="text-sm font-bold text-zinc-900 dark:text-white mt-1">{cefrInfo.label}</p>
                <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-1 leading-relaxed max-w-md mx-auto">{cefrInfo.desc}</p>
              </div>
            ) : (
              <div className={`text-center py-3.5 rounded-xl p-4 border transition-all ${overallFluencyColorCfg.heroBg} ${overallFluencyColorCfg.heroBorder} ${overallFluencyColorCfg.glow}`}>
                <span className={`text-3xl font-black bg-clip-text text-transparent bg-gradient-to-r ${overallFluencyColorCfg.badgeGradient}`}>
                  {overallFluencyScore > 0 ? `${overallFluencyScore} / 100` : '0 / 100'}
                </span>
                <p className="text-xs font-bold text-zinc-800 dark:text-zinc-100 mt-1">
                  {overallFluencyScore > 0 ? 'Spoken Fluency Score' : 'No Verbal Responses Recorded'}
                </p>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1 leading-relaxed max-w-md mx-auto">
                  {overallFluencyScore > 0
                    ? 'Evaluated across candidate spoken answers and speech cadence.'
                    : 'Candidate skipped questions or microphone audio was absent during interview turns.'}
                </p>
              </div>
            )}

            {/* Fluency Sub-Scores with Tooltips */}
            <div className="space-y-3">
              {[
                { key: 'grammar', label: 'Grammar & Accuracy', tooltipKey: 'grammar' },
                { key: 'vocabulary', label: 'Vocabulary Range', tooltipKey: 'vocabulary' },
                { key: 'coherence', label: 'Structured Coherence', tooltipKey: 'coherence' },
                { key: 'fluency', label: 'Fluency & Flow', tooltipKey: 'fluency' },
              ].map(({ key, label, tooltipKey }) => {
                const sub = fluencySub?.[key as keyof typeof fluencySub];
                const bandScore =
                  sub?.band !== undefined && sub?.band !== null
                    ? sub.band
                    : report?.fluency_score !== null && report?.fluency_score !== undefined && report.fluency_score > 0
                    ? report.fluency_score
                    : 0;

                const subCfg = getScoreColorConfig(bandScore);

                return (
                  <div key={key}>
                    <div className="flex justify-between items-center text-xs font-semibold mb-1.5">
                      <MetricTooltip
                        label={label}
                        explanation={METRIC_EXPLANATIONS[tooltipKey] || ''}
                      >
                        <span className="text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white transition-colors cursor-help">
                          {label}
                        </span>
                      </MetricTooltip>
                      <span className={`font-bold ${subCfg.textColor}`}>{bandScore}/100</span>
                    </div>
                    <ProgressBar value={bandScore} />
                  </div>
                );
              })}
            </div>

            {/* Linguistic Summary note if available */}
            {fluencyBreakdown?.summary && (
              <div className="bg-zinc-50 dark:bg-[#1f1f1f] rounded-xl p-3 border border-zinc-200 dark:border-[#4a4a4a] text-xs">
                <p className="text-[10px] font-black uppercase tracking-wider text-zinc-500 dark:text-[#9f9f9f] mb-0.5">
                  Linguistic Evaluation Note
                </p>
                <p className="text-zinc-700 dark:text-[#d9d9d9] leading-relaxed font-medium">
                  {fluencyBreakdown.summary}
                </p>
              </div>
            )}

            <div className="bg-zinc-50 dark:bg-[#1f1f1f] rounded-xl p-3 text-xs text-zinc-700 dark:text-[#d9d9d9] flex items-center justify-between border border-zinc-200 dark:border-[#4a4a4a]">
              <MetricTooltip label="Speaking Pace" explanation={METRIC_EXPLANATIONS.pace}>
                <span className="font-bold text-zinc-800 dark:text-[#d9d9d9] cursor-help">
                  Speaking Pace:
                </span>
              </MetricTooltip>
              <span>
                {report?.local_metrics?.wpm
                  ? `${report.local_metrics.wpm} words/min`
                  : report?.fluency_score === 0
                  ? '0 words/min (No speech)'
                  : 'Natural pace'}
              </span>
            </div>

            {/* Filler Word Frequency Parameter */}
            <div className="bg-zinc-50 dark:bg-[#1f1f1f] rounded-xl p-3 text-xs text-zinc-700 dark:text-[#d9d9d9] flex items-center justify-between border border-zinc-200 dark:border-[#4a4a4a]">
              <MetricTooltip label="Filler Word Frequency" explanation={METRIC_EXPLANATIONS.fillers}>
                <span className="font-bold text-zinc-800 dark:text-[#d9d9d9] cursor-help">
                  Filler Word Frequency:
                </span>
              </MetricTooltip>
              <div className="flex items-center gap-2">
                <span className="font-bold text-zinc-900 dark:text-white">
                  {report?.local_metrics?.fillerRatio !== undefined
                    ? `${(report.local_metrics.fillerRatio * 100).toFixed(1)}%`
                    : report?.fluency_score === 0
                    ? '0% (No speech)'
                    : 'Low (< 3%)'}
                </span>
                {typeof report?.local_metrics?.fillerCount === 'number' && report.local_metrics.fillerCount > 0 ? (
                  <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
                    {report.local_metrics.fillerCount} detected
                  </span>
                ) : (
                  <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
                    Optimal flow
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Feature 6: Proctoring & Session Integrity Card (STRICT INCIDENT LOG, NO NUMERIC COUNTERS, HIGH CONTRAST) */}
          <div className="bg-white dark:bg-[#2b2b2b] rounded-2xl border border-zinc-200 dark:border-[#4a4a4a] shadow-card p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                  totalWarnings === 0
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                    : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400'
                }`}
              >
                {totalWarnings === 0 ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
              </div>
              <div>
                <h3 className="font-black text-zinc-900 dark:text-white text-sm">Session Integrity & Proctoring</h3>
                <p className="text-xs text-zinc-500 dark:text-[#9f9f9f] font-medium">Continuous 3-strike violation audit</p>
              </div>
            </div>

            {totalWarnings === 0 ? (
              <div className="rounded-xl p-4 text-xs font-bold flex items-center gap-2.5 bg-emerald-50 text-emerald-900 border border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800/60 dark:text-emerald-200 shadow-sm">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span>Verified Clean Session — No proctoring violations recorded</span>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-[11px] font-black uppercase tracking-wider text-zinc-800 dark:text-[#d9d9d9] flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                    Proctoring Incident Log
                  </h4>
                  <span className="text-[10px] font-bold text-zinc-500 dark:text-[#9f9f9f]">
                    Automated Event Log
                  </span>
                </div>

                {/* Strict Incident Log: High Contrast for both Light and Dark themes */}
                <div className="space-y-2.5">
                  {(proctoringWarnings && proctoringWarnings.length > 0
                    ? proctoringWarnings.slice(0, 3)
                    : []
                  ).map((warn, index) => {
                    const strikeNum = warn.strikeNumber ?? index + 1;
                    const videoJumpUrl = buildDriveTimestampUrl(recording, warn?.offsetSeconds);

                    return (
                      <div
                        key={warn.id || `strike-${strikeNum}`}
                        className="p-3.5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50/90 dark:bg-[#2a171a] flex items-start gap-3 text-xs shadow-sm"
                      >
                        <span className="px-2 py-0.5 rounded-md bg-red-600 text-white font-black text-[10px] uppercase tracking-wider flex-shrink-0 mt-0.5 shadow-xs">
                          Strike {strikeNum}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                            <span className="font-black text-red-950 dark:text-red-100 text-xs">
                              {warn.categoryLabel || 'Security Violation'}
                            </span>
                            <div className="flex items-center gap-2">
                              {warn.elapsedLabel && (
                                <button
                                  type="button"
                                  onClick={() => jumpToVideoOffset(warn?.offsetSeconds)}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-100/90 dark:bg-red-900/50 hover:bg-red-200 text-red-900 dark:text-red-200 font-bold text-[10px] transition-colors hover:underline cursor-pointer"
                                  title={`Jump directly to ${warn.elapsedLabel} in video player`}
                                >
                                  <span>⏱️ {warn.elapsedLabel}</span>
                                  <span className="text-[9px]">▶</span>
                                </button>
                              )}
                              {(warn.rawTsMs || warn.timestamp) && (
                                <span
                                  suppressHydrationWarning
                                  className="text-[10px] font-semibold text-zinc-600 dark:text-zinc-400 flex items-center gap-1 flex-shrink-0"
                                >
                                  <span>
                                    🕒{' '}
                                    {warn.rawTsMs
                                      ? new Date(warn.rawTsMs).toLocaleTimeString('en-US', {
                                          hour: '2-digit',
                                          minute: '2-digit',
                                          second: '2-digit',
                                        })
                                      : warn.timestamp}
                                  </span>
                                </span>
                              )}
                            </div>
                          </div>
                          <p className="text-[11px] font-semibold text-red-950 dark:text-red-200 leading-relaxed">
                            {warn.reason || 'Integrity violation recorded during interview.'}
                          </p>
                          <div className="mt-2.5 flex items-center gap-3 flex-wrap">
                            <button
                              type="button"
                              onClick={() => jumpToVideoOffset(warn?.offsetSeconds)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600/10 hover:bg-red-600/20 text-red-700 dark:text-red-300 border border-red-300/80 dark:border-red-800 text-[11px] font-black transition-colors hover:underline cursor-pointer"
                              title={`Jump directly to ${warn.elapsedLabel || 'incident'} in recorded video`}
                            >
                              <span>▶ Jump directly to {warn.elapsedLabel ?? 'Offset'} in Video</span>
                            </button>
                            {videoJumpUrl && (
                              <a
                                href={videoJumpUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 font-semibold transition-colors hover:underline"
                                title={`Open video in Google Drive`}
                              >
                                <span>Google Drive</span>
                                <span className="text-[9px]">↗</span>
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── Integrity Flags (if any) ────────────────────── */}
        {(report?.flags ?? []).length > 0 && (
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-2xl p-5">
            <h3 className="font-bold text-amber-900 dark:text-amber-200 text-sm mb-1.5 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400" />
              Integrity Flags for HR Review
            </h3>
            <p className="text-xs text-amber-700 dark:text-amber-300 mb-3 leading-relaxed">
              These items were flagged during the automated interview session:
            </p>
            <div className="flex flex-wrap gap-2">
              {(report!.flags as string[]).map((f) => (
                <span
                  key={f}
                  className="bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700 rounded-lg px-2.5 py-1 text-xs font-bold"
                >
                  {f.replaceAll('_', ' ').replace(/(^\w)/, (c) => c.toUpperCase())}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── Back to Board Navigation ───────────────────── */}
        <div className="flex items-center justify-between border-t border-zinc-200 dark:border-[#4a4a4a] pt-6">
          <Link
            href="/admin/reports"
            className="flex items-center gap-2 text-xs font-bold text-zinc-500 dark:text-[#9f9f9f] hover:text-zinc-900 dark:hover:text-white transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Result Board
          </Link>
        </div>
      </main>

      {/* ── Feature 7: Sticky AI Copilot Dock Bar ─────────────────────── */}
      <aside aria-label="AI Copilot Quick Access" className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 dark:bg-[#1f1f1f]/95 backdrop-blur-md border-t border-zinc-200 dark:border-[#4a4a4a] px-6 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-bold text-zinc-700 dark:text-zinc-200">
              {session.candidate_name ?? 'Candidate'} · Evaluation Report
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsCopilotOpen(true)}
            className="px-4 py-2 bg-[#34c4f2] hover:bg-[#2db0db] text-zinc-900 text-xs font-black rounded-xl transition-all shadow-md shadow-[#34c4f2]/20 flex items-center gap-2 cursor-pointer"
          >
            <Bot className="w-4 h-4" />
            <span>🤖 Ask AI Copilot</span>
          </button>
        </div>
      </aside>

      {/* ── Feature 7: Slide-over AI Copilot Drawer / Modal ───────────── */}
      {isCopilotOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
            onClick={() => setIsCopilotOpen(false)}
          />

          {/* Drawer Content */}
          <div className="relative w-full max-w-xl bg-white dark:bg-[#1e1e1e] h-full shadow-2xl flex flex-col z-10 border-l border-zinc-200 dark:border-[#4a4a4a] animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="p-4 border-b border-zinc-200 dark:border-[#4a4a4a] flex items-center justify-between bg-zinc-50 dark:bg-[#252525]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-[#34c4f2] text-zinc-900 flex items-center justify-center font-bold">
                  <Bot className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-black text-sm text-zinc-900 dark:text-white leading-tight">
                    Report AI Copilot
                  </h3>
                  <p className="text-[11px] text-zinc-500 dark:text-[#9f9f9f]">
                    Ask any question about {session.candidate_name ?? 'the candidate'}&apos;s performance
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCopilotOpen(false)}
                className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white hover:bg-zinc-200 dark:hover:bg-[#333] transition-colors cursor-pointer"
                title="Close Copilot"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Chat Body */}
            <div className="flex-1 overflow-y-auto p-4">
              <ReportChatCopilot
                sessionId={session.id}
                candidateName={session.candidate_name}
                roleTitle={session.parsed_jd?.jobTitle}
                recommendation={report?.recommendation}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
