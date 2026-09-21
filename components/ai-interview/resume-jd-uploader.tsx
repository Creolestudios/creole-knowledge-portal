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

      const res = await fetch('/api/ai-interview/extract', {
        method: 'POST',
        body: formData,
      });

      const extraction = await res.json();

      if (!res.ok) {
        throw new Error(extraction.error || 'Failed to extract keywords');
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
        <div className="bg-slate-900/60 backdrop-blur-md border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between transition-all hover:border-slate-700">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
                  <FileText className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-semibold text-slate-100">Candidate Resume</h3>
              </div>
              <div className="flex bg-slate-800/80 p-1 rounded-lg text-xs font-medium text-slate-400">
                <button
                  type="button"
                  onClick={() => setResumeMode('upload')}
                  className={`px-3 py-1 rounded-md transition-all ${
                    resumeMode === 'upload'
                      ? 'bg-blue-600 text-white shadow'
                      : 'hover:text-slate-200'
                  }`}
                >
                  File Upload
                </button>
                <button
                  type="button"
                  onClick={() => setResumeMode('text')}
                  className={`px-3 py-1 rounded-md transition-all ${
                    resumeMode === 'text'
                      ? 'bg-blue-600 text-white shadow'
                      : 'hover:text-slate-200'
                  }`}
                >
                  Paste Text
                </button>
              </div>
            </div>

            {resumeMode === 'upload' ? (
              <div className="mt-2">
                {resumeFile ? (
                  <div className="flex items-center justify-between p-4 bg-slate-800/50 border border-blue-500/30 rounded-xl">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <CheckCircle2 className="w-5 h-5 text-blue-400 shrink-0" />
                      <span className="text-sm font-medium text-slate-200 truncate">
                        {resumeFile.name}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setResumeFile(null)}
                      className="p-1 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-slate-200"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-slate-700 hover:border-blue-500/50 rounded-xl cursor-pointer bg-slate-950/40 hover:bg-slate-900/40 transition-all text-center">
                    <Upload className="w-8 h-8 text-blue-400 mb-2" />
                    <span className="text-sm font-medium text-slate-200">
                      Upload Resume (PDF, DOCX, TXT)
                    </span>
                    <span className="text-xs text-slate-500 mt-1">Maximum file size 10MB</span>
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
                className="w-full p-4 bg-slate-950/60 border border-slate-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 rounded-xl text-sm text-slate-200 placeholder-slate-500 outline-none transition-all resize-none"
              />
            )}
          </div>
        </div>

        {/* JOB DESCRIPTION CARD */}
        <div className="bg-slate-900/60 backdrop-blur-md border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between transition-all hover:border-slate-700">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                  <Sparkles className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-semibold text-slate-100">Job Description (JD)</h3>
              </div>
              <div className="flex bg-slate-800/80 p-1 rounded-lg text-xs font-medium text-slate-400">
                <button
                  type="button"
                  onClick={() => setJdMode('upload')}
                  className={`px-3 py-1 rounded-md transition-all ${
                    jdMode === 'upload'
                      ? 'bg-emerald-600 text-white shadow'
                      : 'hover:text-slate-200'
                  }`}
                >
                  File Upload
                </button>
                <button
                  type="button"
                  onClick={() => setJdMode('text')}
                  className={`px-3 py-1 rounded-md transition-all ${
                    jdMode === 'text'
                      ? 'bg-emerald-600 text-white shadow'
                      : 'hover:text-slate-200'
                  }`}
                >
                  Paste Text
                </button>
              </div>
            </div>

            {jdMode === 'upload' ? (
              <div className="mt-2">
                {jdFile ? (
                  <div className="flex items-center justify-between p-4 bg-slate-800/50 border border-emerald-500/30 rounded-xl">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                      <span className="text-sm font-medium text-slate-200 truncate">
                        {jdFile.name}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setJdFile(null)}
                      className="p-1 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-slate-200"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center p-8 border-2 border-dashed border-slate-700 hover:border-emerald-500/50 rounded-xl cursor-pointer bg-slate-950/40 hover:bg-slate-900/40 transition-all text-center">
                    <Upload className="w-8 h-8 text-emerald-400 mb-2" />
                    <span className="text-sm font-medium text-slate-200">
                      Upload Job Description (PDF, DOCX, TXT)
                    </span>
                    <span className="text-xs text-slate-500 mt-1">Maximum file size 10MB</span>
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
                className="w-full p-4 bg-slate-950/60 border border-slate-800 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 rounded-xl text-sm text-slate-200 placeholder-slate-500 outline-none transition-all resize-none"
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
          className="relative inline-flex items-center justify-center gap-3 px-8 py-3.5 bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-semibold rounded-xl shadow-lg shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 transform hover:-translate-y-0.5 active:translate-y-0"
        >
          {isLoading ? (
            <>
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              <span>{statusMessage || 'Working...'}</span>
            </>
          ) : (
            <>
              <Sparkles className="w-5 h-5 text-amber-300 animate-pulse" />
              <span>Analyze Resume & JD</span>
            </>
          )}
        </button>
        <p className="text-xs text-slate-500 text-center max-w-md">
          Extracts keywords and computes candidate-to-JD alignment. You&apos;ll pick the exact
          interview questions on the next step.
        </p>
      </div>
    </div>
  );
}
