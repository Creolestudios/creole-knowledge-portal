'use client';

import React, { useState } from 'react';
import { Sparkles, FileSearch, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { ResumeJDUploader } from '@/components/ai-interview/resume-jd-uploader';
import { QuestionBankSelector } from '@/components/ai-interview/question-bank-selector';
import { KeywordAnalysisOverview, KeywordResults } from '@/components/ai-interview/keyword-results';
import { ExtractionResult, SessionGenerationResult } from '@/lib/ai-interview/types';

export default function AIInterviewExtractorPage() {
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null);
  const [result, setResult] = useState<SessionGenerationResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 md:p-10 font-sans selection:bg-blue-500 selection:text-white">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* HEADER NAV & TITLE */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-800/80 pb-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-blue-400 mb-2">
              <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
              <span>AI Interview Module</span>
            </div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">
              Resume & Job Description Keyword Extractor
            </h1>
            <p className="text-sm text-slate-400 mt-1 max-w-2xl">
              Upload candidate resumes and job descriptions to instantly extract core technical keywords, compute candidate-to-JD alignment, and pinpoint skill gaps.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/ai-interview/sessions"
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 text-sm font-medium rounded-xl border border-slate-800 transition-all"
            >
              <span>View Sessions</span>
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 text-sm font-medium rounded-xl border border-slate-800 transition-all"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Dashboard</span>
            </Link>
          </div>
        </div>

        {/* MAIN BODY CONTENT */}
        {result ? (
          <KeywordResults
            result={result}
            onReset={() => {
              setResult(null);
              setExtraction(null);
            }}
          />
        ) : extraction ? (
          <div className="space-y-8">
            <KeywordAnalysisOverview extraction={extraction} onReset={() => setExtraction(null)} />
            <QuestionBankSelector
              extraction={extraction}
              onComplete={setResult}
              onBack={() => setExtraction(null)}
            />
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center gap-3 p-4 bg-blue-500/5 border border-blue-500/20 rounded-2xl">
              <FileSearch className="w-5 h-5 text-blue-400 shrink-0" />
              <p className="text-xs text-slate-300">
                Upload or paste both the candidate resume and Job Description (JD) below, then click
                &quot;Analyze Resume &amp; JD&quot; — Gemini AI will analyze keyword matches and skill
                gaps. You&apos;ll then pick the exact interview questions and generate the
                candidate&apos;s interview link and passcode.
              </p>
            </div>

            <ResumeJDUploader
              onExtracted={setExtraction}
              isLoading={isLoading}
              setIsLoading={setIsLoading}
            />
          </div>
        )}
      </div>
    </div>
  );
}
