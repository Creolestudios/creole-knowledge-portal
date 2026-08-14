import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockRequireUserAndBlog = vi.fn();
vi.mock('@/lib/blog-roulette/route-helpers', () => ({
  requireUserAndBlog: (...args: any[]) => mockRequireUserAndBlog(...args),
}));

const mockGeminiGenerate = vi.fn();
const mockFallbackQuizQuestions = vi.fn();
vi.mock('@/lib/blog-roulette/gemini-client', () => ({
  geminiGenerate: (...args: any[]) => mockGeminiGenerate(...args),
  fallbackQuizQuestions: (...args: any[]) => mockFallbackQuizQuestions(...args),
}));

/**
 * Chainable Supabase stub. Each `.from()` call pulls the next queued result
 * for that table; terminal awaits (`single`, `maybeSingle`, or awaiting the
 * builder itself) resolve to it.
 */
let tableQueues: Record<string, any[]>;

function makeBuilder(table: string) {
  const take = () => {
    const q = tableQueues[table] ?? [];
    return q.length > 0 ? q.shift() : { data: null, error: null, count: 0 };
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

/**
 * The route captures GEMINI_KEY at module-load time, so exercising the real
 * Gemini branch requires re-importing the module with the key stubbed first.
 */
async function importWithGeminiKey() {
  vi.resetModules();
  vi.stubEnv('GEMINI_API_KEY', 'test-key');
  vi.stubEnv('MOCK_AI_PIPELINE', 'false');
  return (await import('./route')).POST;
}

function ctx(id = 'blog-1') {
  return { params: Promise.resolve({ id }) };
}

const LONG_BODY = `<p>${'This is a long technical blog body about React and TypeScript. '.repeat(10)}</p>`;

const THREE_QS = [
  { q: 'Q1', expected_topic: 'T1' },
  { q: 'Q2', expected_topic: 'T2' },
  { q: 'Q3', expected_topic: 'T3' },
];

function draftBlog(status = 'SUBMITTED') {
  return { id: 'blog-1', status, body_html: LONG_BODY };
}

describe('POST /api/blog-roulette/[id]/quiz/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tableQueues = {};
    mockFallbackQuizQuestions.mockReturnValue(THREE_QS);
    vi.stubEnv('MOCK_AI_PIPELINE', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the auth helper error response as-is', async () => {
    const errorResponse = new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    mockRequireUserAndBlog.mockResolvedValue({ error: errorResponse });

    const res = await POST(new Request('http://x'), ctx());
    expect(res).toBe(errorResponse);
  });

  it('rejects generating a quiz when the blog is not in a quizzable status', async () => {
    mockRequireUserAndBlog.mockResolvedValue({ user: { id: 'u1' }, blog: draftBlog('DRAFT') });

    const res = await POST(new Request('http://x'), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('Cannot start quiz');
  });

  it('rejects generating a quiz when the body is too short', async () => {
    mockRequireUserAndBlog.mockResolvedValue({
      user: { id: 'u1' },
      blog: { status: 'SUBMITTED', body_html: '<p>too short</p>' },
    });

    const res = await POST(new Request('http://x'), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Body too short for quiz generation');
  });

  it('generates a first attempt with the fallback generator and strips expected_topic', async () => {
    mockRequireUserAndBlog.mockResolvedValue({ user: { id: 'u1' }, blog: draftBlog() });
    tableQueues = {
      roulette_quiz_attempts: [
        { count: 0 },                                   // attempt count
        { data: [] },                                   // incomplete attempts
        { data: { id: 'attempt-1', questions: THREE_QS, created_at: '2026-08-01T00:00:00Z' } }, // insert
      ],
      roulette_blogs: [{ error: null }],
    };

    const res = await POST(new Request('http://x'), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attempt_id).toBe('attempt-1');
    expect(body.questions).toEqual([{ q: 'Q1' }, { q: 'Q2' }, { q: 'Q3' }]);
    expect(body.questions[0]).not.toHaveProperty('expected_topic');
    expect(mockFallbackQuizQuestions).toHaveBeenCalled();
  });

  it('uses Gemini when a key is present and mock mode is off', async () => {
    mockRequireUserAndBlog.mockResolvedValue({ user: { id: 'u1' }, blog: draftBlog() });
    mockGeminiGenerate.mockResolvedValue(JSON.stringify(THREE_QS));
    const POST = await importWithGeminiKey();
    tableQueues = {
      roulette_quiz_attempts: [
        { count: 0 },
        { data: [] },
        { data: { id: 'attempt-1', questions: THREE_QS, created_at: '2026-08-01T00:00:00Z' } },
      ],
      roulette_blogs: [{ error: null }],
    };

    const res = await POST(new Request('http://x'), ctx());
    expect(res.status).toBe(200);
    expect(mockGeminiGenerate).toHaveBeenCalled();
    expect(mockFallbackQuizQuestions).not.toHaveBeenCalled();
  });

  it('falls back to the rule-based generator when Gemini returns non-JSON', async () => {
    mockRequireUserAndBlog.mockResolvedValue({ user: { id: 'u1' }, blog: draftBlog() });
    mockGeminiGenerate.mockResolvedValue('not json at all');
    const POST = await importWithGeminiKey();
    tableQueues = {
      roulette_quiz_attempts: [
        { count: 0 },
        { data: [] },
        { data: { id: 'attempt-1', questions: THREE_QS, created_at: '2026-08-01T00:00:00Z' } },
      ],
      roulette_blogs: [{ error: null }],
    };

    const res = await POST(new Request('http://x'), ctx());
    expect(res.status).toBe(200);
    expect(mockFallbackQuizQuestions).toHaveBeenCalled();
  });

  it('falls back when Gemini returns the wrong number of questions', async () => {
    mockRequireUserAndBlog.mockResolvedValue({ user: { id: 'u1' }, blog: draftBlog() });
    mockGeminiGenerate.mockResolvedValue(JSON.stringify([{ q: 'only one', expected_topic: 'x' }]));
    const POST = await importWithGeminiKey();
    tableQueues = {
      roulette_quiz_attempts: [
        { count: 0 },
        { data: [] },
        { data: { id: 'attempt-1', questions: THREE_QS, created_at: '2026-08-01T00:00:00Z' } },
      ],
      roulette_blogs: [{ error: null }],
    };

    const res = await POST(new Request('http://x'), ctx());
    expect(res.status).toBe(200);
    expect(mockFallbackQuizQuestions).toHaveBeenCalled();
  });

  it('reuses attempt-1 questions and reports incorrect indices on a retry', async () => {
    mockRequireUserAndBlog.mockResolvedValue({ user: { id: 'u1' }, blog: draftBlog('QUIZ_IN_PROGRESS') });
    const prevQuestions = [
      { q: 'Q1', expected_topic: 'T1', correct: true },
      { q: 'Q2', expected_topic: 'T2', correct: false },
      { q: 'Q3', expected_topic: 'T3', correct: false },
    ];
    tableQueues = {
      roulette_quiz_attempts: [
        { count: 1 },                                                    // -> attemptNumber 2
        { data: { attempt_number: 1, questions: prevQuestions, answers: ['a', 'b', 'c'] } }, // prev attempt
        { data: [] },                                                    // incomplete attempts
        { data: { id: 'attempt-2', questions: prevQuestions, created_at: '2026-08-01T00:00:00Z' } },
      ],
      roulette_blogs: [{ error: null }],
    };

    const res = await POST(new Request('http://x'), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.incorrect_indices).toEqual([1, 2]);
    expect(body.prev_answers).toEqual(['a', 'b', 'c']);
    // Reused from attempt 1 — the fallback generator must not run.
    expect(mockFallbackQuizQuestions).not.toHaveBeenCalled();
  });

  it('resumes an active (non-expired) incomplete attempt instead of creating a new one', async () => {
    mockRequireUserAndBlog.mockResolvedValue({ user: { id: 'u1' }, blog: draftBlog('QUIZ_IN_PROGRESS') });
    const recent = new Date(Date.now() - 60_000).toISOString(); // 1 min ago
    tableQueues = {
      roulette_quiz_attempts: [
        { count: 0 },
        { data: [{ id: 'active-attempt', attempt_number: 1, questions: THREE_QS, created_at: recent }] },
      ],
    };

    const res = await POST(new Request('http://x'), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attempt_id).toBe('active-attempt');
    expect(body.questions).toEqual([{ q: 'Q1' }, { q: 'Q2' }, { q: 'Q3' }]);
  });

  it('resumes an active retry attempt and surfaces the previous wrong answers', async () => {
    mockRequireUserAndBlog.mockResolvedValue({ user: { id: 'u1' }, blog: draftBlog('QUIZ_IN_PROGRESS') });
    const recent = new Date(Date.now() - 60_000).toISOString();
    const prevQuestions = [
      { q: 'Q1', expected_topic: 'T1', correct: false },
      { q: 'Q2', expected_topic: 'T2', correct: true },
      { q: 'Q3', expected_topic: 'T3', correct: true },
    ];
    tableQueues = {
      roulette_quiz_attempts: [
        { count: 1 },
        { data: { attempt_number: 1, questions: prevQuestions, answers: ['x', 'y', 'z'] } },
        { data: [{ id: 'active-2', attempt_number: 2, questions: THREE_QS, created_at: recent }] },
      ],
    };

    const res = await POST(new Request('http://x'), ctx());
    const body = await res.json();
    expect(body.attempt_id).toBe('active-2');
    expect(body.incorrect_indices).toEqual([0]);
    expect(body.prev_answers).toEqual(['x', 'y', 'z']);
  });

  it('expires a stale attempt as a soft fail and issues a fresh quiz', async () => {
    mockRequireUserAndBlog.mockResolvedValue({ user: { id: 'u1' }, blog: draftBlog('QUIZ_IN_PROGRESS') });
    const stale = new Date(Date.now() - 10 * 60_000).toISOString(); // 10 min ago
    tableQueues = {
      roulette_quiz_attempts: [
        { count: 0 },
        { data: [{ id: 'stale-1', attempt_number: 1, questions: THREE_QS, created_at: stale }] },
        { error: null }, // mark expired attempt completed
        { data: { id: 'attempt-new', questions: THREE_QS, created_at: '2026-08-01T00:00:00Z' } },
      ],
      roulette_blogs: [{ error: null }, { error: null }],
    };

    const res = await POST(new Request('http://x'), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).attempt_id).toBe('attempt-new');
  });

  it('locks the post with a 409 when a stale attempt exhausts the retry limit', async () => {
    mockRequireUserAndBlog.mockResolvedValue({ user: { id: 'u1' }, blog: draftBlog('QUIZ_IN_PROGRESS') });
    const stale = new Date(Date.now() - 10 * 60_000).toISOString();
    tableQueues = {
      roulette_quiz_attempts: [
        { count: 2 },
        { data: [{ id: 'stale-3', attempt_number: 3, questions: THREE_QS, created_at: stale }] },
        { error: null },
      ],
      roulette_blogs: [{ error: null }],
    };

    const res = await POST(new Request('http://x'), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('expired');
  });
});
