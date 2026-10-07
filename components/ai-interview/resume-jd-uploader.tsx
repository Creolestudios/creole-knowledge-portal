'use client';

import React, { useState } from 'react';
import { Upload, FileText, Sparkles, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { ExtractionResult } from '@/lib/ai-interview/types';

interface ResumeJDUploaderProps {
  onExtracted: (data: ExtractionResult) => void;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
}

export function ResumeJDUploader({
  onExtracted,
  isLoading,
  setIsLoading,
}: ResumeJDUploaderProps) {
  const [resumeMode, setResumeMode] = useState<'upload' | 'text'>('upload');
  const [jdMode, setJdMode] = useState<'upload' | 'text'>('upload');

  const [resumeText, setResumeText] = useState('');
  const [jdText, setJdText] = useState('');

  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [jdFile, setJdFile] = useState<File | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const handleResumeFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setResumeFile(e.target.files[0]);
      setError(null);
    }
  };

  const handleJdFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setJdFile(e.target.files[0]);
      setError(null);
    }
  };

  const handleExtractKeywords = async () => {
    setError(null);
    setStatusMessage(null);

    const hasResume = (resumeMode === 'upload' && resumeFile) || (resumeMode === 'text' && resumeText.trim());
    const hasJd = (jdMode === 'upload' && jdFile) || (jdMode === 'text' && jdText.trim());

    if (!hasResume || !hasJd) {
      setError('Please provide both a Resume (file or text) and a Job Description (file or text).');
      return;
    }

    setIsLoading(true);

    try {
      setStatusMessage('Extracting resume & JD keywords with AI...');

      const formData = new FormData();
      if (resumeMode === 'text' && resumeText.trim()) {
        formData.append('resumeText', resumeText.trim());
      } else if (resumeFile) {
        formData.append('resumeFile', resumeFile);
      }

      if (jdMode === 'text' && jdText.trim()) {
        formData.append('jdText', jdText.trim());
      } else if (jdFile) {
        formData.append('jdFile', jdFile);
      }

      let res: Response;
      try {
        res = await fetch('/api/ai-interview/extract', {
          method: 'POST',
          body: formData,
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === 'Failed to fetch' || msg.includes('fetch')) {
          throw new Error('Network connection error: Failed to reach server. Please verify your connection or server status and try again.');
        }
        throw e;
      }

      const extraction = await res.json().catch(() => null);

      if (!res.ok || !extraction) {
        throw new Error(extraction?.error || `Failed to extract keywords (${res.status || 'Server error'}).`);
      }

      setStatusMessage(null);
      onExtracted(extraction);
    } catch (err: unknown) {
      setStatusMessage(null);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full space-y-6">
      {error && (
        <div
          id="resume-jd-uploader-error"
          className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm animate-in fade-in"
        >
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* RESUME CARD */}
        <div className="bg-white dark:bg-[#2b2b2b] border border-[#d9d9d9] dark:border-[#4a4a4a] rounded-2xl p-6 shadow-sm flex flex-col justify-between transition-all hover:border-[#34c4f2]/50">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-[#34c4f2]/10 text-[#34c4f2]">
                  <FileText className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-bold text-[#1f1f1f] dark:text-white">Candidate Resume</h3>
              </div>
              <div className="flex bg-zinc-100 dark:bg-[#2b2b2b] dark:bg-[#1f1f1f] p-1 rounded-lg text-xs font-medium text-[#4a4a4a] dark:text-[#9f9f9f]">
                <button
                  type="button"
                  onClick={() => setResumeMode('upload')}
                  className={`px-3 py-1 rounded-md transition-all ${
                    resumeMode === 'upload'
                      ? 'bg-[#34c4f2] text-[#1f1f1f] font-bold shadow'
                      : 'hover:text-[#1f1f1f] dark:hover:text-white'
                  }`}
                >
                  File Upload
                </button>
                <button
                  type="button"
                  onClick={() => setResumeMode('text')}
                  className={`px-3 py-1 rounded-md transition-all ${
                    resumeMode === 'text'
                      ? 'bg-[#34c4f2] text-[#1f1f1f] font-bold shadow'
                      : 'hover:text-[#1f1f1f] dark:hover:text-white'
                  }`}
                >
                  Paste Text
                </button>
              </div>
            </div>

            {resumeMode === 'upload' ? (
              <div className="mt-2">
                {resumeFile ? (
                  <div className="flex items-center justify-between p-4 bg-[#34c4f2]/10 border border-[#34c4f2]/30 rounded-xl">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <CheckCircle2 className="w-5 h-5 text-[#34c4f2] shrink-0" />
                      <span className="text-sm font-medium text-[#1f1f1f] dark:text-white truncate">
                        {resumeFile.name}
                      </span>
                    </div>
                    <button
                  type="button"
                  onClick={() => setResumeFile(null)}
                  className="p-1 hover:bg-zinc-200 dark:hover:bg-[#4a4a4a] rounded-lg text-[#4a4a4a] dark:text-[#9f9f9f] hover:text-[#1f1f1f] dark:hover:text-white"
                >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-[#d9d9d9] dark:border-[#4a4a4a] hover:border-[#34c4f2] rounded-xl cursor-pointer bg-zinc-50 dark:bg-[#1f1f1f] hover:bg-[#34c4f2]/5 transition-all text-center">
                    <Upload className="w-8 h-8 text-[#34c4f2] mb-2" />
                    <span className="text-sm font-semibold text-[#1f1f1f] dark:text-white">
                      Upload Resume (PDF, DOCX, TXT)
                    </span>
                    <span className="text-xs text-[#4a4a4a] dark:text-[#9f9f9f] mt-1">Maximum file size 10MB</span>
                    <input
                      type="file"
                      accept=".pdf,.docx,.txt,.md"
                      onChange={handleResumeFileChange}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            ) : (
              <textarea
                value={resumeText}
                onChange={(e) => setResumeText(e.target.value)}
                placeholder="Paste candidate resume text here..."
                rows={6}
                className="w-full p-4 bg-white dark:bg-[#2b2b2b] dark:bg-[#1f1f1f] border border-[#d9d9d9] dark:border-[#4a4a4a] focus:border-[#34c4f2] focus:ring-1 focus:ring-[#34c4f2] rounded-xl text-sm text-[#1f1f1f] dark:text-white placeholder-[#9f9f9f] outline-none transition-all resize-none"
              />
            )}
          </div>
        </div>

        {/* JOB DESCRIPTION CARD */}
        <div className="bg-white dark:bg-[#2b2b2b] border border-[#d9d9d9] dark:border-[#4a4a4a] rounded-2xl p-6 shadow-sm flex flex-col justify-between transition-all hover:border-[#34c4f2]/50">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-[#34c4f2]/10 text-[#34c4f2]">
                  <Sparkles className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-bold text-[#1f1f1f] dark:text-white">Job Description (JD)</h3>
              </div>
              <div className="flex bg-zinc-100 dark:bg-[#2b2b2b] dark:bg-[#1f1f1f] p-1 rounded-lg text-xs font-medium text-[#4a4a4a] dark:text-[#9f9f9f]">
                <button
                  type="button"
                  onClick={() => setJdMode('upload')}
                  className={`px-3 py-1 rounded-md transition-all ${
                    jdMode === 'upload'
                      ? 'bg-[#34c4f2] text-[#1f1f1f] font-bold shadow'
                      : 'hover:text-[#1f1f1f] dark:hover:text-white'
                  }`}
                >
                  File Upload
                </button>
                <button
                  type="button"
                  onClick={() => setJdMode('text')}
                  className={`px-3 py-1 rounded-md transition-all ${
                    jdMode === 'text'
                      ? 'bg-[#34c4f2] text-[#1f1f1f] font-bold shadow'
                      : 'hover:text-[#1f1f1f] dark:hover:text-white'
                  }`}
                >
                  Paste Text
                </button>
              </div>
            </div>

            {jdMode === 'upload' ? (
              <div className="mt-2">
                {jdFile ? (
                  <div className="flex items-center justify-between p-4 bg-[#34c4f2]/10 border border-[#34c4f2]/30 rounded-xl">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <CheckCircle2 className="w-5 h-5 text-[#34c4f2] shrink-0" />
                      <span className="text-sm font-medium text-[#1f1f1f] dark:text-white truncate">
                        {jdFile.name}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setJdFile(null)}
                      className="p-1 hover:bg-zinc-200 dark:hover:bg-[#4a4a4a] rounded-lg text-[#4a4a4a] dark:text-[#9f9f9f] hover:text-[#1f1f1f] dark:hover:text-white"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-[#d9d9d9] dark:border-[#4a4a4a] hover:border-[#34c4f2] rounded-xl cursor-pointer bg-zinc-50 dark:bg-[#1f1f1f] hover:bg-[#34c4f2]/5 transition-all text-center">
                    <Upload className="w-8 h-8 text-[#34c4f2] mb-2" />
                    <span className="text-sm font-semibold text-[#1f1f1f] dark:text-white">
                      Upload Job Description (PDF, DOCX, TXT)
                    </span>
                    <span className="text-xs text-[#4a4a4a] dark:text-[#9f9f9f] mt-1">Maximum file size 10MB</span>
                    <input
                      type="file"
                      accept=".pdf,.docx,.txt,.md"
                      onChange={handleJdFileChange}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            ) : (
              <textarea
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                placeholder="Paste Job Description requirement text here..."
                rows={6}
                className="w-full p-4 bg-white dark:bg-[#2b2b2b] dark:bg-[#1f1f1f] border border-[#d9d9d9] dark:border-[#4a4a4a] focus:border-[#34c4f2] focus:ring-1 focus:ring-[#34c4f2] rounded-xl text-sm text-[#1f1f1f] dark:text-white placeholder-[#9f9f9f] outline-none transition-all resize-none"
              />
            )}
          </div>
        </div>
      </div>

      {/* ACTION BUTTON — extracts keywords, then hands off to the question-selection step */}
      <div className="flex flex-col items-center gap-3 pt-2">
        <button
          id="resume-jd-uploader-extract"
          type="button"
          onClick={handleExtractKeywords}
          disabled={isLoading}
          className="relative inline-flex items-center justify-center gap-3 px-8 py-3.5 bg-[#34c4f2] hover:bg-[#2db0db] text-[#1f1f1f] font-black rounded-xl shadow-lg shadow-[#34c4f2]/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 transform hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
        >
          {isLoading ? (
            <>
              <div className="w-5 h-5 border-2 border-[#1f1f1f]/30 border-t-[#1f1f1f] rounded-full animate-spin" />
              <span>{statusMessage || 'Working...'}</span>
            </>
          ) : (
            <>
              <Sparkles className="w-5 h-5 text-[#1f1f1f]" />
              <span>Analyze Resume & JD</span>
            </>
          )}
        </button>
        <p className="text-xs text-[#4a4a4a] dark:text-[#9f9f9f] text-center max-w-md">
          Extracts keywords and computes candidate-to-JD alignment. You&apos;ll pick the exact
          interview questions on the next step.
        </p>
      </div>
    </div>
  );
}
