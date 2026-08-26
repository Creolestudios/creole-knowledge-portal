import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';

const mockGetUser = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();

// Mock Supabase Server Client
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(() => ({
    auth: {
      getUser: mockGetUser
    }
  }))
}));

// Mock Supabase Admin Client
vi.mock('@/lib/supabase/admin', () => {
  return {
    supabaseAdmin: {
      from: vi.fn(() => {
        const chain: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          single: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          then: vi.fn((resolve) => {
            const res = mockDbResponses.length > 0 ? mockDbResponses.shift() : { data: null, error: null };
            resolve(res);
          })
        };
        return chain;
      })
    }
  };
});

let mockDbResponses: any[] = [];

describe('GET /api/quizzes/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbResponses = [];
  });

  const mockRequest = (url: string) => new Request(url);

  it('should return completed true if attempt is finished', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } } });

    mockDbResponses = [
      { data: [{ id: 'a1', status: 'completed', score: 6, percentage: 75, time_taken_seconds: 120, total_questions: 5 }], error: null },
      { data: { quiz_answers: Array(5).fill({ question_id: 'q1' }) }, error: null }, // fullAttempt
      { data: [{ id: 'q1', question_type: 'single' }], error: null } // questions
    ];

    const response = await GET(mockRequest('http://localhost:3000/api/quizzes/status?blogId=1'));
    const data = await response.json();

    expect(data.completed).toBe(true);
    expect(data.result.score).toBe(6);
    expect(data.result.timeTaken).toBe(120);
  });

  it('should accurately calculate timeLeft based on wall-clock', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } } });

    // Simulate started 40 seconds ago
    const startedAt = new Date(Date.now() - 40000).toISOString();

    mockDbResponses = [
      { data: [{ id: 'attempt-123', status: 'in_progress', started_at: startedAt }], error: null }, // attempts
      { data: [{ question_id: 'q1', user_answer: 'ans' }], error: null }, // activeAnswers
      { data: [{ id: 'q1', question_type: 'single', difficulty: 'easy', question: 'Q?', options: null, code_snippet: null }], error: null } // questions
    ];

    const response = await GET(mockRequest('http://localhost:3000/api/quizzes/status?blogId=1'));
    const data = await response.json();

    expect(data.inProgress).toBe(true);
    expect(data.timeLeft).toBeGreaterThanOrEqual(1158);
    expect(data.timeLeft).toBeLessThanOrEqual(1162);
  });

  it('should return inProgress false if no attempt exists', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } } });

    mockDbResponses = [
      { data: [], error: null }
    ];

    const response = await GET(mockRequest('http://localhost:3000/api/quizzes/status?blogId=1'));
    const data = await response.json();

    expect(data.completed).toBe(false);
    expect(data.inProgress).toBe(false);
  });

  it('returns 401 when there is no authenticated user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const response = await GET(mockRequest('http://localhost:3000/api/quizzes/status?blogId=1'));
    expect(response.status).toBe(401);
  });

  it('returns 400 when blogId is missing', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } } });
    const response = await GET(mockRequest('http://localhost:3000/api/quizzes/status'));
    expect(response.status).toBe(400);
  });

  it('auto-completes an in-progress attempt once the timer expires', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } } });
    const startedAt = new Date(Date.now() - 1_300_000).toISOString();

    mockDbResponses = [
      {
        data: [{
          id: 'attempt-exp',
          status: 'in_progress',
          started_at: startedAt,
          blog_id: '1',
          total_questions: 5,
        }],
        error: null,
      },
      { data: { quiz_answers: [{ points_awarded: 2, question_id: 'q1', is_correct: true }] }, error: null },
      { data: [{ id: 'q1', question_type: 'single' }], error: null },
      { data: [], error: null },
      {
        data: {
          quiz_answers: [{
            points_awarded: 2,
            question_id: 'q1',
            is_correct: true,
            user_answer: 'A',
            evaluation_reason: '',
          }],
        },
        error: null,
      },
    ];

    const response = await GET(mockRequest('http://localhost:3000/api/quizzes/status?blogId=1'));
    const data = await response.json();

    expect(data.completed).toBe(true);
    expect(data.result.timeTaken).toBe(600);
    expect(data.result.score).toBe(2);
  });

  it('returns 500 when the status lookup throws', async () => {
    mockGetUser.mockRejectedValue(new Error('auth down'));
    const response = await GET(mockRequest('http://localhost:3000/api/quizzes/status?blogId=1'));
    expect(response.status).toBe(500);
  });
});
