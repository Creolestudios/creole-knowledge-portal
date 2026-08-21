import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';

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

describe('GET /api/quizzes/history', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    (createClient as any).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });

    const req = new Request('http://localhost:3000/api/quizzes/history');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe('Unauthorized');
  });

  it('returns quiz history with mapped blog titles and valid timestamps', async () => {
    (createClient as any).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }),
      },
    });

    const mockAttempts = [
      {
        id: 'att-1',
        score: 4,
        percentage: 80,
        time_taken_seconds: 120,
        completed_at: '2026-08-20T10:00:00Z',
        started_at: '2026-08-20T09:58:00Z',
        status: 'completed',
        blog_id: 'blog-1',
      },
      {
        id: 'att-2',
        score: null,
        percentage: null,
        time_taken_seconds: null,
        completed_at: null,
        started_at: '2026-08-21T08:00:00Z',
        status: 'in_progress',
        blog_id: 'blog-2',
      },
    ];

    const attemptsSelectMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({ data: mockAttempts, error: null }),
      }),
    });

    const blogsSelectMock = vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue({
        data: [
          { id: 'blog-1', title: 'React 19 Deep Dive' },
          { id: 'blog-2', title: 'FastAPI Async Guide' },
        ],
      }),
    });

    (supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'quiz_attempts') return { select: attemptsSelectMock };
      if (table === 'blogs') return { select: blogsSelectMock };
      return {};
    });

    const req = new Request('http://localhost:3000/api/quizzes/history');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.history).toHaveLength(2);
    expect(json.history[0].blog_title).toBe('React 19 Deep Dive');
    expect(json.history[0].started_at).toBe('2026-08-20T09:58:00Z');
    expect(json.history[1].blog_title).toBe('FastAPI Async Guide');
    expect(json.history[1].started_at).toBe('2026-08-21T08:00:00Z');
  });

  it('handles database error gracefully', async () => {
    (createClient as any).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }),
      },
    });

    (supabaseAdmin.from as any).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: null, error: { message: 'db error' } }),
        }),
      }),
    });

    const req = new Request('http://localhost:3000/api/quizzes/history');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Internal Server Error');
  });
});
