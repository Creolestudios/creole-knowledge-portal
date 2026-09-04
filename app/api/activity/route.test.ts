import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './route';

const mockGetUser = vi.fn();
let responseQueue: any[];

function makeChain() {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    then: vi.fn((resolve) => {
      const res = responseQueue.length > 0 ? responseQueue.shift() : { data: null, error: null };
      resolve(res);
    }),
  };
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(() => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(() => makeChain()),
  })),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => makeChain()),
  }
}));

vi.mock('@/lib/blog-service', () => ({
  blogServiceUrl: (path: string) => `http://blog-service.test${path}`,
  blogServiceHeaders: () => ({ 'Content-Type': 'application/json' }),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockRequest(body?: unknown) {
  return new Request('http://localhost/api/activity', {
    method: body ? 'POST' : 'GET',
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('GET /api/activity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    responseQueue = [];
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-key';
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(mockRequest());
    expect(res.status).toBe(401);
  });

  it('returns empty records with a zero streak when the table does not exist', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    responseQueue = [{ data: null, error: { code: '42P01' } }];

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body).toEqual({ success: true, records: [], streak: 0 });
  });

  it('returns a 500 for any other DB error', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    responseQueue = [{ data: null, error: { code: 'XX000', message: 'boom' } }];

    const res = await GET(mockRequest());
    expect(res.status).toBe(500);
  });

  it('computes a consecutive-day streak from today backwards', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    responseQueue = [
      {
        data: [
          { created_at: today.toISOString(), metadata: { read_seconds: 100 } },
          { created_at: yesterday.toISOString(), metadata: { read_seconds: 200 } },
          { created_at: twoDaysAgo.toISOString(), metadata: { read_seconds: 0 } }, // breaks the streak
        ],
        error: null,
      },
      { data: [], error: null } // quiz_attempts
    ];

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.streak).toBe(2);
  });

  it('ignores a missing quiz_attempts table and still returns reading records', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    responseQueue = [
      { data: [{ created_at: today.toISOString(), metadata: { read_seconds: 120 } }], error: null },
      { data: null, error: { code: '42P01' } }, // quiz_attempts missing
    ];

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.records).toHaveLength(1);
    expect(body.records[0].read_seconds).toBe(120);
    expect(body.records[0].quiz_taken).toBe(false);
    expect(body.streak).toBe(1);
  });

  it('returns a 500 when the quiz_attempts query fails for any other reason', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    responseQueue = [
      { data: [], error: null },
      { data: null, error: { code: 'XX000', message: 'quiz boom' } },
    ];

    const res = await GET(mockRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('quiz boom');
  });

  it('defaults read_seconds to 0 when the log metadata is absent', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    responseQueue = [
      { data: [{ created_at: today.toISOString(), metadata: null }], error: null },
      { data: [], error: null },
    ];

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.records[0].read_seconds).toBe(0);
    expect(body.streak).toBe(0);
  });

  it('creates a day entry from a quiz attempt even with no reading log', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const today = new Date();
    today.setHours(12, 0, 0, 0);

    responseQueue = [
      { data: [], error: null },
      {
        data: [
          { completed_at: null, score: 99, total_questions: 5 }, // skipped: never completed
          { completed_at: today.toISOString(), score: 3, total_questions: 5 },
        ],
        error: null,
      },
    ];

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.records).toHaveLength(1);
    expect(body.records[0].quiz_taken).toBe(true);
    expect(body.records[0].quiz_score).toBe(3);
    expect(body.records[0].quiz_total).toBe(5);
    expect(body.streak).toBe(1);
  });

  it('keeps the highest quiz score of the day', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const today = new Date();
    today.setHours(12, 0, 0, 0);

    responseQueue = [
      { data: [], error: null },
      {
        data: [
          { completed_at: today.toISOString(), score: 2, total_questions: 5 },
          { completed_at: today.toISOString(), score: 4, total_questions: 6 },
          { completed_at: today.toISOString(), score: 1, total_questions: 5 }, // lower, ignored
        ],
        error: null,
      },
    ];

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.records[0].quiz_score).toBe(4);
    expect(body.records[0].quiz_total).toBe(6);
  });

  it('records a zero-score attempt via the fallback branch and defaults total_questions to 5', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const today = new Date();
    today.setHours(12, 0, 0, 0);

    responseQueue = [
      { data: [], error: null },
      {
        data: [
          { completed_at: today.toISOString(), score: 0, total_questions: null },
          { completed_at: today.toISOString(), score: 0, total_questions: 8 },
        ],
        error: null,
      },
    ];

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.records[0].quiz_taken).toBe(true);
    expect(body.records[0].quiz_score).toBe(0);
    // Both attempts take the `quiz_score === 0` fallback; the last one wins.
    expect(body.records[0].quiz_total).toBe(8);
    expect(body.streak).toBe(1);
  });

  it('sorts records newest-first and stops the streak at a weekday gap', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    // Pinned to Thursday 3 Sep 2026 so the gap below (Wed 2nd) is a weekday and
    // the assertion does not drift with the real calendar.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T12:00:00Z'));

    responseQueue = [
      {
        data: [
          { created_at: '2026-09-01T12:00:00Z', metadata: { read_seconds: 50 } },
          { created_at: '2026-09-03T12:00:00Z', metadata: { read_seconds: 50 } },
        ],
        error: null,
      },
      { data: [], error: null },
    ];

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.records).toHaveLength(2);
    expect(new Date(body.records[0].date).getTime()).toBeGreaterThan(new Date(body.records[1].date).getTime());
    expect(body.streak).toBe(1);
    vi.useRealTimers();
  });

  it('carries the streak across a weekend, when no briefing is generated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    // Monday 7 Sep 2026. The previous briefing was Friday the 4th; Sat/Sun had
    // nothing to read and must not break the streak.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T12:00:00Z'));

    responseQueue = [
      {
        data: [
          { created_at: '2026-09-07T09:00:00Z', metadata: { read_seconds: 120 } },
          { created_at: '2026-09-04T09:00:00Z', metadata: { read_seconds: 120 } },
          { created_at: '2026-09-03T09:00:00Z', metadata: { read_seconds: 120 } },
        ],
        error: null,
      },
      { data: [], error: null },
    ];

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.streak).toBe(3);
    vi.useRealTimers();
  });

  it('lists each quiz attempt separately with its own status and score', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T12:00:00Z'));

    const answer = (correct: boolean, minute: number) => ({
      is_correct: correct,
      created_at: `2026-09-03T10:${String(minute).padStart(2, '0')}:00Z`,
    });

    responseQueue = [
      { data: [], error: null },
      {
        data: [
          {
            started_at: '2026-09-03T10:00:00Z',
            completed_at: '2026-09-03T11:00:00Z',
            status: 'completed',
            score: 9,
            total_questions: 15,
            attempt_number: 1,
            quiz_answers: [
              answer(true, 1), answer(false, 2), answer(false, 3), answer(false, 4), answer(false, 5),
              answer(true, 6), answer(true, 7), answer(true, 8), answer(false, 9), answer(false, 10),
            ],
          },
        ],
        error: null,
      },
    ];

    const res = await GET(mockRequest());
    const body = await res.json();
    const day = body.records.find((r: any) => r.date === '2026-09-03');

    expect(day.attempts).toHaveLength(2);
    expect(day.attempts[0]).toMatchObject({
      attempt_number: 1,
      correct_answers: 1,
      total_questions: 5,
      passed: false,
    });
    expect(day.attempts[1]).toMatchObject({
      attempt_number: 2,
      correct_answers: 3,
      total_questions: 5,
      passed: true,
    });
    // Day score must use best attempt (3), not cumulative row score (9).
    expect(day.quiz_score).toBe(3);
    expect(day.quiz_total).toBe(5);
    expect(day.quiz_passed).toBe(true);
    vi.useRealTimers();
  });

  it('does not mark the day passed from a cumulative row score when every attempt failed', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T12:00:00Z'));

    const answer = (correct: boolean, minute: number) => ({
      is_correct: correct,
      created_at: `2026-09-04T10:${String(minute).padStart(2, '0')}:00Z`,
    });

    responseQueue = [
      { data: [], error: null },
      {
        data: [
          {
            started_at: '2026-09-04T10:00:00Z',
            completed_at: '2026-09-04T11:00:00Z',
            status: 'completed',
            // Inflated cumulative fields that used to paint Past Briefings green.
            score: 4,
            total_questions: 10,
            attempt_number: 1,
            quiz_answers: [
              answer(true, 1), answer(true, 2), answer(false, 3), answer(false, 4), answer(false, 5),
              answer(true, 6), answer(true, 7), answer(false, 8), answer(false, 9), answer(false, 10),
            ],
          },
        ],
        error: null,
      },
    ];

    const res = await GET(mockRequest());
    const body = await res.json();
    const day = body.records.find((r: any) => r.date === '2026-09-04');

    expect(day.attempts).toHaveLength(2);
    expect(day.attempts.every((a: any) => a.passed === false)).toBe(true);
    expect(day.quiz_score).toBe(2);
    expect(day.quiz_total).toBe(5);
    expect(day.quiz_passed).toBe(false);
    expect(day.quiz_taken).toBe(true);
    vi.useRealTimers();
  });

  it('counts a day where the user only started a quiz', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T12:00:00Z'));

    responseQueue = [
      { data: [], error: null },
      {
        data: [
          // Started today, never finished: the day still counts.
          { started_at: '2026-09-03T10:00:00Z', completed_at: null, status: 'in_progress' },
          { started_at: '2026-09-02T10:00:00Z', completed_at: '2026-09-02T10:10:00Z', status: 'completed', score: 4, total_questions: 5 },
        ],
        error: null,
      },
    ];

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.streak).toBe(2);
    expect(body.records.find((r: any) => r.date === '2026-09-03')?.quiz_started).toBe(true);
    expect(body.records.find((r: any) => r.date === '2026-09-03')?.quiz_taken).toBe(false);
    vi.useRealTimers();
  });

  it('sums multiple reading logs recorded on the same day', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const today = new Date();
    today.setHours(9, 0, 0, 0);
    const laterToday = new Date(today);
    laterToday.setHours(18, 0, 0, 0);

    responseQueue = [
      {
        data: [
          { created_at: today.toISOString(), metadata: { read_seconds: 60 } },
          { created_at: laterToday.toISOString(), metadata: { read_seconds: 90 } },
        ],
        error: null,
      },
      { data: [], error: null },
    ];

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.records).toHaveLength(1);
    expect(body.records[0].read_seconds).toBe(150);
  });

  it('defaults quiz_total to 5 on the highest-score branch when total_questions is null', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const today = new Date();
    today.setHours(12, 0, 0, 0);

    responseQueue = [
      { data: [], error: null },
      {
        data: [
          { completed_at: today.toISOString(), score: 1, total_questions: 5 },
          { completed_at: today.toISOString(), score: 4, total_questions: null },
        ],
        error: null,
      },
    ];

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.records[0].quiz_score).toBe(4);
    expect(body.records[0].quiz_total).toBe(5);
  });

  it('degrades to empty records when PostgREST reports the table is not in the schema cache', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    responseQueue = [
      {
        data: null,
        error: {
          code: 'PGRST205',
          message: "Could not find the table 'public.user_activity_logs' in the schema cache",
        },
      },
    ];

    const res = await GET(mockRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, records: [], streak: 0 });
  });

  it('still reports quiz activity when only the reading-log table is missing', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const today = new Date();
    today.setHours(12, 0, 0, 0);

    responseQueue = [
      { data: null, error: { code: 'PGRST205', message: 'schema cache' } }, // user_activity_logs missing
      { data: [{ completed_at: today.toISOString(), score: 4, total_questions: 5 }], error: null },
    ];

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.records).toHaveLength(1);
    expect(body.records[0].quiz_score).toBe(4);
    expect(body.streak).toBe(1);
  });

  it('ignores a PGRST205 error from the quiz_attempts table', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    responseQueue = [
      { data: [], error: null },
      { data: null, error: { code: 'PGRST205', message: 'schema cache' } },
    ];

    const res = await GET(mockRequest());
    expect(res.status).toBe(200);
  });
});

