import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { NextResponse } from 'next/server';

const mockGetUser = vi.fn();
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockEq = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();

// Mock Supabase Server Client (for auth)
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(() => ({
    auth: {
      getUser: mockGetUser
    }
  }))
}));

// Mock Supabase Admin Client (for DB operations)
vi.mock('@/lib/supabase/admin', () => {
  return {
    supabaseAdmin: {
      from: vi.fn(() => {
        const chain: any = {
          select: vi.fn().mockReturnThis(),
          insert: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          single: vi.fn().mockReturnThis(),
          then: vi.fn((resolve) => {
            resolve(mockDbResponse);
          })
        };
        return chain;
      })
    }
  };
});

let mockDbResponse: any = {};

describe('POST /api/quizzes/start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbResponse = {};
  });

  const mockRequest = (body: any) => new Request('http://localhost:3000/api/quizzes/start', {
    method: 'POST',
    body: JSON.stringify(body)
  });

  it('should return 401 if user is not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    
    const response = await POST(mockRequest({ blogId: 1 }));
    expect(response.status).toBe(401);
  });

  it('should return 400 if blogId is missing', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } } });
    
    const response = await POST(mockRequest({}));
    expect(response.status).toBe(400);
  });

  it('should return error if quiz is already completed', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } } });
    
    // Mock the 'quiz_attempts' select count check returning 1
    mockDbResponse = { count: 1, error: null };

    const response = await POST(mockRequest({ blogId: 1 }));
    const data = await response.json();
    
    expect(response.status).toBe(403);
    expect(data.error).toBe('You have already attempted the quiz for this blog.');
  });
});
