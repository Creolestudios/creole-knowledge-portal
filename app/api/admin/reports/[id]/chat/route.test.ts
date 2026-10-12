import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

const mockRequireAdminUser = vi.fn();
const mockSingle = vi.fn();
const mockMaybeSingle = vi.fn();

const mockFrom = vi.fn((table: string) => {
  if (table === 'interview_sessions') {
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: mockSingle,
    };
  }
  if (table === 'interview_questions' || table === 'interview_answers') {
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [] }),
    };
  }
  if (table === 'interview_transcript') {
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [] }),
    };
  }
  if (table === 'interview_events') {
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [] }),
    };
  }
  if (table === 'interview_invites') {
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: mockMaybeSingle,
    };
  }
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockResolvedValue({ data: [] }),
  };
});

vi.mock('@/lib/supabase/admin', () => ({
  requireAdminUser: () => mockRequireAdminUser(),
  supabaseAdmin: {
    from: (t: string) => mockFrom(t),
  },
}));

vi.mock('@/lib/ai-interview/report-store', () => ({
  getInterviewReport: vi.fn().mockResolvedValue({
    recommendation: 'yes',
    recommendation_rationale: 'Solid fundamentals.',
    cognitive_composite: 85,
    fluency_score: 90,
    fluency_cefr: 'C1',
    competency_scores: [
      { competency: 'React', score: 4, justification: 'Demonstrated deep hooks knowledge.' },
    ],
  }),
}));

const mockGenerateContent = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = {
      generateContent: (...args: unknown[]) => mockGenerateContent(...args),
    };
  },
}));

describe('POST /api/admin/reports/[id]/chat', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, GEMINI_API_KEY: 'test-api-key' };
  });

  it('returns 401 when user is not an admin', async () => {
    mockRequireAdminUser.mockResolvedValue(null);

    const req = new Request('http://localhost/api/admin/reports/session-123/chat', {
      method: 'POST',
      body: JSON.stringify({ question: 'How was their performance?' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'session-123' }) });
    expect(res.status).toBe(401);
  });

  it('returns 400 when question is missing', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });

    const req = new Request('http://localhost/api/admin/reports/session-123/chat', {
      method: 'POST',
      body: JSON.stringify({ question: '   ' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'session-123' }) });
    expect(res.status).toBe(400);
  });

  it('returns 404 when session is not found in database', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    mockSingle.mockResolvedValue({ data: null, error: { message: 'Not found' } });
    mockMaybeSingle.mockResolvedValue({ data: null });

    const req = new Request('http://localhost/api/admin/reports/session-123/chat', {
      method: 'POST',
      body: JSON.stringify({ question: 'How did they do?' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'session-123' }) });
    expect(res.status).toBe(404);
  });

  it('generates an answer when admin asks a grounded question', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    mockSingle.mockResolvedValue({
      data: {
        id: 'session-123',
        candidate_name: 'Jane Doe',
        candidate_email: 'jane@example.com',
        status: 'completed',
        parsed_jd: { jobTitle: 'Senior Frontend Engineer' },
      },
    });
    mockMaybeSingle.mockResolvedValue({ data: { status: 'completed' } });
    mockGenerateContent.mockResolvedValue({
      text: 'Jane Doe demonstrated solid competency in React with an 85/100 score.',
    });

    const req = new Request('http://localhost/api/admin/reports/session-123/chat', {
      method: 'POST',
      body: JSON.stringify({
        question: 'What were their key strengths?',
        history: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }],
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'session-123' }) });
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.answer).toContain('Jane Doe demonstrated solid competency');
  });

  it('returns 500 when Gemini API key is missing', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    mockSingle.mockResolvedValue({
      data: {
        id: 'session-123',
        candidate_name: 'Jane Doe',
        status: 'completed',
      },
    });
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_GENAI_API_KEY;

    const req = new Request('http://localhost/api/admin/reports/session-123/chat', {
      method: 'POST',
      body: JSON.stringify({ question: 'Tell me about the candidate' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'session-123' }) });
    expect(res.status).toBe(500);
  });
});
