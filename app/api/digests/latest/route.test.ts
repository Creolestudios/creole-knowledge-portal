import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(() => ({ auth: { getUser: mockGetUser } })),
}));

let mockDbResponses: any[] = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => {
      const chain: any = {
        select: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => {
          const res = mockDbResponses.length > 0 ? mockDbResponses.shift() : { data: null, error: null };
          resolve(res);
        }),
      };
      return chain;
    }),
  },
}));

describe('GET /api/digests/latest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbResponses = [];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, blog: null }),
    });
  });

  it('returns 401 when there is no session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('falls back to the legacy daily briefing when no active series exists', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockDbResponses = [
      { data: [], error: null }, // series blogs
      { data: [{ id: 'brief-1', title: 'Daily Briefing' }], error: null }, // legacy brief
    ];

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.blog).toEqual({ id: 'brief-1', title: 'Daily Briefing' });
  });

  it('returns the current unlocked series part from Supabase', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, blog: null }),
    });
    mockDbResponses = [
      {
        data: [
          {
            id: 'part-1',
            published_at: '2026-08-01T00:00:00Z',
            summary: JSON.stringify({
              seriesId: 's1',
              seriesTitle: 'Async Python',
              partNumber: 1,
              totalParts: 2,
              readingTime: 12,
              completed: false,
              unlockedAt: new Date(Date.now() - 60_000).toISOString(),
            }),
          },
        ],
        error: null,
      },
    ];

    const res = await GET();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.blog.id).toBe('part-1');
    expect(body.meta.seriesId).toBe('s1');
    expect(body.meta.unlocked).toBe(true);
  });

  it('returns seriesCompleted when every part is done', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockDbResponses = [
      {
        data: [
          {
            id: 'part-1',
            published_at: '2026-08-01T00:00:00Z',
            summary: JSON.stringify({
              seriesId: 's1',
              partNumber: 1,
              completed: true,
              unlockedAt: '2026-08-01T00:00:00Z',
            }),
          },
        ],
        error: null,
      },
    ];

    const res = await GET();
    const body = await res.json();
    expect(body.seriesCompleted).toBe(true);
    expect(body.blog).toBeNull();
  });

  it('returns 500 when the series query fails', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockDbResponses = [{ data: null, error: { message: 'db down' } }];

    const res = await GET();
    expect(res.status).toBe(500);
  });

  it('returns the Celery/Mongo digest when the blog service has one', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        blog: { id: 'mongo-1', title: 'Morning Brief', content: '# hi' },
      }),
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.blog.title).toBe('Morning Brief');
  });
});
