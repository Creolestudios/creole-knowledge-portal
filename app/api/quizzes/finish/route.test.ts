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
        update: vi.fn().mockReturnThis(),
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
  return new Request('http://localhost/api/quizzes/finish', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/quizzes/finish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbResponses = [];
  });

  it('returns 401 when there is no authenticated user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(mockRequest({ attemptId: 'a1' }));
    expect(res.status).toBe(401);
  });

  it('requires an attemptId', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const res = await POST(mockRequest({}));
    expect(res.status).toBe(400);
  });

  it('rejects an attempt that is not in progress', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockDbResponses = [{ data: { status: 'completed' }, error: null }];

    const res = await POST(mockRequest({ attemptId: 'a1' }));
    expect(res.status).toBe(403);
  });

  it('scores the attempt, persists it, and returns review data', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });

    const startedAt = new Date(Date.now() - 60_000).toISOString();
    mockDbResponses = [
      {
        data: {
          status: 'in_progress',
          started_at: startedAt,
          total_questions: 5,
          blog_id: 'blog-1',
          quiz_answers: [
            { question_id: 'q1', points_awarded: 2, is_correct: true, user_answer: 'A', evaluation_reason: 'Correct' },
          ],
        },
        error: null,
      }, // attempt lookup
      { error: null }, // update
      {
        data: [
          { id: 'q1', question: 'What?', question_type: 'conceptual', options: null, correct_answers: [], explanation: 'Because' },
        ],
        error: null,
      }, // questions
    ];

    const res = await POST(mockRequest({ attemptId: 'a1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.result.score).toBe(2);
    expect(body.result.reviewData).toHaveLength(1);
    expect(body.result.reviewData[0].questionId).toBe('q1');
    expect(body.result.reviewData[0].isCorrect).toBe(true);
  });
});
