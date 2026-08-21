import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(() => ({ auth: { getUser: mockGetUser } })),
}));

// Per-table response queues: each call to supabaseAdmin.from(table) consumes
// the next queued response for that table (defaults to empty success).
let tableResponses: Record<string, any[]>;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => {
          const queue = tableResponses[table] ?? [];
          const res = queue.length > 0 ? queue.shift() : { data: null, error: null, count: 0 };
          resolve(res);
        }),
      };
      return chain;
    }),
  },
}));

function quizBlog(overrides: Partial<{ questions: any[] }> = {}) {
  const questions = overrides.questions ?? [
    { id: 'q1', text: 'What is 2+2?', correctAnswer: 'B', explanation: 'Math' },
  ];
  const quizData = JSON.stringify({ questions });
  return {
    id: 'blog-1',
    content: `<p>Blog body</p><!-- QUIZ_DATA: ${quizData} -->`,
  };
}

function mockRequest(body: unknown, cookie?: string) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (cookie) headers.set('cookie', cookie);
  return new Request('http://localhost/api/quizzes/submit', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /api/quizzes/submit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tableResponses = {};
  });

  it('returns 401 with no session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(mockRequest({ quizId: 'blog-1', answers: [], timeTakenSec: 30 }));
    expect(res.status).toBe(401);
  });

  it('does not authenticate via a mock-user cookie when there is no session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(
      mockRequest(
        { quizId: 'blog-1', answers: [{ questionId: 'q1', userAnswer: 'b' }], timeTakenSec: 30 },
        'mock-user=true',
      ),
    );
    expect(res.status).toBe(401);
  });

  it('validates required fields', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const res = await POST(mockRequest({ quizId: 'blog-1' }));
    expect(res.status).toBe(400);
  });

  it('falls back to URL lookup and 404s when the blog cannot be found either way', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    tableResponses = {
      blogs: [
        { data: null, error: { message: 'not found' } },
        { data: null, error: null },
      ],
    };

    const res = await POST(mockRequest({ quizId: 'blog-1', answers: [], timeTakenSec: 30 }));
    expect(res.status).toBe(404);
  });

  it('returns 400 when the blog has no embedded quiz data', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    tableResponses = { blogs: [{ data: { id: 'blog-1', content: '<p>No quiz here</p>' }, error: null }] };

    const res = await POST(mockRequest({ quizId: 'blog-1', answers: [], timeTakenSec: 30 }));
    expect(res.status).toBe(400);
  });

  it('grades a perfect score, awards XP/coins, and sets the gamification cookie', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    tableResponses = {
      blogs: [{ data: quizBlog(), error: null }],
      user_profiles: [{ data: { xp: 0, coins: 0 }, error: null }],
      streaks: [{ data: null, error: { message: 'no row' } }],
    };

    const res = await POST(
      mockRequest({
        quizId: 'blog-1',
        answers: [{ questionId: 'q1', userAnswer: 'b' }],
        timeTakenSec: 30,
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.score).toBe(1);
    expect(body.data.isPerfect).toBe(true);
    expect(body.data.xpEarned).toBeGreaterThan(0);
    expect(res.headers.get('Set-Cookie')).toContain('mock_gamification_stats=');
  });

  it('zeroes XP/coins when the submission is flagged as a speed violation', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    tableResponses = {
      blogs: [{ data: quizBlog(), error: null }],
      user_profiles: [{ data: null, error: { message: 'no row' } }],
      streaks: [{ data: null, error: { message: 'no row' } }],
    };

    const res = await POST(
      mockRequest({
        quizId: 'blog-1',
        answers: [{ questionId: 'q1', userAnswer: 'b' }],
        timeTakenSec: 0.5, // 0.5s for 1 question => speed violation
      }),
    );

    const body = await res.json();
    expect(body.data.speedViolation).toBe(true);
    expect(body.data.xpEarned).toBe(0);
    expect(body.data.coinsEarned).toBe(0);
  });

  it('returns a 500 when the request body cannot be parsed', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const badRequest = new Request('http://localhost/api/quizzes/submit', {
      method: 'POST',
      body: 'not json',
    });
    const res = await POST(badRequest);
    expect(res.status).toBe(500);
  });
});
