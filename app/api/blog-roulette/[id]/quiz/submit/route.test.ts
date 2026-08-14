import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockRequireUserAndBlog = vi.fn();
vi.mock('@/lib/blog-roulette/route-helpers', () => ({
  requireUserAndBlog: (...args: any[]) => mockRequireUserAndBlog(...args),
}));

const mockGeminiGenerate = vi.fn();
const mockFallbackGradeAnswers = vi.fn();
vi.mock('@/lib/blog-roulette/gemini-client', () => ({
  geminiGenerate: (...args: any[]) => mockGeminiGenerate(...args),
  fallbackGradeAnswers: (...args: any[]) => mockFallbackGradeAnswers(...args),
}));

const mockRunPublishPipeline = vi.fn();
vi.mock('@/lib/blog-roulette/publisher', () => ({
  runPublishPipeline: (...args: any[]) => mockRunPublishPipeline(...args),
}));

let tableQueues: Record<string, any[]>;

function makeBuilder(table: string) {
  const take = () => {
    const q = tableQueues[table] ?? [];
    return q.length > 0 ? q.shift() : { data: null, error: null };
  };
  const b: any = {
    select: vi.fn(() => b),
    eq: vi.fn(() => b),
    is: vi.fn(() => b),
    insert: vi.fn(() => b),
    update: vi.fn(() => b),
    order: vi.fn(() => b),
    limit: vi.fn(() => b),
    single: vi.fn(() => Promise.resolve(take())),
    maybeSingle: vi.fn(() => Promise.resolve(take())),
    then: (resolve: any) => resolve(take()),
  };
  return b;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    from: vi.fn((t: string) => makeBuilder(t)),
  }),
}));

import { POST } from './route';

/** Re-import with a Gemini key present so the LLM grading branch runs. */
async function importWithGeminiKey() {
  vi.resetModules();
  vi.stubEnv('GEMINI_API_KEY', 'test-key');
  vi.stubEnv('MOCK_AI_PIPELINE', 'false');
  return (await import('./route')).POST;
}

function ctx(id = 'blog-1') {
  return { params: Promise.resolve({ id }) };
}

function req(answers: unknown = ['answer one', 'answer two', 'answer three']) {
  return new Request('http://x', { method: 'POST', body: JSON.stringify({ answers }) });
}

const QUESTIONS = [
  { q: 'Q1', expected_topic: 'T1' },
  { q: 'Q2', expected_topic: 'T2' },
  { q: 'Q3', expected_topic: 'T3' },
];

