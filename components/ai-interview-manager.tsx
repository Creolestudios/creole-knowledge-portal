'use client';

import { useState, useEffect, useCallback } from 'react';
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
import type { IInterviewSummary } from '@/lib/ai-interview/types';
import type { ExtractionResult, SessionGenerationResult } from '@/lib/ai-interview/types';
import { KeywordAnalysisOverview, KeywordResults } from '@/components/ai-interview/keyword-results';
import { QuestionBankSelector } from '@/components/ai-interview/question-bank-selector';

const STATUS_BADGE_STYLES: Record<string, string> = {
  completed: 'bg-emerald-50 text-emerald-600 border-emerald-100',
  expired: 'bg-red-50 text-red-500 border-red-100',
};
const DEFAULT_STATUS_BADGE_STYLE = 'bg-zinc-50 text-zinc-500 border-zinc-100';

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

  const fetchInterviews = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/ai-interviews');
      const json = await res.json();
      if (res.ok) setInterviews(json.interviews ?? []);
    } catch (err) {
      console.error('[ai-interview-manager] failed to load interviews:', err);
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchInterviews();
    }, 0);
    return () => clearTimeout(timer);
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

      const extractRes = await fetch('/api/ai-interview/extract', { method: 'POST', body: extractForm });
      const extractJson = await extractRes.json();
      if (!extractRes.ok) {
        throw new Error(extractJson.error ?? 'Failed to analyze resume and job description.');
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
    <div className="bg-white rounded-2xl shadow-card border border-zinc-100 overflow-hidden">
      <div className="p-8 border-b border-zinc-50">
        <div className="flex items-center space-x-3 mb-2">
          <div className="p-2 bg-[#34c4f2]/10 rounded-lg">
            <UploadCloud className="text-[#34c4f2] w-5 h-5" />
          </div>
          <h2 className="text-2xl font-bold text-zinc-900">AI Interview — Create Session</h2>
        </div>
        <p className="text-zinc-500 text-sm leading-relaxed max-w-2xl">
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
          <div className="rounded-2xl bg-slate-950 p-5">
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
            className="px-4 py-3 bg-zinc-50 border border-zinc-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#34c4f2] text-zinc-900 text-sm"
          />
          <input
            id="candidate-email"
            type="email"
            value={candidateEmail}
            onChange={(e) => setCandidateEmail(e.target.value)}
            placeholder="Candidate email (optional)"
            className="px-4 py-3 bg-zinc-50 border border-zinc-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#34c4f2] text-zinc-900 text-sm"
          />
          <input
            id="job-title"
            type="text"
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            placeholder="Job title (optional)"
            className="px-4 py-3 bg-zinc-50 border border-zinc-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#34c4f2] text-zinc-900 text-sm"
          />
        </div>

        <label
          htmlFor="resume-upload"
          className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-zinc-200 rounded-2xl cursor-pointer hover:border-[#34c4f2]/40 hover:bg-[#34c4f2]/5 transition-all"
        >
          <FileText className="w-6 h-6 text-zinc-400" />
          <span className="text-sm font-bold text-zinc-700">
            {resume ? resume.name : 'Upload Resume'}
          </span>
          <span className="text-[10px] uppercase tracking-widest text-zinc-400">
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
            <span className="text-xs font-bold uppercase tracking-widest text-zinc-400">
              Job Description
            </span>
            <div className="flex bg-zinc-100 rounded-lg p-1">
              <button
                id="jd-mode-text"
                type="button"
                onClick={() => setJdMode('text')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                  jdMode === 'text' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'
                }`}
              >
                <ClipboardPaste className="w-3.5 h-3.5" />
                Paste Text
              </button>
              <button
                id="jd-mode-file"
                type="button"
                onClick={() => setJdMode('file')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                  jdMode === 'file' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'
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
              className="w-full p-4 bg-zinc-50 border border-zinc-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#34c4f2] text-zinc-900 text-sm resize-y"
            />
          ) : (
            <label
              htmlFor="jd-upload"
              className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-zinc-200 rounded-2xl cursor-pointer hover:border-[#34c4f2]/40 hover:bg-[#34c4f2]/5 transition-all"
            >
              <FileText className="w-6 h-6 text-zinc-400" />
              <span className="text-sm font-bold text-zinc-700">
                {jd ? jd.name : 'Upload Job Description'}
              </span>
              <span className="text-[10px] uppercase tracking-widest text-zinc-400">
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

      <div className="p-8 bg-zinc-50/50 border-t border-zinc-100">
        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400 mb-4">
          Recent Interviews
        </h3>
        {loadingList ? (
          <div className="flex justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-zinc-300" />
          </div>
        ) : interviews.length === 0 ? (
          <p className="text-sm text-zinc-400">No interviews created yet.</p>
        ) : (
          <div className="space-y-2">
            {interviews.map((iv) => (
              <div
                key={iv.id}
                className="flex items-center justify-between bg-white p-4 rounded-xl border border-zinc-100 text-sm"
              >
                <div>
                  <button
                    id={`interview-row-name-${iv.id}`}
                    type="button"
                    onClick={() => void openInterview(iv)}
                    className="font-bold text-zinc-800 hover:text-[#34c4f2] hover:underline text-left transition-colors"
                  >
                    {iv.candidate_name || 'Unnamed candidate'}{' '}
                    {iv.job_title && <span className="text-zinc-400 font-normal">— {iv.job_title}</span>}
                  </button>
                  <p className="text-zinc-400 text-xs font-mono">
                    {iv.expires_at
                      ? `Expires ${new Date(iv.expires_at).toLocaleDateString()}`
                      : 'No link generated yet'}
                  </p>
                </div>
                <span
                  className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded border ${
                    STATUS_BADGE_STYLES[iv.status] ?? DEFAULT_STATUS_BADGE_STYLE
                  }`}
                >
                  {iv.status}
                </span>
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
              className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-zinc-100 p-6 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-bold text-zinc-900">
                    {selectedInterview.candidate_name || 'Unnamed candidate'}
                  </h3>
                  {selectedInterview.job_title && (
                    <p className="text-xs text-zinc-400">{selectedInterview.job_title}</p>
                  )}
                </div>
                <button
                  id="interview-link-modal-close"
                  type="button"
                  onClick={closeInterviewModal}
                  className="p-1.5 text-zinc-400 hover:text-zinc-700 rounded-lg hover:bg-zinc-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {inviteLoading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-zinc-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating a fresh interview link...
                </div>
              ) : inviteError ? (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-red-500 text-xs">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{inviteError}</span>
                </div>
              ) : selectedInvite ? (
                <>
                  <div className="flex items-center gap-2 bg-zinc-50 rounded-lg border border-zinc-100 p-3">
                    <Link2 className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                    <span className="flex-1 truncate text-zinc-700 font-mono text-xs">
                      {selectedInvite.link}
                    </span>
                    <button
                      id="interview-link-modal-copy-link"
                      type="button"
                      onClick={() => copyModalValue(selectedInvite.link, 'link')}
                      className="p-1.5 text-zinc-400 hover:text-[#34c4f2] flex-shrink-0"
                    >
                      {modalCopied === 'link' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>

                  <div className="flex items-center gap-2 bg-zinc-50 rounded-lg border border-zinc-100 p-3">
                    <KeyRound className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                    <span className="flex-1 font-mono text-lg font-black tracking-[0.3em] text-zinc-900">
                      {selectedInvite.passcode}
                    </span>
                    <button
                      id="interview-link-modal-copy-code"
                      type="button"
                      onClick={() => copyModalValue(selectedInvite.passcode, 'code')}
                      className="p-1.5 text-zinc-400 hover:text-[#34c4f2] flex-shrink-0"
                    >
                      {modalCopied === 'code' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>

                  <p className="text-xs text-zinc-400">
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
