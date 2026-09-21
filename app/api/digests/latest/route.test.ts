import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(() => ({ auth: { getUser: mockGetUser } })),
}));

const mockEq = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();
const mockMaybeSingle = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => {
      const chain: any = {
        select: vi.fn().mockImplementation(() => chain),
        eq: vi.fn().mockImplementation(() => chain),
        ilike: vi.fn().mockImplementation(() => ({ order: mockOrder })),
        order: vi.fn().mockImplementation(() => ({ limit: mockLimit })),
        limit: vi.fn().mockImplementation(() => Promise.resolve({ data: [], error: null })),
        maybeSingle: mockMaybeSingle,
      };
      return chain;
    }),
  },
}));

vi.mock('@/lib/blog-service', () => ({
  blogServiceHeaders: () => ({}),
  blogServiceUrl: (path: string) => `http://blog.test${path}`,
}));

describe('GET /api/digests/latest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockLimit.mockReturnValue({
      then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    });
    // Make order().limit() thenable via returning chain that resolves on await
    mockOrder.mockImplementation(() => ({
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    }));
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

  it('returns blog null when FastAPI has no digest for today (synthesize)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, blog: null }),
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, blog: null, meta: null });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/digests/user-1/latest?today_only=true'),
      expect.any(Object),
    );
  });

  it('does not fall back to an older Supabase briefing when FastAPI says null', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockMaybeSingle.mockResolvedValue({
      data: { id: 'old-brief', title: 'Yesterday', published_at: '2026-08-01T00:00:00Z' },
      error: null,
    });

    const res = await GET();
    const body = await res.json();
    expect(body.blog).toBeNull();
  });

  it('returns the Celery/Mongo digest when it is for today', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const today = new Date();
    const digestDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        blog: { id: 'mongo-1', title: 'Morning Brief', content: '# hi', digest_date: digestDate },
      }),
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.blog.title).toBe('Morning Brief');
  });

  it('treats a non-today Mongo digest as missing (synthesize)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        blog: {
          id: 'mongo-old',
          title: 'Old Brief',
          digest_date: '2020-01-01',
        },
      }),
    });

    const res = await GET();
    const body = await res.json();
    expect(body.blog).toBeNull();
  });

  it('falls back to today\'s Supabase briefing when FastAPI is down', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    (global.fetch as any).mockRejectedValue(new Error('offline'));
    const today = new Date();
    const digestDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    mockMaybeSingle.mockResolvedValue({
      data: {
        id: 'brief-1',
        title: 'Daily Briefing',
        url: `briefing:user-1:${digestDate}`,
        published_at: `${digestDate}T08:00:00.000Z`,
      },
      error: null,
    });

    const res = await GET();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.blog.id).toBe('brief-1');
    expect(body.blog.digest_date).toBe(digestDate);
  });

  it('hides a Next.js filler briefing when Mongo has no digest today', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, blog: null }),
    });
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    mockMaybeSingle.mockResolvedValue({
      data: {
        id: 'fallback-1',
        title: 'Architectural Deep-Dive: Next.js 15',
        url: `briefing:user-1:${today}`,
        source: 'AI Resilient Synthesis Engine',
        published_at: `${today}T08:00:00.000Z`,
      },
      error: null,
    });

    const res = await GET();
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.blog).toBeNull();
  });

  it('returns 500 when the legacy Supabase lookup fails', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    (global.fetch as any).mockRejectedValue(new Error('offline'));
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'Legacy lookup exploded' },
    });

    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Legacy lookup exploded');
  });

  it('returns the most recent same-day briefing from the legacy fallback list', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    (global.fetch as any).mockRejectedValue(new Error('offline'));
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    mockOrder.mockImplementation(() => ({
      limit: vi.fn().mockResolvedValue({
        data: [{
          id: 'recent-brief',
          title: 'Recent Brief',
          url: `briefing:user-1:${today}`,
          published_at: `${today}T08:00:00.000Z`,
        }],
        error: null,
      }),
    }));

    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.blog.id).toBe('recent-brief');
    expect(body.blog.title).toBe('Recent Brief');
  });

  it('returns 500 when the recent legacy fallback query fails', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    (global.fetch as any).mockRejectedValue(new Error('offline'));
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockOrder.mockImplementation(() => ({
      limit: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Recent lookup exploded' },
      }),
    }));

    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Recent lookup exploded');
  });

  it('returns null for an invented legacy fallback briefing', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    (global.fetch as any).mockRejectedValue(new Error('offline'));
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    mockMaybeSingle.mockResolvedValue({
      data: {
        id: 'legacy-fallback',
        title: 'Invented fallback',
        url: `briefing:user-1:${today}`,
        source: 'AI Resilient Synthesis Engine',
        published_at: `${today}T08:00:00.000Z`,
      },
      error: null,
    });

    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.blog).toBeNull();
  });

  it('returns null for an invented recent fallback briefing', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    (global.fetch as any).mockRejectedValue(new Error('offline'));
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    mockOrder.mockImplementation(() => ({
      limit: vi.fn().mockResolvedValue({
        data: [{
          id: 'recent-fallback',
          title: 'Invented Recent',
          url: `briefing:user-1:${today}`,
          source: 'AI Resilient Synthesis Engine',
          published_at: `${today}T08:00:00.000Z`,
        }],
        error: null,
      }),
    }));

    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.blog).toBeNull();
  });

  it('returns 500 when an unexpected auth/query error bubbles out', async () => {
    mockGetUser.mockRejectedValue(new Error('unexpected auth boom'));

    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('unexpected auth boom');
  });

  it('returns null when the recent legacy candidate is stale', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    (global.fetch as any).mockRejectedValue(new Error('offline'));
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockOrder.mockImplementation(() => ({
      limit: vi.fn().mockResolvedValue({
        data: [{
          id: 'stale-brief',
          title: 'Stale Brief',
          url: 'briefing:user-1:2020-01-01',
          published_at: '2020-01-01T08:00:00.000Z',
        }],
        error: null,
      }),
    }));

    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.blog).toBeNull();
  });
});
