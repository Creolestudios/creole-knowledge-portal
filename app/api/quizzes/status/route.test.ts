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
    
    // Return a completed attempt
    mockDbResponses = [
      { data: [{ status: 'completed', score: 6, percentage: 75, time_taken_seconds: 120, total_questions: 5 }], error: null }
    ];

    const response = await GET(mockRequest('http://localhost:3000/api/quizzes/status?blogId=1'));
    const data = await response.json();
    
    expect(data.completed).toBe(true);
    expect(data.result.score).toBe(6);
    expect(data.result.timeTaken).toBe(120);
  });

  it('should accurately calculate timeLeft based on time_taken_seconds heartbeat', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } } });
    
    mockDbResponses = [
      { data: [{ id: 'attempt-123', status: 'in_progress', time_taken_seconds: 400 }], error: null }, // attempts
      { data: [], error: null }, // questions
      { data: [], error: null }  // answers
    ];

    const response = await GET(mockRequest('http://localhost:3000/api/quizzes/status?blogId=1'));
    const data = await response.json();
    
    expect(data.inProgress).toBe(true);
    expect(data.timeLeft).toBe(200); // 600 max - 400 taken = 200 left
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
});
