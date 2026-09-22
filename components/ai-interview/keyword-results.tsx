'use client';

import React, { useState } from 'react';
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
  Link2,
  KeyRound,
} from 'lucide-react';

import { ExtractionResult, SessionGenerationResult } from '@/lib/ai-interview/types';

interface KeywordResultsProps {
  result: SessionGenerationResult;
  onReset: () => void;
}

/**
 * Full results view for the "Generate Interview Link" flow: the keyword
 * analysis overview plus the interview link/passcode and the questions that
 * were actually generated and stored for the session.
 */
export function KeywordResults({ result, onReset }: KeywordResultsProps) {
  return (
    <div className="w-full space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
      <KeywordAnalysisOverview extraction={result.extraction} onReset={onReset} />
      <InterviewLinkAndQuestions result={result} />
    </div>
  );
}

interface KeywordAnalysisOverviewProps {
  extraction: ExtractionResult;
  onReset: () => void;
}

/**
 * Just the keyword/skill-match analysis display, with no session/invite
 * data — reused by the older ai-interview-manager.tsx flow, which only
 * previews extraction results and doesn't create a session or invite.
 */
export function KeywordAnalysisOverview({ extraction, onReset }: KeywordAnalysisOverviewProps) {
  const [copied, setCopied] = useState(false);
  const { candidateProfile, jdRequirements, analysis } = extraction;

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
    <div className="w-full space-y-8">
      {/* HEADER BAR */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-6 bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-2xl shadow-xl">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-blue-400 bg-blue-500/10 px-2.5 py-1 rounded-full border border-blue-500/20">
              Extraction Complete
            </span>
            <span className="text-xs text-slate-500">
              Extracted at {new Date(extraction.extractedAt).toLocaleTimeString()}
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
    </div>
  );
}

/**
 * Interview link/passcode panel + the questions actually generated and
 * stored for the session — produced by the single "Generate Interview Link"
 * action, shown only from the full `KeywordResults` view.
 */
function InterviewLinkAndQuestions({ result }: { result: SessionGenerationResult }) {
  const { invite, questions } = result;
  const [copiedField, setCopiedField] = useState<'link' | 'passcode' | null>(null);

  const handleCopy = (value: string, field: 'link' | 'passcode') => {
    navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* SUCCESS BANNER — confirms whether question generation succeeded */}
      <div
        id="interview-generation-status"
        className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-300 text-sm"
      >
        <CheckCircle2 className="w-5 h-5 shrink-0" />
        <span>
          {questions.length} interview question{questions.length === 1 ? '' : 's'} generated and
          saved successfully. The interview link and passcode are ready below.
        </span>
      </div>

      {/* INTERVIEW LINK & PASSCODE */}
      <div className="p-6 bg-emerald-500/5 border border-emerald-500/30 rounded-2xl space-y-4">
        <h3 className="text-lg font-bold text-slate-100">Interview Link &amp; Passcode</h3>
        <p className="text-xs text-slate-400">
          Share the link and passcode below with the candidate. The link expires at{' '}
          {invite.expires_at ? new Date(invite.expires_at).toLocaleString() : 'N/A'}.
        </p>

        <div className="space-y-3">
          <div className="flex items-center gap-2 p-3 bg-slate-950/60 border border-slate-800 rounded-xl">
            <Link2 className="w-4 h-4 text-blue-400 shrink-0" />
            <input
              id="keyword-results-invite-link"
              readOnly
              value={invite.invite_url || ''}
              className="flex-1 bg-transparent text-sm text-slate-200 outline-none"
            />
            <button
              id="keyword-results-copy-link"
              type="button"
              onClick={() => handleCopy(invite.invite_url || '', 'link')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 rounded-lg border border-slate-700"
            >
              {copiedField === 'link' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedField === 'link' ? 'Copied' : 'Copy'}
            </button>
          </div>

          <div className="flex items-center gap-2 p-3 bg-slate-950/60 border border-slate-800 rounded-xl">
            <KeyRound className="w-4 h-4 text-amber-400 shrink-0" />
            <input
              id="keyword-results-invite-passcode"
              readOnly
              value={invite.passcode || ''}
              className="flex-1 bg-transparent text-sm font-mono tracking-widest text-slate-200 outline-none"
            />
            <button
              id="keyword-results-copy-passcode"
              type="button"
              onClick={() => handleCopy(invite.passcode || '', 'passcode')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 rounded-lg border border-slate-700"
            >
              {copiedField === 'passcode' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedField === 'passcode' ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      </div>

      {/* THE QUESTIONS THAT WERE ACTUALLY GENERATED & STORED */}
      <div className="p-6 bg-slate-900/80 border border-slate-800 rounded-2xl space-y-6 shadow-xl">
        <h3 className="text-xl font-bold text-slate-100">
          Generated Interview Questions ({questions.length})
        </h3>

        {questions.some((q) => q.is_fallback) && (
          <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-sm">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <span>
              <strong>Warning:</strong> The AI model quota has finished or the service is temporarily unavailable. The questions below are default fallback questions dynamically adapted to the candidate&apos;s profile.
            </span>
          </div>
        )}

        <div className="space-y-3">
          {questions.map((q, idx) => (
            <div
              key={q.id || idx}
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
                    {q.category ? q.category.replaceAll('_', ' ') : q.question_type}
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
      </div>
    </div>
  );
}