function attempt(overrides: Partial<any> = {}) {
  return {
    id: 'attempt-1',
    attempt_number: 1,
    questions: QUESTIONS,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function authed(status = 'QUIZ_IN_PROGRESS') {
  return { user: { id: 'u1', email: 'dev@x.com' }, blog: { id: 'blog-1', status } };
}

describe('POST /api/blog-roulette/[id]/quiz/submit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tableQueues = {};
    vi.stubEnv('MOCK_AI_PIPELINE', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects a malformed answers payload before touching auth', async () => {
    const res = await POST(req(['only one']), ctx());
    expect(res.status).toBe(400);
    expect(mockRequireUserAndBlog).not.toHaveBeenCalled();
  });

  it('returns the auth helper error response as-is', async () => {
    const errorResponse = new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    mockRequireUserAndBlog.mockResolvedValue({ error: errorResponse });

    const res = await POST(req(), ctx());
    expect(res).toBe(errorResponse);
  });

  it('rejects submitting when the blog is not awaiting a quiz', async () => {
    mockRequireUserAndBlog.mockResolvedValue(authed('DRAFT'));

    const res = await POST(req(), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('Cannot submit in status');
  });

  it('returns 409 when there is no active attempt', async () => {
    mockRequireUserAndBlog.mockResolvedValue(authed());
    tableQueues = { roulette_quiz_attempts: [{ data: null }] };

    const res = await POST(req(), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('No active attempt');
  });

  it('grades a perfect score as PASS and kicks off the publish pipeline', async () => {
    mockRequireUserAndBlog.mockResolvedValue(authed());
    mockFallbackGradeAnswers.mockReturnValue({ correct: 3, per: [true, true, true] });
    mockRunPublishPipeline.mockResolvedValue({});
    tableQueues = {
      roulette_quiz_attempts: [{ data: attempt() }, { error: null }],
      roulette_blogs: [{ error: null }],
    };

    const res = await POST(req(), ctx());
    const body = await res.json();
    expect(body.passed).toBe(true);
    expect(body.result).toBe('PASS');
    expect(body.next_status).toBe('PASSED');
    expect(mockRunPublishPipeline).toHaveBeenCalledWith('blog-1', expect.anything(), 'dev@x.com');
  });

  it('treats fewer than 2 correct as an immediate hard rejection', async () => {
    mockRequireUserAndBlog.mockResolvedValue(authed());
    mockFallbackGradeAnswers.mockReturnValue({ correct: 1, per: [true, false, false] });
    tableQueues = {
      roulette_quiz_attempts: [{ data: attempt() }, { error: null }],
      roulette_blogs: [{ error: null }],
    };

    const res = await POST(req(), ctx());
    const body = await res.json();
    expect(body.result).toBe('REJECT');
    expect(body.next_status).toBe('REJECTED');
    expect(body.can_retry).toBe(false);
    expect(mockRunPublishPipeline).not.toHaveBeenCalled();
  });

  it('treats 2 correct on a first attempt as a retryable soft fail', async () => {
    mockRequireUserAndBlog.mockResolvedValue(authed());
    mockFallbackGradeAnswers.mockReturnValue({ correct: 2, per: [true, true, false] });
    tableQueues = {
      roulette_quiz_attempts: [{ data: attempt({ attempt_number: 1 }) }, { error: null }],
      roulette_blogs: [{ error: null }],
    };

    const res = await POST(req(), ctx());
    const body = await res.json();
    expect(body.result).toBe('SOFT_FAIL');
    expect(body.next_status).toBe('SUBMITTED');
    expect(body.can_retry).toBe(true);
  });

  it('treats 2 correct past the retry limit as a rejection', async () => {
    mockRequireUserAndBlog.mockResolvedValue(authed());
    mockFallbackGradeAnswers.mockReturnValue({ correct: 2, per: [true, true, false] });
    tableQueues = {
      // attempt_number 2 > QUIZ_RETRY_LIMIT (1) -> last attempt
      roulette_quiz_attempts: [
        { data: attempt({ attempt_number: 2 }) },
        { data: null }, // prev attempt lookup
        { error: null },
      ],
      roulette_blogs: [{ error: null }],
    };

    const res = await POST(req(), ctx());
    const body = await res.json();
    expect(body.result).toBe('REJECT');
    expect(body.can_retry).toBe(false);
  });

  it('preserves previously-correct answers when re-grading a retry', async () => {
    mockRequireUserAndBlog.mockResolvedValue(authed());
    // This run only gets Q3 right, but Q1 was already correct in attempt 1.
    mockFallbackGradeAnswers.mockReturnValue({ correct: 1, per: [false, false, true] });
    const prevQuestions = [
      { q: 'Q1', expected_topic: 'T1', correct: true },
      { q: 'Q2', expected_topic: 'T2', correct: false },
      { q: 'Q3', expected_topic: 'T3', correct: false },
    ];
    tableQueues = {
      roulette_quiz_attempts: [
        { data: attempt({ attempt_number: 2 }) },
        { data: { attempt_number: 1, questions: prevQuestions } },
        { error: null },
      ],
      roulette_blogs: [{ error: null }],
    };

    const res = await POST(req(), ctx());
    const body = await res.json();
    // Q1 carried over as correct + Q3 correct this time = 2.
    expect(body.per_question).toEqual([true, false, true]);
    expect(body.correct).toBe(2);
  });

  it('auto-fails an expired attempt as a soft fail', async () => {
    mockRequireUserAndBlog.mockResolvedValue(authed());
    const stale = new Date(Date.now() - 10 * 60_000).toISOString();
    tableQueues = {
      roulette_quiz_attempts: [{ data: attempt({ created_at: stale }) }, { error: null }],
      roulette_blogs: [{ error: null }],
    };

    const res = await POST(req(), ctx());
    const body = await res.json();
    expect(body.passed).toBe(false);
    expect(body.correct).toBe(0);
    expect(body.result).toBe('SOFT_FAIL');
    expect(body.error).toContain('Time expired');
    expect(mockFallbackGradeAnswers).not.toHaveBeenCalled();
  });

  it('auto-rejects an expired attempt that is past the retry limit', async () => {
    mockRequireUserAndBlog.mockResolvedValue(authed());
    const stale = new Date(Date.now() - 10 * 60_000).toISOString();
    tableQueues = {
      roulette_quiz_attempts: [
        { data: attempt({ attempt_number: 2, created_at: stale }) },
        { data: null },
        { error: null },
      ],
      roulette_blogs: [{ error: null }],
    };

    const res = await POST(req(), ctx());
    const body = await res.json();
    expect(body.result).toBe('REJECT');
    expect(body.next_status).toBe('REJECTED');
  });

  it('grades with Gemini when a key is configured', async () => {
    mockRequireUserAndBlog.mockResolvedValue(authed());
    mockGeminiGenerate.mockResolvedValue('[true, true, true]');
    const POST = await importWithGeminiKey();
    tableQueues = {
      roulette_quiz_attempts: [{ data: attempt() }, { error: null }],
      roulette_blogs: [{ error: null }],
    };

    const res = await POST(req(), ctx());
    const body = await res.json();
    expect(body.passed).toBe(true);
    expect(mockGeminiGenerate).toHaveBeenCalled();
    expect(mockFallbackGradeAnswers).not.toHaveBeenCalled();
  });

  it('falls back to rule-based grading when Gemini returns an unusable shape', async () => {
    mockRequireUserAndBlog.mockResolvedValue(authed());
    mockGeminiGenerate.mockResolvedValue('[true]'); // wrong length
    mockFallbackGradeAnswers.mockReturnValue({ correct: 3, per: [true, true, true] });
    const POST = await importWithGeminiKey();
    tableQueues = {
      roulette_quiz_attempts: [{ data: attempt() }, { error: null }],
      roulette_blogs: [{ error: null }],
    };

    const res = await POST(req(), ctx());
    expect(res.status).toBe(200);
    expect(mockFallbackGradeAnswers).toHaveBeenCalled();
  });

  it('falls back to rule-based grading when the Gemini call throws', async () => {
    mockRequireUserAndBlog.mockResolvedValue(authed());
    mockGeminiGenerate.mockRejectedValue(new Error('rate limited'));
    mockFallbackGradeAnswers.mockReturnValue({ correct: 0, per: [false, false, false] });
    const POST = await importWithGeminiKey();
    tableQueues = {
      roulette_quiz_attempts: [{ data: attempt() }, { error: null }],
      roulette_blogs: [{ error: null }],
    };

    const res = await POST(req(), ctx());
    expect(res.status).toBe(200);
    expect(mockFallbackGradeAnswers).toHaveBeenCalled();
  });
});
