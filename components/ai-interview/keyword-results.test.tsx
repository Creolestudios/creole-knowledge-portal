// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KeywordResults } from './keyword-results';
import { SessionGenerationResult } from '@/lib/ai-interview/types';

function makeResult(overrides: Partial<SessionGenerationResult> = {}): SessionGenerationResult {
  return {
    extraction: {
      candidateProfile: { extractedSkills: ['React'], domains: ['Web'] },
      jdRequirements: { mustHaveSkills: ['React'], niceToHaveSkills: [], keyResponsibilities: [] },
      analysis: {
        matchPercentage: 80,
        matchedKeywords: ['React'],
        missingKeywords: [],
        resumeOnlyKeywords: [],
        skillGapSummary: 'Strong match.',
        keyStrengths: [],
        improvementAreas: [],
      },
      extractedAt: '2026-09-01T00:00:00Z',
    },
    session: { id: 's1' } as any,
    questions: [
      {
        question_text: 'Tell us about yourself',
        question_type: 'hr',
        category: 'hr',
        difficulty: 'easy',
        required_skills: [],
        intent: 'warm-up',
        question_order: 1,
        time_limit_sec: 120,
        is_mandatory_hr: true,
        weight: 5,
      } as any,
    ],
    invite: {
      id: 'inv1',
      session_id: 's1',
      token_hash: 'x',
      status: 'active',
      max_warnings: 3,
      max_alerts: 3,
      allowed_modes: ['interview'],
      expires_at: '2026-09-05T00:00:00Z',
      invite_url: 'https://example.com/assess/tok',
      passcode: '123456',
    } as any,
    ...overrides,
  };
}

describe('KeywordResults', () => {
  const writeText = vi.fn();
  beforeEach(() => {
    writeText.mockClear();
    Object.assign(navigator, { clipboard: { writeText } });
  });

  it('renders the invite link, passcode, and singular question count', () => {
    render(<KeywordResults result={makeResult()} onReset={vi.fn()} />);

    expect(screen.getByText(/1 interview question generated and/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://example.com/assess/tok')).toBeInTheDocument();
    expect(screen.getByDisplayValue('123456')).toBeInTheDocument();
  });

  it('shows the plural form when there is more than one question', () => {
    const result = makeResult({
      questions: [
        { question_text: 'Q1', question_type: 'hr', category: 'hr', difficulty: 'easy', required_skills: [], intent: '', question_order: 1, time_limit_sec: 120, is_mandatory_hr: true, weight: 5 } as any,
        { question_text: 'Q2', question_type: 'hr', category: 'hr', difficulty: 'easy', required_skills: [], intent: '', question_order: 2, time_limit_sec: 120, is_mandatory_hr: false, weight: 10 } as any,
      ],
    });
    render(<KeywordResults result={result} onReset={vi.fn()} />);
    expect(screen.getByText(/2 interview questions generated and/)).toBeInTheDocument();
  });

  it('copies the invite link and passcode when their copy buttons are clicked', () => {
    render(<KeywordResults result={makeResult()} onReset={vi.fn()} />);

    fireEvent.click(document.getElementById('keyword-results-copy-link')!);
    expect(writeText).toHaveBeenCalledWith('https://example.com/assess/tok');

    fireEvent.click(document.getElementById('keyword-results-copy-passcode')!);
    expect(writeText).toHaveBeenCalledWith('123456');
  });

  it('falls back to N/A when the invite has no expiry', () => {
    const result = makeResult({ invite: { ...makeResult().invite, expires_at: undefined } as any });
    render(<KeywordResults result={result} onReset={vi.fn()} />);
    expect(screen.getByText(/expires at N\/A/)).toBeInTheDocument();
  });

  it('shows the fallback warning when is_fallback is true on a question', () => {
    const result = makeResult({ 
      questions: [
        { question_text: 'Q1', question_type: 'hr', category: 'hr', difficulty: 'easy', required_skills: [], intent: '', question_order: 1, time_limit_sec: 120, is_mandatory_hr: true, weight: 5, is_fallback: true } as any
      ]
    });
    render(<KeywordResults result={result} onReset={vi.fn()} />);
    expect(screen.getByText(/The AI model quota has finished/)).toBeInTheDocument();
  });
});
