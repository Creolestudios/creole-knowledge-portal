// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

function mockRequest(body: unknown, cookieHeader?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (cookieHeader) {
    headers['cookie'] = cookieHeader;
  }
  return new Request('http://localhost/api/quizzes/submit', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /api/quizzes/submit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 if user is not authenticated', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });

    const res = await POST(mockRequest({ quizId: 'q1', answers: [], timeTakenSec: 10 }));
    expect(res.status).toBe(401);
  });

  it('returns 400 if required fields are missing', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    });

    const res = await POST(mockRequest({ quizId: 'q1' }));
    expect(res.status).toBe(400);
  });

  it('returns 404 if blog source is not found', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    });

    (supabaseAdmin.from as any).mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
        }),
      }),
    }));

    const res = await POST(mockRequest({ quizId: 'nonexistent', answers: [], timeTakenSec: 10 }));
    expect(res.status).toBe(404);
  });

  it('returns 400 if blog content contains no quiz comments', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    });

    (supabaseAdmin.from as any).mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'b1', content: 'No quiz here' }, error: null }),
        }),
      }),
    }));

    const res = await POST(mockRequest({ quizId: 'b1', answers: [], timeTakenSec: 10 }));
    expect(res.status).toBe(400);
  });

  it('grades quiz answers and updates XP, coins, and streak', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    });

    const quizComment = `<!-- QUIZ_DATA: {"questions":[{"id":"q1","text":"Q1","correctAnswer":"A"},{"id":"q2","text":"Q2","correctAnswer":"B"}]} -->`;
    const blogData = { id: 'b1', content: quizComment };

    (supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'blogs') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: blogData, error: null }),
            }),
          }),
        };
      }
      if (table === 'user_profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { xp: 100, coins: 50 }, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      if (table === 'streaks') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { current_streak: 2, longest_streak: 5, last_active_date: '2026-08-20' },
                error: null,
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        };
      }
      return {
        insert: vi.fn().mockResolvedValue({ error: null }),
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      };
    });

    const res = await POST(
      mockRequest({
        quizId: 'b1',
        answers: [
          { questionId: 'q1', userAnswer: 'A' },
          { questionId: 'q2', userAnswer: 'B' },
        ],
        timeTakenSec: 30,
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.score).toBe(2);
    expect(body.data.isPerfect).toBe(true);
    expect(body.data.xpEarned).toBe(140);
  });

  it('handles mock_gamification_stats cookie and quiz_attempts passed column error', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    });

    const quizComment = `<!-- QUIZ_DATA: {"questions":[{"id":"q1","text":"Q1","correctAnswer":"A"}]} -->`;
    const blogData = { id: 'b1', content: quizComment };
    const mockCookie = `mock_gamification_stats=${encodeURIComponent(JSON.stringify({ xp: 500, coins: 100, currentStreak: 4, longestStreak: 10 }))}`;

    (supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'blogs') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: blogData, error: null }),
            }),
          }),
        };
      }
      if (table === 'user_profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { xp: 500, coins: 100 }, error: null }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: { message: 'column level does not exist' } }),
          }),
        };
      }
      if (table === 'quiz_attempts') {
        return {
          insert: vi.fn().mockResolvedValueOnce({ error: { code: '42703', message: 'column passed does not exist' } }).mockResolvedValueOnce({ error: null }),
        };
      }
      return {
        insert: vi.fn().mockResolvedValue({ error: null }),
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      };
    });

    const res = await POST(
      mockRequest(
        {
          quizId: 'b1',
          answers: [{ questionId: 'q1', userAnswer: 'A' }],
          timeTakenSec: 10,
        },
        mockCookie
      )
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('handles speed violation anti-cheat trigger', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    });

    const quizComment = `<!-- QUIZ_DATA: {"questions":[{"id":"q1","text":"Q1","correctAnswer":"A"}]} -->`;
    const blogData = { id: 'b1', content: quizComment };

    (supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'blogs') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: blogData, error: null }),
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
        insert: vi.fn().mockResolvedValue({ error: null }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      };
    });

    const res = await POST(
      mockRequest({
        quizId: 'b1',
        answers: [{ questionId: 'q1', userAnswer: 'A' }],
        timeTakenSec: 0.5,
      })
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.speedViolation).toBe(true);
    expect(body.data.xpEarned).toBe(0);
  });
});
