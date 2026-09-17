'use client';

import React, { useCallback, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Award,
  BookOpen,
  Briefcase,
  Copy,
  Check,
  Tag,
  AlertTriangle,
  ArrowRight,
  Sparkles,
} from 'lucide-react';

import { ExtractionResult } from '@/lib/ai-interview/types';

interface KeywordResultsProps {
  result: ExtractionResult;
  onReset: () => void;
}

export function KeywordResults({ result, onReset }: KeywordResultsProps) {
  const [copied, setCopied] = useState(false);
  const { candidateProfile, jdRequirements, analysis } = result;

  const matchPercentage = analysis.matchPercentage || 0;

  const getMatchColor = (pct: number) => {
    if (pct >= 75) return { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30' };
    if (pct >= 50) return { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30' };
    return { bg: 'bg-rose-500/10', text: 'text-rose-400', border: 'border-rose-500/30' };
  };

  const matchStyle = getMatchColor(matchPercentage);

  const handleCopyKeywords = () => {
    const summaryText = `
=== KEYWORD EXTRACTION & FIT REPORT ===
Candidate: ${candidateProfile.name || 'Anonymous'}
Job Title: ${jdRequirements.jobTitle || 'N/A'}
Match Score: ${matchPercentage}%

MATCHED KEYWORDS (${analysis.matchedKeywords.length}):
${analysis.matchedKeywords.join(', ')}

MISSING KEYWORDS (${analysis.missingKeywords.length}):
${analysis.missingKeywords.join(', ')}

RESUME ONLY KEYWORDS (${analysis.resumeOnlyKeywords.length}):
${analysis.resumeOnlyKeywords.join(', ')}

SKILL GAP SUMMARY:
${analysis.skillGapSummary}
`.trim();

    navigator.clipboard.writeText(summaryText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="w-full space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
      {/* HEADER BAR */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-6 bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-2xl shadow-xl">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-blue-400 bg-blue-500/10 px-2.5 py-1 rounded-full border border-blue-500/20">
              Extraction Complete
            </span>
            <span className="text-xs text-slate-500">
              Extracted at {new Date(result.extractedAt).toLocaleTimeString()}
            </span>
          </div>
          <h2 className="text-2xl font-bold text-slate-100 mt-2">Candidate & JD Skill Analysis</h2>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleCopyKeywords}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-xl border border-slate-700 transition-all"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-slate-400" />}
            <span>{copied ? 'Copied Report' : 'Copy Keywords'}</span>
          </button>
          <button
            type="button"
            onClick={onReset}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-xl shadow transition-all"
          >
            Analyze Another Pair
          </button>
        </div>
      </div>

      {/* OVERVIEW CARDS GRID */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* MATCH SCORE CARD */}
        <div className={`p-6 ${matchStyle.bg} border ${matchStyle.border} rounded-2xl flex flex-col justify-between`}>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Match Percentage</span>
            <div className="flex items-baseline gap-2 mt-2">
              <span className={`text-5xl font-extrabold ${matchStyle.text}`}>{matchPercentage}%</span>
              <span className="text-sm font-medium text-slate-400">JD Fit</span>
            </div>
          </div>
          <p className="text-xs text-slate-300 mt-4 leading-relaxed">
            {analysis.skillGapSummary || 'Analysis completed successfully.'}
          </p>
        </div>

        {/* CANDIDATE QUICK SUMMARY */}
        <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
              <Briefcase className="w-4 h-4 text-blue-400" />
              <span>Candidate Profile</span>
            </div>
            <h3 className="text-lg font-bold text-slate-100">{candidateProfile.name || 'Candidate'}</h3>
            <p className="text-xs text-slate-400 mt-1">
              Experience: {candidateProfile.yearsOfExperience ? `${candidateProfile.yearsOfExperience} years` : 'Not specified'}
            </p>
          </div>
          <p className="text-xs text-slate-400 line-clamp-3 mt-3 italic">
            &quot;{candidateProfile.summary || 'No summary extracted.'}&quot;
          </p>
        </div>

        {/* JD QUICK SUMMARY */}
        <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-2xl flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">
              <BookOpen className="w-4 h-4 text-emerald-400" />
              <span>Target Role</span>
            </div>
            <h3 className="text-lg font-bold text-slate-100">{jdRequirements.jobTitle || 'Target Position'}</h3>
            <p className="text-xs text-slate-400 mt-1">
              Seniority: {jdRequirements.seniorityLevel || 'Mid-Senior'} | Required Exp: {jdRequirements.requiredExperienceYears || 0}+ YOE
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {jdRequirements.mustHaveSkills.slice(0, 4).map((skill, idx) => (
              <span key={idx} className="text-[11px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-md border border-slate-700">
                {skill}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* KEYWORD TAXONOMY BREAKDOWN */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* MATCHED KEYWORDS */}
        <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-2xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-semibold text-slate-100">Matched Keywords ({analysis.matchedKeywords.length})</h3>
            </div>
            <span className="text-xs text-emerald-400 font-medium bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20">
              Present in Resume & JD
            </span>
          </div>

          {analysis.matchedKeywords.length === 0 ? (
            <p className="text-xs text-slate-500 italic">No direct keyword overlaps detected.</p>
          ) : (
            <div className="flex flex-wrap gap-2 pt-2">
              {analysis.matchedKeywords.map((kw, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-medium"
                >
                  <Tag className="w-3 h-3 text-emerald-400" />
                  {kw}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* MISSING / GAP KEYWORDS */}
        <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-2xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400">
                <XCircle className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-semibold text-slate-100">Missing / Skill Gaps ({analysis.missingKeywords.length})</h3>
            </div>
            <span className="text-xs text-rose-400 font-medium bg-rose-500/10 px-2.5 py-1 rounded-full border border-rose-500/20">
              Required in JD
            </span>
          </div>

          {analysis.missingKeywords.length === 0 ? (
            <p className="text-xs text-slate-500 italic">No missing keywords found! Exceptional coverage.</p>
          ) : (
            <div className="flex flex-wrap gap-2 pt-2">
              {analysis.missingKeywords.map((kw, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs font-medium"
                >
                  <AlertTriangle className="w-3 h-3 text-rose-400" />
                  {kw}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* RESUME-ONLY & STRENGTHS DETAILED LIST */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* RESUME-ONLY STRENGTHS */}
        <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-2xl space-y-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
              <Award className="w-5 h-5" />
            </div>
            <h3 className="text-lg font-semibold text-slate-100">
              Additional Candidate Strengths ({analysis.resumeOnlyKeywords.length})
            </h3>
          </div>
          <p className="text-xs text-slate-400">Skills present in resume that provide extra value beyond the JD.</p>

          <div className="flex flex-wrap gap-2 pt-2">
            {analysis.resumeOnlyKeywords.map((kw, idx) => (
              <span
                key={idx}
                className="px-3 py-1.5 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs font-medium"
              >
                {kw}
              </span>
            ))}
          </div>
        </div>

        {/* KEY STRENGTHS & IMPROVEMENTS */}
        <div className="p-6 bg-slate-900/60 border border-slate-800 rounded-2xl space-y-4">
          <h3 className="text-lg font-semibold text-slate-100">AI Evaluation & Recommendations</h3>
          
          <div className="space-y-3">
            <div>
              <h4 className="text-xs font-semibold uppercase text-emerald-400 tracking-wider mb-1">Key Strengths</h4>
              <ul className="space-y-1">
                {analysis.keyStrengths.map((str, idx) => (
                  <li key={idx} className="flex items-center gap-2 text-xs text-slate-300">
                    <ArrowRight className="w-3 h-3 text-emerald-400 shrink-0" />
                    <span>{str}</span>
                  </li>
                ))}
              </ul>
            </div>

            {analysis.improvementAreas.length > 0 && (
              <div className="pt-2 border-t border-slate-800">
                <h4 className="text-xs font-semibold uppercase text-amber-400 tracking-wider mb-1">Recommended Interview Focus Areas</h4>
                <ul className="space-y-1">
                  {analysis.improvementAreas.map((area, idx) => (
                    <li key={idx} className="flex items-center gap-2 text-xs text-slate-300">
                      <ArrowRight className="w-3 h-3 text-amber-400 shrink-0" />
                      <span>{area}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* GENERATED HR INTERVIEW QUESTIONS SECTION */}
      <GeneratedQuestionsSection result={result} />
    </div>
  );
}

function GeneratedQuestionsSection({ result }: { result: ExtractionResult }) {
  const [durationMinutes, setDurationMinutes] = useState<number>(30);
  const [questions, setQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [copiedQuestions, setCopiedQuestions] = useState<boolean>(false);

  const durationOptions = [15, 20, 30, 45, 60];

  const handleGenerateQuestions = useCallback(async (duration: number) => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai-interview/generate-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateProfile: result.candidateProfile,
          jdRequirements: result.jdRequirements,
          analysis: result.analysis,
          durationMinutes: duration,
        }),
      });

      const data = await res.json();
      if (res.ok && Array.isArray(data.questions)) {
        setQuestions(data.questions);
      }
    } catch (err) {
      console.error('Failed to generate HR questions:', err);
    } finally {
      setLoading(false);
    }
  }, [result.analysis, result.candidateProfile, result.jdRequirements]);

  React.useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void handleGenerateQuestions(30);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [handleGenerateQuestions]);

  const handleCopyQuestionsText = () => {
    if (!questions.length) return;
    const formatted = questions
      .map(
        (q, idx) =>
          `Q${idx + 1} [${q.category.toUpperCase()} - ${Math.round(q.time_limit_sec / 60)}m]: ${q.question_text}\n   Intent: ${q.intent || 'N/A'}`
      )
      .join('\n\n');

    navigator.clipboard.writeText(
      `=== GENERATED HR INTERVIEW QUESTIONS (${questions.length} Questions - ${durationMinutes} Mins) ===\n\n${formatted}`
    );
    setCopiedQuestions(true);
    setTimeout(() => setCopiedQuestions(false), 2000);
  };

  return (
    <div className="p-6 bg-slate-900/80 border border-slate-800 rounded-2xl space-y-6 shadow-xl">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-purple-400 bg-purple-500/10 px-2.5 py-1 rounded-full border border-purple-500/20 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              AI HR Question Generator
            </span>
            <span className="text-xs text-slate-400">Min 10 Questions Floor Enforced</span>
          </div>
          <h3 className="text-xl font-bold text-slate-100 mt-2">
            Generated HR Interview Questions ({questions.length})
          </h3>
        </div>

        <div className="flex items-center gap-3">
          {questions.length > 0 && (
            <button
              type="button"
              onClick={handleCopyQuestionsText}
              className="flex items-center gap-2 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl border border-slate-700 transition-all"
            >
              {copiedQuestions ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-slate-400" />}
              <span>{copiedQuestions ? 'Copied' : 'Copy All Questions'}</span>
            </button>
          )}
        </div>
      </div>

      {/* DURATION MINUTES SELECTOR BAR */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 bg-slate-950/60 rounded-xl border border-slate-800/80">
        <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
          <BookOpen className="w-4 h-4 text-indigo-400" />
          <span>Select Interview Duration (Meeting Minutes):</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {durationOptions.map((mins) => (
            <button
              key={mins}
              type="button"
              onClick={() => {
                setDurationMinutes(mins);
                handleGenerateQuestions(mins);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                durationMinutes === mins
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30 border border-indigo-500'
                  : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
              }`}
            >
              {mins} mins {mins === 30 ? '(Default)' : ''}
            </button>
          ))}
        </div>
      </div>

      {/* QUESTIONS CARDS LIST */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-12 space-y-3">
          <div className="w-8 h-8 border-3 border-purple-500/30 border-t-purple-400 rounded-full animate-spin" />
          <p className="text-xs text-slate-400">Generating HR & Behavioral Interview Questions for {durationMinutes} mins...</p>
        </div>
      ) : questions.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-xs text-slate-500">No questions generated yet. Click generate above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {questions.map((q, idx) => (
            <div
              key={idx}
              className="p-4 bg-slate-950/50 hover:bg-slate-950/80 border border-slate-800/90 rounded-xl transition-all space-y-2"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-lg bg-indigo-500/20 text-indigo-300 text-xs font-bold flex items-center justify-center border border-indigo-500/30">
                    #{idx + 1}
                  </span>
                  <span
                    className={`text-[11px] font-semibold uppercase tracking-wider px-2.5 py-0.5 rounded-md ${
                      q.is_mandatory_hr
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                        : 'bg-purple-500/10 text-purple-300 border border-purple-500/30'
                    }`}
                  >
                    {q.category ? q.category.replace(/_/g, ' ') : q.question_type}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-slate-400 font-medium">
                  <span>⏱️ {Math.round(q.time_limit_sec / 60)} min limit</span>
                  <span>{q.difficulty}</span>
                </div>
              </div>

              <p className="text-sm font-medium text-slate-100 pl-1">{q.question_text}</p>

              {q.intent && (
                <p className="text-xs text-slate-400 pl-1 italic">
                  <span className="font-semibold not-italic text-slate-500">Intent: </span>
                  {q.intent}
                </p>
              )}

              {Array.isArray(q.required_skills) && q.required_skills.length > 0 && (
                <div className="flex items-center gap-1.5 pt-1 pl-1 flex-wrap">
                  {q.required_skills.map((skill: string, sIdx: number) => (
                    <span
                      key={sIdx}
                      className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded border border-slate-700/80"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

