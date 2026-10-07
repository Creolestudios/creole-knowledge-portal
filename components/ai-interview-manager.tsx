'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  UploadCloud,
  FileText,
  Loader2,
  AlertCircle,
  Copy,
  Check,
  KeyRound,
  Link2,
  ClipboardPaste,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import type { IInterviewSummary } from '@/lib/ai-interview/types';
import type { ExtractionResult, SessionGenerationResult } from '@/lib/ai-interview/types';
import { KeywordAnalysisOverview, KeywordResults } from '@/components/ai-interview/keyword-results';
import { QuestionBankSelector } from '@/components/ai-interview/question-bank-selector';

const STATUS_BADGE_STYLES: Record<string, string> = {
  completed: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-100 dark:border-emerald-500/20',
  expired: 'bg-red-50 dark:bg-red-500/10 text-red-500 dark:text-red-400 border-red-100 dark:border-red-500/20',
  terminated: 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border-red-100 dark:border-red-500/20',
  revoked: 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border-red-100 dark:border-red-500/20',
  cancelled: 'bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 border-red-100 dark:border-red-500/20',
  in_progress: 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-100 dark:border-blue-500/20',
  ready: 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-500/20',
  pending: 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-500/20',
  active: 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-500/20',
  draft: 'bg-zinc-50 dark:bg-[#1f1f1f] text-zinc-500 dark:text-[#9f9f9f] border-zinc-100 dark:border-[#4a4a4a]',
  questions_generated: 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-100 dark:border-indigo-500/20',
};
const DEFAULT_STATUS_BADGE_STYLE = 'bg-zinc-50 dark:bg-[#1f1f1f] text-zinc-500 dark:text-[#9f9f9f] border-zinc-100 dark:border-[#4a4a4a]';