describe('POST /api/activity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    responseQueue = [];
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-key';
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(mockRequest({ date: '2026-08-01' }));
    expect(res.status).toBe(401);
  });

  it('requires a date', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const res = await POST(mockRequest({}));
    expect(res.status).toBe(400);
  });

  it('creates a new record when none exists for the date', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    responseQueue = [
      { data: null, error: null }, // insert result
    ];

    const res = await POST(mockRequest({ date: '2026-08-01', readSeconds: 60 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('accumulates read seconds onto an existing record', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    responseQueue = [
      { data: null, error: null }, // update result
    ];

    const res = await POST(mockRequest({ date: '2026-08-01', readSeconds: 60, quizScore: 2, quizTotal: 3 }));
    expect(res.status).toBe(200);
  });

  it('simulates success when the table does not exist', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    responseQueue = [
      { data: null, error: { code: '42P01' } }, // insert fails: table missing
    ];

    const res = await POST(mockRequest({ date: '2026-08-01', readSeconds: 60 }));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain('Simulated');
  });

  it('returns a 500 for any other DB error on write', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    responseQueue = [
      { data: null, error: { code: 'XX000', message: 'write failed' } },
    ];

    const res = await POST(mockRequest({ date: '2026-08-01', readSeconds: 60 }));
    expect(res.status).toBe(500);
  });
  it('skips the reading insert when readSeconds is zero', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    responseQueue = [];

    const res = await POST(mockRequest({ date: '2026-08-01', readSeconds: 0 }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.message).toBe('Activity logged successfully');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('logs a quiz submission and syncs the result to the blog service', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockFetch.mockResolvedValue({ ok: true });
    responseQueue = [
      { data: null, error: null }, // quiz_submit insert
    ];

    const res = await POST(mockRequest({ date: '2026-08-01', quizScore: 4, quizTotal: 5 }));
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('http://blog-service.test/profiles/u1/quiz');
    expect(JSON.parse(init.body)).toEqual({ score: 4, total: 5 });
  });

  it('does not sync to the blog service when quizTotal is missing', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    responseQueue = [{ data: null, error: null }];

    const res = await POST(mockRequest({ date: '2026-08-01', quizScore: 4 }));
    expect(res.status).toBe(200);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('still succeeds when the blog service sync fails', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockFetch.mockRejectedValue(new Error('service down'));
    responseQueue = [{ data: null, error: null }];

    const res = await POST(mockRequest({ date: '2026-08-01', quizScore: 4, quizTotal: 5 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('simulates success when the table is missing on the quiz insert', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockFetch.mockResolvedValue({ ok: true });
    responseQueue = [{ data: null, error: { code: '42P01' } }];

    const res = await POST(mockRequest({ date: '2026-08-01', quizScore: 1, quizTotal: 5 }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.message).toContain('Simulated');
  });

  it('returns a 500 for any other DB error on the quiz insert', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    responseQueue = [{ data: null, error: { code: 'XX000', message: 'quiz write failed' } }];

    const res = await POST(mockRequest({ date: '2026-08-01', quizScore: 1, quizTotal: 5 }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('quiz write failed');
  });

  it('returns a 500 when the request body is not valid JSON', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const bad = new Request('http://localhost/api/activity', { method: 'POST', body: 'not-json' });

    const res = await POST(bad);
    expect(res.status).toBe(500);
  });
  it('simulates success when PostgREST reports the log table is not in the schema cache', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    responseQueue = [
      {
        data: null,
        error: {
          code: 'PGRST205',
          message: "Could not find the table 'public.user_activity_logs' in the schema cache",
        },
      },
    ];

    const res = await POST(mockRequest({ date: '2026-08-25', readSeconds: 60 }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toContain('Simulated');
  });

  it('simulates success when the quiz log insert hits a missing table', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockFetch.mockResolvedValue({ ok: true });
    responseQueue = [{ data: null, error: { code: 'PGRST205', message: 'schema cache' } }];

    const res = await POST(mockRequest({ date: '2026-08-25', quizScore: 3, quizTotal: 5 }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.message).toContain('Simulated');
  });
});
