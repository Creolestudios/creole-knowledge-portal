import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createInterviewSessionWithInvite, SessionGenerationError } from './create-session-and-invite';
import type { ExtractionResult } from './types';

const baseExtraction: ExtractionResult = {
  candidateProfile: { name: 'Jane Doe', email: 'jane@example.com', extractedSkills: [], domains: [] },
  jdRequirements: { mustHaveSkills: [], niceToHaveSkills: [], keyResponsibilities: [] },
  analysis: {
    matchPercentage: 80,
    matchedKeywords: [],
    missingKeywords: [],
    resumeOnlyKeywords: [],
    skillGapSummary: '',
    keyStrengths: [],
    improvementAreas: [],
  },
  extractedAt: new Date().toISOString(),
};

describe('createInterviewSessionWithInvite', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('chains create -> generate -> invite and returns the combined result', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ session: { id: 'sess-1', status: 'draft' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ questions: [{ id: 'q1', question_text: 'Q1' }] }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          invite_id: 'inv-1',
          invite_url: 'http://localhost/interview/raw-token',
          passcode: '654321',
          expires_at: '2099-01-01T00:00:00.000Z',
        }),
      });

    const result = await createInterviewSessionWithInvite(baseExtraction, 45);

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/interviews', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/interviews/sess-1/generate', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/interviews/sess-1/invite', expect.objectContaining({ method: 'POST' }));

    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual({ duration_minutes: 45 });
    expect(result.session.id).toBe('sess-1');
    expect(result.questions).toEqual([{ id: 'q1', question_text: 'Q1' }]);
    expect(result.invite.invite_url).toBe('http://localhost/interview/raw-token');
    expect(result.invite.passcode).toBe('654321');
    expect(result.extraction).toBe(baseExtraction);
  });

  it('throws a session-stage error when session creation fails', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'candidate_email is required' }) });

    await expect(createInterviewSessionWithInvite(baseExtraction)).rejects.toMatchObject({
      stage: 'session',
      message: 'candidate_email is required',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws a questions-stage error when question generation fails, without calling invite', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ session: { id: 'sess-1' } }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Gemini quota exceeded' }) });

    let caught: unknown;
    try {
      await createInterviewSessionWithInvite(baseExtraction);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(SessionGenerationError);
    expect((caught as SessionGenerationError).stage).toBe('questions');
    expect((caught as SessionGenerationError).message).toBe('Gemini quota exceeded');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws an invite-stage error when invite creation fails', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ session: { id: 'sess-1' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ questions: [] }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'db down' }) });

    await expect(createInterviewSessionWithInvite(baseExtraction)).rejects.toMatchObject({
      stage: 'invite',
      message: 'db down',
    });
  });

  it('falls back to a generic message when the error response has no error field', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => null });

    await expect(createInterviewSessionWithInvite(baseExtraction)).rejects.toMatchObject({
      stage: 'session',
      message: 'Failed to create the interview session.',
    });
  });
});
