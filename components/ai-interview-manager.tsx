'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  UploadCloud,
  FileText,
  Sparkles,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Copy,
  Check,
  KeyRound,
  Link2,
  ClipboardPaste,
} from 'lucide-react';
import type { IInterviewSummary, ICreatedInterview } from '@/lib/ai-interview/types';
import type { ExtractionResult } from '@/lib/ai-interview/types';
import { KeywordResults } from '@/components/ai-interview/keyword-results';

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
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ICreatedInterview | null>(null);
  const [copied, setCopied] = useState<'link' | 'code' | null>(null);
  const [extractionResult, setExtractionResult] = useState<ExtractionResult | null>(null);
  const [selectedQuestions, setSelectedQuestions] = useState<any[]>([]);
  const [selectedDurationMinutes, setSelectedDurationMinutes] = useState<number | null>(null);
  const [extracting, setExtracting] = useState(false);

  const [interviews, setInterviews] = useState<IInterviewSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCreated(null);

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
    if (!selectedQuestions.length || !selectedDurationMinutes) {
      setError('Please analyze the resume and JD, select the interview questions, and set the duration before generating the link.');
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append('resume', resume);
      if (jdMode === 'file' && jd) {
        form.append('jd', jd);
      } else {
        form.append('jdText', jdText.trim());
      }
      if (candidateName) form.append('candidateName', candidateName);
      if (candidateEmail) form.append('candidateEmail', candidateEmail);
      if (jobTitle) form.append('jobTitle', jobTitle);

      const res = await fetch('/api/admin/ai-interviews', { method: 'POST', body: form });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? 'Failed to create interview.');
        return;
      }

      setCreated(json);
      setCandidateName('');
      setCandidateEmail('');
      setJobTitle('');
      setResume(null);
      setJd(null);
      setJdText('');
      if (selectedQuestions.length > 0) {
        const questionsResponse = await fetch(`/api/interview/${json.interviewId}/questions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            questions: selectedQuestions,
            durationMinutes: selectedDurationMinutes,
            questionCount: selectedQuestions.length,
            extraction: extractionResult,
          }),
        });
        if (!questionsResponse.ok) {
          setError('Interview link created, but questions could not be assigned.');
        }
      }
      fetchInterviews();
    } catch (err) {
      console.error('[ai-interview-manager] submit failed:', err);
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleExtract = async () => {
    setError(null);
    if (!resume) {
      setError('Please attach a resume before analyzing.');
      return;
    }
    if (jdMode === 'file' && !jd) {
      setError('Please attach a job description file before analyzing.');
      return;
    }
    if (jdMode === 'text' && !jdText.trim()) {
      setError('Please paste the job description text before analyzing.');
      return;
    }

    setExtracting(true);
    try {
      const form = new FormData();
      form.append('resumeFile', resume);
      if (jdMode === 'file' && jd) form.append('jdFile', jd);
      else form.append('jdText', jdText.trim());

      const res = await fetch('/api/ai-interview/extract', { method: 'POST', body: form });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Failed to analyze resume and job description.');
        return;
      }
      setExtractionResult(json);
    } catch (err) {
      console.error('[ai-interview-manager] extraction failed:', err);
      setError('Something went wrong while analyzing the resume and job description.');
    } finally {
      setExtracting(false);
    }
  };

  const copyToClipboard = async (value: string, kind: 'link' | 'code') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch (err) {
      console.error('[ai-interview-manager] copy failed:', err);
    }
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

      <form onSubmit={handleSubmit} className="p-8 space-y-6">
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
            onChange={(e) => setResume(e.target.files?.[0] ?? null)}
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
              onChange={(e) => setJdText(e.target.value)}
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
                onChange={(e) => setJd(e.target.files?.[0] ?? null)}
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

          {created && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="p-5 space-y-3 text-sm bg-emerald-50 rounded-xl border border-emerald-100"
            >
              <div className="flex items-center space-x-2 text-emerald-700 font-bold">
                <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                <span>Interview created — share these with the candidate</span>
              </div>

              <div className="flex items-center gap-2 bg-white rounded-lg border border-emerald-200 p-3">
                <Link2 className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                <span id="interview-link" className="flex-1 truncate text-zinc-700 font-mono text-xs">
                  {created.link}
                </span>
                <button
                  id="copy-interview-link"
                  type="button"
                  onClick={() => copyToClipboard(created.link, 'link')}
                  className="p-1.5 text-zinc-400 hover:text-[#34c4f2] flex-shrink-0"
                >
                  {copied === 'link' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>

              <div className="flex items-center gap-2 bg-white rounded-lg border border-emerald-200 p-3">
                <KeyRound className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                <span id="interview-passcode" className="flex-1 font-mono text-lg font-black tracking-[0.3em] text-zinc-900">
                  {created.accessCode}
                </span>
                <button
                  id="copy-interview-code"
                  type="button"
                  onClick={() => copyToClipboard(created.accessCode, 'code')}
                  className="p-1.5 text-zinc-400 hover:text-[#34c4f2] flex-shrink-0"
                >
                  {copied === 'code' ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <button
          id="analyze-interview-documents"
          type="button"
          onClick={handleExtract}
          disabled={extracting || submitting}
          className="w-full border-2 border-dashed border-[#34c4f2]/40 hover:border-[#34c4f2] text-[#1689aa] font-bold py-4 rounded-2xl transition-all flex items-center justify-center space-x-3 disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {extracting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
          <span>{extracting ? 'Analyzing Resume & JD...' : 'Extract Keywords & Analyze Alignment'}</span>
        </button>

        {extractionResult && (
          <div className="rounded-2xl bg-slate-950 p-5">
            <KeywordResults
              result={extractionResult}
              onReset={() => {
                setExtractionResult(null);
                setSelectedQuestions([]);
                setSelectedDurationMinutes(null);
              }}
              onQuestionsGenerated={(questions, duration) => {
                setSelectedQuestions(questions);
                setSelectedDurationMinutes(duration);
              }}
            />
          </div>
        )}

        <button
          id="create-interview-submit"
          type="submit"
          disabled={submitting}
          className="w-full bg-[#34c4f2] hover:bg-[#2db0db] text-zinc-900 font-black py-5 rounded-2xl transition-all shadow-xl shadow-[#34c4f2]/30 flex items-center justify-center space-x-3 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed uppercase tracking-[0.2em] text-sm"
        >
          {submitting ? (
            <Loader2 className="w-6 h-6 animate-spin" />
          ) : (
            <>
              <UploadCloud className="w-5 h-5" />
              <span>Generate Interview Link</span>
            </>
          )}
        </button>
      </form>

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
                  <p className="font-bold text-zinc-800">
                    {iv.candidate_name || 'Unnamed candidate'}{' '}
                    {iv.job_title && <span className="text-zinc-400 font-normal">— {iv.job_title}</span>}
                  </p>
                  <p className="text-zinc-400 text-xs font-mono">
                    Code: {iv.access_code} · Expires {new Date(iv.expires_at).toLocaleDateString()}
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
    </div>
  );
}
