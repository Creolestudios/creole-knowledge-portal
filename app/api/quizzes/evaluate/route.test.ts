import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(() => ({ auth: { getUser: mockGetUser } })),
}));

const mockEvaluateDescriptiveAnswer = vi.fn();
vi.mock('@/lib/ai/quiz-evaluator', () => ({
  evaluateDescriptiveAnswer: (...args: any[]) => mockEvaluateDescriptiveAnswer(...args),
}));

let tableResponses: Record<string, any[]>;
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => {
          const queue = tableResponses[table] ?? [];
          const res = queue.length > 0 ? queue.shift() : { data: null, error: null };
          resolve(res);
        }),
      };
      return chain;
    }),
  },
}));

function mockRequest(body: unknown) {
  return new Request('http://localhost/api/quizzes/evaluate', { method: 'POST', body: JSON.stringify(body) });
}

describe('POST /api/quizzes/evaluate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tableResponses = {};
  });

  it('returns 401 when unauthenticated', async () => {
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
    tableResponses = { quiz_attempts: [{ data: { status: 'completed' }, error: null }] };

    const res = await POST(mockRequest({ attemptId: 'a1', questionId: 'q1', userAnswer: 'x' }));
    expect(res.status).toBe(403);
  });

  it('no-ops successfully when no question/answer is supplied yet (autosave heartbeat)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    tableResponses = { quiz_attempts: [{ data: { status: 'in_progress' }, error: null }] };

    const res = await POST(mockRequest({ attemptId: 'a1' }));
    const body = await res.json();
    expect(body).toEqual({ success: true });
  });

  it('returns 404 when the question does not exist', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    tableResponses = {
      quiz_attempts: [{ data: { status: 'in_progress' }, error: null }],
      quiz_questions: [{ data: null, error: null }],
    };

    const res = await POST(mockRequest({ attemptId: 'a1', questionId: 'q1', userAnswer: 'x' }));
    expect(res.status).toBe(404);
  });

  it('grades a single-choice question exactly and inserts a new answer', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    tableResponses = {
      quiz_attempts: [{ data: { status: 'in_progress' }, error: null }],
      quiz_questions: [{ data: { question_type: 'single', correct_answers: ['B'] }, error: null }],
      quiz_answers: [{ data: null, error: null }, { error: null }], // existing lookup -> none, then insert
    };

    const res = await POST(mockRequest({ attemptId: 'a1', questionId: 'q1', userAnswer: 'b' }));
    const body = await res.json();
    expect(body.isCorrect).toBe(true);
    expect(body.pointsAwarded).toBe(1);
  });

  it('grades a multiple-choice question by unordered set comparison', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    tableResponses = {
      quiz_attempts: [{ data: { status: 'in_progress' }, error: null }],
      quiz_questions: [
        { data: { question_type: 'multiple', correct_answers: ['A', 'B'] }, error: null },
      ],
      quiz_answers: [{ data: { id: 'existing-answer' }, error: null }, { error: null }], // update path
    };

    const res = await POST(mockRequest({ attemptId: 'a1', questionId: 'q1', userAnswer: ['b', 'a'] }));
    const body = await res.json();
    expect(body.isCorrect).toBe(true);
    expect(body.pointsAwarded).toBe(2);
  });

  it('delegates conceptual/descriptive grading to the AI evaluator', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    tableResponses = {
      quiz_attempts: [{ data: { status: 'in_progress' }, error: null }],
      quiz_questions: [
        { data: { question_type: 'conceptual', question: 'Explain X', correct_answers: ['topic'] }, error: null },
      ],
      quiz_answers: [{ data: null, error: null }, { error: null }],
    };
    mockEvaluateDescriptiveAnswer.mockResolvedValue({ isCorrect: true, points: 1, reason: 'Good answer' });

    const res = await POST(mockRequest({ attemptId: 'a1', questionId: 'q1', userAnswer: 'my answer' }));
    const body = await res.json();
    expect(body.isCorrect).toBe(true);
    expect(body.evaluationReason).toBe('Good answer');
  });
});
