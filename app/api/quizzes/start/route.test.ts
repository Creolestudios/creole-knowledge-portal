import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

const mockGetUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(() => ({
    auth: { getUser: mockGetUser },
  })),
}));

let mockDbResponses: any[] = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => {
      const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockReturnThis(),
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

  it('rejects a retry when an attempt already exists', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockDbResponses = [{ count: 1, error: null }];

    const res = await POST(mockRequest({ blogId: 'b1' }));
    expect(res.status).toBe(403);
  });

  it('returns 404 when no quiz questions exist for the blog', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockDbResponses = [
      { count: 0, error: null }, // attempt count
      { data: [], error: null }, // questions
    ];

    const res = await POST(mockRequest({ blogId: 'b1' }));
    expect(res.status).toBe(404);
  });

  it('returns 500 when persisting the new attempt fails', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockDbResponses = [
      { count: 0, error: null },
      { data: [{ id: 'q1', question_type: 'single', difficulty: 'easy', question: 'Q?', options: null, code_snippet: null }], error: null },
      { data: null, error: { message: 'insert failed' } },
    ];

    const res = await POST(mockRequest({ blogId: 'b1' }));
    expect(res.status).toBe(500);
  });

  it('starts a quiz attempt, shuffles questions, and returns them', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const questions = [
      { id: 'q1', question_type: 'single', difficulty: 'easy', question: 'Q1?', options: null, code_snippet: null },
      { id: 'q2', question_type: 'single', difficulty: 'easy', question: 'Q2?', options: null, code_snippet: null },
    ];
    mockDbResponses = [
      { count: 0, error: null },
      { data: questions, error: null },
      { data: { id: 'attempt-1', started_at: '2026-08-14T00:00:00Z' }, error: null },
    ];

    const res = await POST(mockRequest({ blogId: 'b1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attemptId).toBe('attempt-1');
    expect(body.questions).toHaveLength(2);
    expect(body.startedAt).toBe('2026-08-14T00:00:00Z');
  });

  it('returns 500 on an unexpected error', async () => {
    mockGetUser.mockRejectedValue(new Error('boom'));
    const res = await POST(mockRequest({ blogId: 'b1' }));
    expect(res.status).toBe(500);
  });
});
