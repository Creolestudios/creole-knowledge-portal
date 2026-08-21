import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

const mockGetUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(() => ({
    auth: { getUser: mockGetUser },
  })),
}));

vi.mock('@/lib/ai/quiz-generator', () => ({
  generateQuizForBlog: vi.fn().mockResolvedValue(5),
}));

let mockDbResponses: any[] = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => {
      const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => {
          const res = mockDbResponses.length > 0 ? mockDbResponses.shift() : { data: null, error: null };
          resolve(res);
        }),
      };
      return chain;
    }),
  },
}));

function mockRequest(body: unknown) {
  return new Request('http://localhost/api/quizzes/start', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/quizzes/start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbResponses = [];
  });

  it('returns 401 when there is no authenticated user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(mockRequest({ blogId: 'b1' }));
    expect(res.status).toBe(401);
  });

  it('requires a blogId', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const res = await POST(mockRequest({}));
    expect(res.status).toBe(400);
  });

  it('handles 42703 error on first attempt query and executes fallback query', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockDbResponses = [
      { data: null, error: { code: '42703', message: 'column passed does not exist' } }, // first query error
      { data: [{ id: 'a1', score: 4, status: 'completed' }], error: null }, // fallback query
    ];

    const res = await POST(mockRequest({ blogId: 'b1' }));
    expect(res.status).toBe(403);
  });

  it('rejects a retry when a passing attempt already exists', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockDbResponses = [
      { data: [{ id: 'a1', status: 'completed', score: 4, passed: true }], error: null }
    ];

    const res = await POST(mockRequest({ blogId: 'b1' }));
    expect(res.status).toBe(403);
  });

  it('calculates finishedAttemptsCount from a single attempt with total_questions >= 25', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockDbResponses = [
      { data: [{ id: 'a1', status: 'completed', score: 1, passed: false, total_questions: 25 }], error: null }
    ];

    const res = await POST(mockRequest({ blogId: 'b1' }));
    expect(res.status).toBe(403);
  });

  it('rejects a retry when 3 attempts have been exhausted', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockDbResponses = [
      { data: [
        { id: 'a1', status: 'completed', score: 1, passed: false },
        { id: 'a2', status: 'completed', score: 1, passed: false },
        { id: 'a3', status: 'completed', score: 1, passed: false }
      ], error: null }
    ];

    const res = await POST(mockRequest({ blogId: 'b1' }));
    expect(res.status).toBe(403);
  });

  it('resumes active in-progress attempt if one already exists', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockDbResponses = [
      { data: [{ id: 'active-1', status: 'in_progress', started_at: '2026-08-14T00:00:00Z' }], error: null }, // completedAttempts
      { data: [{ question_id: 'q1' }], error: null }, // activeAnswers
      { data: [{ id: 'q1', question_type: 'single', question: 'Active Q?' }], error: null }, // questions
    ];

    const res = await POST(mockRequest({ blogId: 'b1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attemptId).toBe('active-1');
    expect(body.questions).toHaveLength(1);
  });

  it('fetches blog from microservice when supabase blog record is missing', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ blog: { content: 'Microservice content' } }),
    } as any);

    mockDbResponses = [
      { data: [], error: null }, // completedAttempts
      { data: [], error: null }, // allQuestions
      { data: null, error: null }, // blog fetch from DB is empty
      { data: [{ id: 'q1', question_type: 'single', question: 'Q1' }], error: null }, // reloaded questions
      { data: { id: 'attempt-ms', started_at: '2026-08-14T00:00:00Z' }, error: null }, // insert attempt
      { data: [], error: null }, // placeholder answers insert
    ];

    const res = await POST(mockRequest({ blogId: 'b1' }));
    expect(res.status).toBe(200);
  });

  it('returns 404 when no blog content or questions exist', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    global.fetch = vi.fn().mockRejectedValue(new Error('Microservice down'));

    mockDbResponses = [
      { data: [], error: null }, // completedAttempts
      { data: [], error: null }, // allQuestions
      { data: null, error: null }, // blog fetch from DB is empty
    ];

    const res = await POST(mockRequest({ blogId: 'b1' }));
    expect(res.status).toBe(404);
  });

  it('retries attempt insertion without attempt_number when column fails with 42703', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const questions = [
      { id: 'q1', question_type: 'single', difficulty: 'easy', question: 'Q1?', options: null, code_snippet: null }
    ];

    mockDbResponses = [
      { data: [], error: null }, // completedAttempts
      { data: questions, error: null }, // allQuestions
      { data: null, error: { code: '42703', message: 'column attempt_number does not exist' } }, // first insert attempt fails
      { data: { id: 'retry-attempt', started_at: '2026-08-14T00:00:00Z' }, error: null }, // second insert succeeds
      { data: [], error: null }, // placeholder answers insert
    ];

    const res = await POST(mockRequest({ blogId: 'b1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attemptId).toBe('retry-attempt');
  });

  it('handles unique constraint error (23505) by updating single row attempt', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const questions = [
      { id: 'q1', question_type: 'single', difficulty: 'easy', question: 'Q1?', options: null, code_snippet: null }
    ];
    mockDbResponses = [
      { data: [], error: null }, // completedAttempts
      { data: questions, error: null }, // allQuestions
      { data: null, error: { code: '23505', message: 'duplicate key' } }, // insert attempt fails with 23505
      { data: { id: 'updated-1', started_at: '2026-08-14T00:00:00Z' }, error: null }, // update single row
      { data: [], error: null }, // delete old answers
      { data: [], error: null }, // placeholder answers insert
    ];

    const res = await POST(mockRequest({ blogId: 'b1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attemptId).toBe('updated-1');
  });

  it('returns 500 when persisting the new attempt fails', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockDbResponses = [
      { data: [], error: null }, // completedAttempts
      { data: [{ id: 'q1', question_type: 'single', difficulty: 'easy', question: 'Q?', options: null, code_snippet: null }], error: null }, // allQuestions
      { data: null, error: { message: 'insert failed' } }, // insert attempt
    ];

    const res = await POST(mockRequest({ blogId: 'b1' }));
    expect(res.status).toBe(500);
  });

  it('returns 500 on an unexpected error', async () => {
    mockGetUser.mockRejectedValue(new Error('boom'));
    const res = await POST(mockRequest({ blogId: 'b1' }));
    expect(res.status).toBe(500);
  });
});
