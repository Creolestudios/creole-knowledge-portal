import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockRequireAdminUser, mockGenerateInterviewQuestions } = vi.hoisted(() => ({
  mockRequireAdminUser: vi.fn().mockResolvedValue({ userId: 'admin-1' }),
  mockGenerateInterviewQuestions: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  requireAdminUser: mockRequireAdminUser,
}));

vi.mock('@/lib/ai-interview/question-generator', () => ({
  generateInterviewQuestions: mockGenerateInterviewQuestions,
  DEFAULT_MANDATORY_HR_QUESTIONS: [{ question_text: 'Tell me about yourself', question_order: 1 }],
}));

import { POST } from './route';

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost:3000/api/ai-interview/generate-questions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ai-interview/generate-questions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
  });

  it('returns 401 when the caller is not an admin', async () => {
    mockRequireAdminUser.mockResolvedValue(null);
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(401);
  });

  it('generates questions when valid inputs are provided', async () => {
    mockGenerateInterviewQuestions.mockResolvedValue([{ question_text: 'Q1' }]);

    const res = await POST(makeRequest({ durationMinutes: 30, targetQuestions: 5 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.questions).toEqual([{ question_text: 'Q1' }]);
    expect(body.totalCount).toBe(1);
    expect(body.durationMinutes).toBe(30);

    expect(mockGenerateInterviewQuestions).toHaveBeenCalledWith(
      { extractedSkills: [], domains: [] },
      { mustHaveSkills: [], niceToHaveSkills: [], keyResponsibilities: [] },
      expect.objectContaining({ matchPercentage: 0 }),
      expect.any(Array),
      {
        durationMinutes: 30,
        targetQuestions: 5,
        categoryCounts: undefined,
        includeMandatoryHr: false,
        selectedQuestionIds: undefined,
      },
    );
  });

  it('passes through provided profile/jd/analysis and optional options', async () => {
    mockGenerateInterviewQuestions.mockResolvedValue([]);
    const profile = { extractedSkills: ['React'], domains: ['frontend'] };
    const jd = { mustHaveSkills: ['React'], niceToHaveSkills: [], keyResponsibilities: [] };
    const analysis = { matchPercentage: 80, matchedKeywords: ['React'], missingKeywords: [], resumeOnlyKeywords: [], skillGapSummary: '', keyStrengths: [], improvementAreas: [] };

    const res = await POST(makeRequest({
      candidateProfile: profile,
      jdRequirements: jd,
      analysis,
      durationMinutes: 45,
      targetQuestions: 10,
      categoryCounts: { technical: 2, behavioural: 1 },
      includeMandatoryHr: true,
      selectedQuestionIds: ['q-1', 'q-2'],
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.durationMinutes).toBe(45);

    expect(mockGenerateInterviewQuestions).toHaveBeenCalledWith(
      profile,
      jd,
      analysis,
      expect.any(Array),
      {
        durationMinutes: 45,
        targetQuestions: 10,
        categoryCounts: { technical: 2, behavioural: 1 },
        includeMandatoryHr: true,
        selectedQuestionIds: ['q-1', 'q-2'],
      },
    );
  });

  it('returns 400 for invalid duration or question counts', async () => {
    mockGenerateInterviewQuestions.mockResolvedValue([]);

    const invalidDuration = await POST(makeRequest({ durationMinutes: -5, targetQuestions: 5 }));
    expect(invalidDuration.status).toBe(400);
    const invalidTarget = await POST(makeRequest({ durationMinutes: 30, targetQuestions: 0 }));
    expect(invalidTarget.status).toBe(400);
  });

  it('returns 400 when targetQuestions is missing or invalid', async () => {
    const res = await POST(makeRequest({ durationMinutes: 30, targetQuestions: 0 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Question count is required.');
  });

  it('passes through optional categoryCounts, includeMandatoryHr, and selectedQuestionIds', async () => {
    mockGenerateInterviewQuestions.mockResolvedValue([{ question_text: 'Q1' }]);

    const profile = { extractedSkills: ['React'], domains: ['frontend'] };
    const jd = { mustHaveSkills: ['React'], niceToHaveSkills: ['Next.js'], keyResponsibilities: ['build UI'] };
    const analysis = {
      matchPercentage: 82,
      matchedKeywords: ['React'],
      missingKeywords: [],
      resumeOnlyKeywords: [],
      skillGapSummary: 'Solid frontend fit',
      keyStrengths: ['React'],
      improvementAreas: [],
    };

    const res = await POST(
      makeRequest({
        candidateProfile: profile,
        jdRequirements: jd,
        analysis,
        durationMinutes: 45,
        targetQuestions: 6,
        categoryCounts: { technical: 2, behavioural: 1 },
        includeMandatoryHr: true,
        selectedQuestionIds: ['q-1', 'q-2'],
      }),
    );

    expect(res.status).toBe(200);
    expect(mockGenerateInterviewQuestions).toHaveBeenCalledWith(
      profile,
      jd,
      analysis,
      expect.any(Array),
      expect.objectContaining({
        durationMinutes: 45,
        targetQuestions: 6,
        categoryCounts: { technical: 2, behavioural: 1 },
        includeMandatoryHr: true,
        selectedQuestionIds: ['q-1', 'q-2'],
      }),
    );
  });

  it('returns 500 when question generation throws', async () => {
    mockGenerateInterviewQuestions.mockRejectedValue(new Error('LLM unavailable'));
    const res = await POST(makeRequest({ durationMinutes: 30, targetQuestions: 5 }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('LLM unavailable');
  });
});