export default function AIInterviewManager() {
  const [candidateName, setCandidateName] = useState('');
  const [candidateEmail, setCandidateEmail] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [resume, setResume] = useState<File | null>(null);
  const [jdMode, setJdMode] = useState<'file' | 'text'>('text');
  const [jd, setJd] = useState<File | null>(null);
  const [jdText, setJdText] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [extractionResult, setExtractionResult] = useState<ExtractionResult | null>(null);
  const [sessionResult, setSessionResult] = useState<SessionGenerationResult | null>(null);

  const [interviews, setInterviews] = useState<IInterviewSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedInterview, setSelectedInterview] = useState<IInterviewSummary | null>(null);
  const [selectedInvite, setSelectedInvite] = useState<{ link: string; passcode: string } | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [modalCopied, setModalCopied] = useState<'link' | 'code' | null>(null);

  const isFetchingRef = useRef(false);

  const fetchInterviews = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      const res = await fetch('/api/admin/ai-interviews');
      if (!res.ok) {
        return;
      }
      const json = await res.json().catch(() => null);
      if (json && Array.isArray(json.interviews)) {
        setInterviews(json.interviews);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[ai-interview-manager] background load notice:', msg);
    } finally {
      isFetchingRef.current = false;
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    const initTimer = setTimeout(() => {
      if (isMounted) void fetchInterviews();
    }, 0);

    let channel: any = null;
    try {
      const supabase = createClient();
      channel = supabase
        .channel('admin-ai-interviews-live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'interview_sessions' }, () => {
          if (isMounted) void fetchInterviews();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'interview_invites' }, () => {
          if (isMounted) void fetchInterviews();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_interviews' }, () => {
          if (isMounted) void fetchInterviews();
        })
        .subscribe();
    } catch (err) {
      console.warn('[ai-interview-manager] realtime subscription fallback:', err);
    }

    const pollTimer = setInterval(() => {
      if (typeof document !== 'undefined' && !document.hidden && isMounted) {
        void fetchInterviews();
      }
    }, 5000);

    return () => {
      isMounted = false;
      clearTimeout(initTimer);
      clearInterval(pollTimer);
      if (channel) {
        try {
          const supabase = createClient();
          void supabase.removeChannel(channel);
        } catch {}
      }
    };
  }, [fetchInterviews]);

  /**
   * Step 1 of 2: analyzes the resume/JD and hands off to the question-bank
   * selection step (same category/question picker as the
   * `/dashboard/ai-interview/extractor` flow) instead of creating the
   * interview immediately — the admin still has to pick the exact questions
   * before a session and invite are created.
   */
  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setExtractionResult(null);
    setSessionResult(null);

    if (!resume) {
      setError('Please attach a resume.');
      return;
    }
    if (jdMode === 'file' && !jd) {
      setError('Please attach a job description file, or switch to pasting text.');
      return;
    }
    if (jdMode === 'text' && !jdText.trim()) {
      setError('Please paste the job description text, or switch to uploading a file.');
      return;
    }


    setSubmitting(true);
    try {
      setStatusMessage('Analyzing resume & job description...');
      const extractForm = new FormData();
      extractForm.append('resumeFile', resume);
      if (jdMode === 'file' && jd) extractForm.append('jdFile', jd);
      else extractForm.append('jdText', jdText.trim());

      let extractRes: Response;
      try {
        extractRes = await fetch('/api/ai-interview/extract', { method: 'POST', body: extractForm });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === 'Failed to fetch' || msg.includes('fetch')) {
          throw new Error('Network connection error: Failed to reach server. Please verify your connection or server status and try again.');
        }
        throw e;
      }

      let extractJson: (ExtractionResult & { error?: string }) | null = null;
      try {
        extractJson = await extractRes.json();
      } catch {
        // extractRes was not JSON (e.g. timeout or plain text error)
      }

      if (!extractRes.ok || !extractJson) {
        throw new Error(
          extractJson?.error ||
          `Failed to analyze resume and job description (${extractRes.status || 'Server error'}). Please try again.`
        );
      }

      // Admin-typed candidate/job fields take priority over whatever Gemini
      // extracted from the documents, since they're what the admin meant.
      const mergedExtraction: ExtractionResult = {
        ...extractJson,
        candidateProfile: {
          ...extractJson.candidateProfile,
          name: candidateName.trim() || extractJson.candidateProfile?.name,
          email: candidateEmail.trim() || extractJson.candidateProfile?.email,
        },
        jdRequirements: {
          ...extractJson.jdRequirements,
          jobTitle: jobTitle.trim() || extractJson.jdRequirements?.jobTitle,
        },
      };
      setExtractionResult(mergedExtraction);
      setStatusMessage(null);
    } catch (err) {
      console.error('[ai-interview-manager] analysis failed:', err);
      setStatusMessage(null);
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSessionComplete = (result: SessionGenerationResult) => {
    setSessionResult(result);
    fetchInterviews();
  };

  // Starts a fresh candidate: clears the form and both the analysis and the
  // generated session/invite, back to the upload step.
  const handleStartOver = () => {
    setCandidateName('');
    setCandidateEmail('');
    setJobTitle('');
    setResume(null);
    setJd(null);
    setJdText('');
    setExtractionResult(null);
    setSessionResult(null);
    setError(null);
  };

  const copyValue = async (
    value: string,
    kind: 'link' | 'code',
    setCopiedState: (kind: 'link' | 'code' | null) => void,
  ) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedState(kind);
      setTimeout(() => setCopiedState(null), 1500);
    } catch (err) {
      console.error('[ai-interview-manager] copy failed:', err);
    }
  };

  const copyModalValue = (value: string, kind: 'link' | 'code') => copyValue(value, kind, setModalCopied);

  /**
   * The invite passcode is hashed at rest (see /api/interviews/[id]/invite) and
   * can't be recovered once shown — so reopening a candidate's link mints a
   * brand new invite (fresh token + passcode) rather than trying to redisplay
   * one that no longer exists in plaintext.
   */
  const openInterview = async (interview: IInterviewSummary) => {
    setSelectedInterview(interview);
    setSelectedInvite(null);
    setInviteError(null);
    setInviteLoading(true);
    try {
      const res = await fetch(`/api/interviews/${interview.id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to generate an interview link.');
      setSelectedInvite({ link: json.invite_url, passcode: json.passcode });
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Failed to generate an interview link.');
    } finally {
      setInviteLoading(false);
    }
  };

  const closeInterviewModal = () => {
    setSelectedInterview(null);
    setSelectedInvite(null);
    setInviteError(null);
  };

  // Editing the resume/JD after an analysis clears it, so a stale analysis
  // never gets attached to a different candidate's documents.
  const clearSuccessState = () => {
    if (extractionResult) setExtractionResult(null);
    if (sessionResult) setSessionResult(null);
  };

  return (
    <div className="bg-white dark:bg-[#2b2b2b] rounded-2xl shadow-card border border-[#d9d9d9] dark:border-[#4a4a4a] overflow-hidden">
      <div className="p-8 border-b border-[#d9d9d9] dark:border-[#4a4a4a]">
        <div className="flex items-center space-x-3 mb-2">
          <div className="p-2 bg-[#34c4f2]/10 rounded-lg">
            <UploadCloud className="text-[#34c4f2] w-5 h-5" />
          </div>
          <h2 className="text-2xl font-bold text-[#1f1f1f] dark:text-white">AI Interview — Create Session</h2>
        </div>
        <p className="text-[#4a4a4a] dark:text-[#9f9f9f] text-sm leading-relaxed max-w-2xl">
          Upload the candidate&apos;s resume and the job description. We&apos;ll generate a
          private interview link and a one-time passcode you can share with the candidate.
        </p>
      </div>

      {sessionResult ? (
        <div className="p-8">
          <KeywordResults result={sessionResult} onReset={handleStartOver} />
        </div>
      ) : extractionResult ? (
        <div className="p-8 space-y-8">
          <div className="rounded-2xl bg-white dark:bg-[#2b2b2b] border border-[#d9d9d9] dark:border-[#4a4a4a] p-5 shadow-sm">
            <KeywordAnalysisOverview extraction={extractionResult} onReset={handleStartOver} />
          </div>
          <QuestionBankSelector
            extraction={extractionResult}
            onComplete={handleSessionComplete}
            onBack={() => setExtractionResult(null)}
          />
        </div>
      ) : (
      <form onSubmit={handleAnalyze} className="p-8 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input
            id="candidate-name"
            type="text"
            value={candidateName}
            onChange={(e) => setCandidateName(e.target.value)}
            placeholder="Candidate name (optional)"
            className="px-4 py-3 bg-zinc-50 dark:bg-[#1f1f1f] border border-[#d9d9d9] dark:border-[#4a4a4a] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#34c4f2] text-[#1f1f1f] dark:text-white placeholder-[#9f9f9f] text-sm"
          />
          <input
            id="candidate-email"
            type="email"
            value={candidateEmail}
            onChange={(e) => setCandidateEmail(e.target.value)}
            placeholder="Candidate email (optional)"
            className="px-4 py-3 bg-zinc-50 dark:bg-[#1f1f1f] border border-[#d9d9d9] dark:border-[#4a4a4a] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#34c4f2] text-[#1f1f1f] dark:text-white placeholder-[#9f9f9f] text-sm"
          />
          <input
            id="job-title"
            type="text"
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            placeholder="Job title (optional)"
            className="px-4 py-3 bg-zinc-50 dark:bg-[#1f1f1f] border border-[#d9d9d9] dark:border-[#4a4a4a] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#34c4f2] text-[#1f1f1f] dark:text-white placeholder-[#9f9f9f] text-sm"
          />
        </div>

        <label
          htmlFor="resume-upload"
          className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-[#d9d9d9] dark:border-[#4a4a4a] rounded-2xl cursor-pointer hover:border-[#34c4f2] hover:bg-[#34c4f2]/5 bg-zinc-50 dark:bg-[#1f1f1f] transition-all"
        >
          <FileText className="w-6 h-6 text-[#34c4f2]" />
          <span className="text-sm font-bold text-[#1f1f1f] dark:text-white">
            {resume ? resume.name : 'Upload Resume'}
          </span>
          <span className="text-[10px] uppercase tracking-widest text-[#4a4a4a] dark:text-[#9f9f9f]">
            PDF, DOC, DOCX, TXT — max 10 MB
          </span>
          <input
            id="resume-upload"
            type="file"
            accept=".pdf,.doc,.docx,.txt"
            className="hidden"
            onChange={(e) => {
              setResume(e.target.files?.[0] ?? null);
              clearSuccessState();
            }}
          />
        </label>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-widest text-[#4a4a4a] dark:text-[#9f9f9f]">
              Job Description
            </span>
            <div className="flex bg-zinc-100 dark:bg-[#1f1f1f] rounded-lg p-1">
              <button
                id="jd-mode-text"
                type="button"
                onClick={() => setJdMode('text')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
                  jdMode === 'text' ? 'bg-[#34c4f2] text-[#1f1f1f] shadow-sm' : 'text-[#4a4a4a] dark:text-[#9f9f9f]'
                }`}
              >
                <ClipboardPaste className="w-3.5 h-3.5" />
                Paste Text
              </button>
              <button
                id="jd-mode-file"
                type="button"
                onClick={() => setJdMode('file')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer ${
                  jdMode === 'file' ? 'bg-[#34c4f2] text-[#1f1f1f] shadow-sm' : 'text-[#4a4a4a] dark:text-[#9f9f9f]'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                Upload File
              </button>
            </div>
          </div>

          {jdMode === 'text' ? (
            <textarea
              id="jd-text"
              value={jdText}
              onChange={(e) => {
                setJdText(e.target.value);
                clearSuccessState();
              }}
              placeholder="Paste the job description here..."
              rows={6}
              maxLength={20000}
              className="w-full p-4 bg-zinc-50 dark:bg-[#1f1f1f] border border-[#d9d9d9] dark:border-[#4a4a4a] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#34c4f2] text-[#1f1f1f] dark:text-white placeholder-[#9f9f9f] text-sm resize-y"
            />
          ) : (
            <label
              htmlFor="jd-upload"
              className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-[#d9d9d9] dark:border-[#4a4a4a] rounded-2xl cursor-pointer hover:border-[#34c4f2] hover:bg-[#34c4f2]/5 bg-zinc-50 dark:bg-[#1f1f1f] transition-all"
            >
              <FileText className="w-6 h-6 text-[#34c4f2]" />
              <span className="text-sm font-bold text-[#1f1f1f] dark:text-white">
                {jd ? jd.name : 'Upload Job Description'}
              </span>
              <span className="text-[10px] uppercase tracking-widest text-[#4a4a4a] dark:text-[#9f9f9f]">
                PDF, DOC, DOCX, TXT — max 10 MB
              </span>
              <input
                id="jd-upload"
                type="file"
                accept=".pdf,.doc,.docx,.txt"
                className="hidden"
                onChange={(e) => {
                  setJd(e.target.files?.[0] ?? null);
                  clearSuccessState();
                }}
              />
            </label>
          )}
        </div>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-center space-x-2 p-4 text-sm text-red-600 bg-red-50 rounded-xl border border-red-100"
            >
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <p className="font-medium">{error}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Step 1 of 2 — analyzes the resume/JD, then hands off to the
            question-bank selection step above (rendered instead of this
            form once `extractionResult` is set). */}
        <button
          id="create-interview-submit"
          type="submit"
          disabled={submitting}
          className="w-full bg-[#34c4f2] hover:bg-[#2db0db] text-zinc-900 font-black py-5 rounded-2xl transition-all shadow-xl shadow-[#34c4f2]/30 flex items-center justify-center space-x-3 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed uppercase tracking-[0.2em] text-sm"
        >
          {submitting ? (
            <>
              <Loader2 className="w-6 h-6 animate-spin" />
              <span>{statusMessage || 'Working...'}</span>
            </>
          ) : (
            <>
              <UploadCloud className="w-5 h-5" />
              <span>Analyze Resume &amp; JD</span>
            </>
          )}
        </button>
      </form>
      )}

      <div className="p-8 bg-zinc-50/50 dark:bg-[#1f1f1f] border-t border-[#d9d9d9] dark:border-[#4a4a4a]">
        <h3 className="text-xs font-bold uppercase tracking-widest text-[#4a4a4a] dark:text-[#9f9f9f] mb-4">
          Recent Interviews
        </h3>
        {loadingList ? (
          <div className="flex justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-[#34c4f2]" />
          </div>
        ) : interviews.length === 0 ? (
          <p className="text-sm text-[#4a4a4a] dark:text-[#9f9f9f]">No interviews created yet.</p>
        ) : (
          <div className="space-y-2">
            {interviews.map((iv) => (
              <div
                key={iv.id}
                className="flex items-center justify-between bg-white dark:bg-[#2b2b2b] p-4 rounded-xl border border-[#d9d9d9] dark:border-[#4a4a4a] text-sm"
              >
                <div>
                  <button
                    id={`interview-row-name-${iv.id}`}
                    type="button"
                    onClick={() => void openInterview(iv)}
                    className="font-bold text-[#1f1f1f] dark:text-white hover:text-[#34c4f2] hover:underline text-left transition-colors cursor-pointer"
                  >
                    {iv.candidate_name || 'Unnamed candidate'}{' '}
                    {iv.job_title && <span className="text-[#4a4a4a] dark:text-[#9f9f9f] font-normal">— {iv.job_title}</span>}
                  </button>
                  <p className="text-[#4a4a4a] dark:text-[#9f9f9f] text-xs font-mono">
                    {iv.expires_at
                      ? `Expires ${new Date(iv.expires_at).toLocaleDateString()}`
                      : 'No link generated yet'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded border ${
                      STATUS_BADGE_STYLES[iv.status] ?? DEFAULT_STATUS_BADGE_STYLE
                    }`}
                  >
                    {iv.status.replace('_', ' ')}
                  </span>
                  {(iv.status === 'completed' || iv.status === 'terminated' || iv.status === 'revoked' || iv.status === 'cancelled' || iv.status === 'in_progress') && (
                    <Link
                      id={`view-report-${iv.id}`}
                      href={`/admin/reports/${iv.id}`}
                      className="px-3 py-1.5 bg-zinc-900 hover:bg-[#1689aa] text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-sm"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      View Report
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* LINK & PASSCODE POPUP — opened by clicking a candidate's name in Recent Interviews */}
      <AnimatePresence>
        {selectedInterview && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/50 px-4"
            onClick={closeInterviewModal}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              id="interview-link-modal"
              className="w-full max-w-md bg-white dark:bg-[#2b2b2b] rounded-2xl shadow-2xl border border-zinc-100 dark:border-[#4a4a4a] p-6 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-bold text-zinc-900 dark:text-white">
                    {selectedInterview.candidate_name || 'Unnamed candidate'}
                  </h3>
                  {selectedInterview.job_title && (
                    <p className="text-xs text-zinc-400 dark:text-[#9f9f9f]">{selectedInterview.job_title}</p>
                  )}
                </div>
                <button
                  id="interview-link-modal-close"
                  type="button"
                  onClick={closeInterviewModal}
                  className="p-1.5 text-zinc-400 dark:text-[#9f9f9f] hover:text-zinc-700 dark:hover:text-white rounded-lg hover:bg-zinc-100 dark:hover:bg-[#1f1f1f]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {inviteLoading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-zinc-400 dark:text-[#9f9f9f]">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating a fresh interview link...
                </div>
              ) : inviteError ? (
                <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 rounded-lg text-red-500 text-xs">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{inviteError}</span>
                </div>
              ) : selectedInvite ? (
                <>
                  <div className="flex items-center gap-2 bg-zinc-50 dark:bg-[#1f1f1f] rounded-lg border border-zinc-100 dark:border-[#4a4a4a] p-3">
                    <Link2 className="w-4 h-4 text-zinc-400 dark:text-[#9f9f9f] flex-shrink-0" />
                    <span className="flex-1 truncate text-zinc-700 dark:text-white font-mono text-xs">
                      {selectedInvite.link}
                    </span>
                    <button
                      id="interview-link-modal-copy-link"
                      type="button"
                      onClick={() => copyModalValue(selectedInvite.link, 'link')}
                      className="p-1.5 text-zinc-400 dark:text-[#9f9f9f] hover:text-[#34c4f2] flex-shrink-0"
                    >
                      {modalCopied === 'link' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>

                  <div className="flex items-center gap-2 bg-zinc-50 dark:bg-[#1f1f1f] rounded-lg border border-zinc-100 dark:border-[#4a4a4a] p-3">
                    <KeyRound className="w-4 h-4 text-zinc-400 dark:text-[#9f9f9f] flex-shrink-0" />
                    <span className="flex-1 font-mono text-lg font-black tracking-[0.3em] text-zinc-900 dark:text-white">
                      {selectedInvite.passcode}
                    </span>
                    <button
                      id="interview-link-modal-copy-code"
                      type="button"
                      onClick={() => copyModalValue(selectedInvite.passcode, 'code')}
                      className="p-1.5 text-zinc-400 dark:text-[#9f9f9f] hover:text-[#34c4f2] flex-shrink-0"
                    >
                      {modalCopied === 'code' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>

                  <p className="text-xs text-zinc-400 dark:text-[#9f9f9f]">
                    This passcode is only shown once — share it with the candidate now.
                  </p>
                </>
              ) : null}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
