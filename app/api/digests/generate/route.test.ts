import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(() => ({ auth: { getUser: mockGetUser } })),
}));

vi.mock('@/lib/dev/mock-user', () => ({
  mockUserFromCookie: vi.fn().mockReturnValue(null),
}));

vi.mock('@/lib/blog-service', () => ({
  blogServiceHeaders: () => ({}),
  blogServiceUrl: (path: string) => `http://blog.test${path}`,
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) }),
}));

function mockRequest(body: unknown) {
  return new Request('http://localhost/api/digests/generate', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function todayKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function mockFastApiDown() {
  (global.fetch as any).mockRejectedValue(new Error('ECONNREFUSED'));
}

describe('POST /api/digests/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('returns 401 when there is no session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(mockRequest({}));
    expect(res.status).toBe(401);
  });

  it("returns today's existing digest without regenerating", async () => {
    const digestDate = todayKey();
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        blog: { id: 'cached-1', title: 'Already Today', digest_date: digestDate },
      }),
    });

    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const res = await POST(mockRequest({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cached).toBe(true);
    expect(body.blog.title).toBe('Already Today');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not treat an invented Next.js filler as today\'s cached digest', async () => {
    const digestDate = todayKey();
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          blog: {
            id: 'filler-1',
            title: 'Architectural Deep-Dive: Next.js 15',
            digest_date: digestDate,
            source: 'AI Resilient Synthesis Engine',
            is_fallback: true,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          blog: { id: 'd1', title: 'Real Morning Brief', content: '# hi' },
        }),
      });

    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const res = await POST(mockRequest({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cached).not.toBe(true);
    expect(body.blog.title).toBe('Real Morning Brief');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('proxies generation to the Celery blog service', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, blog: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          blog: { id: 'd1', title: 'Morning Brief', content: '# hi' },
        }),
      });

    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const res = await POST(mockRequest({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.blog.title).toBe('Morning Brief');
  });

  it('ignores force and still prefers FastAPI / cache over local AI', async () => {
    const digestDate = todayKey();
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        blog: { id: 'cached-2', title: 'Today Brief', digest_date: digestDate },
      }),
    });

    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const res = await POST(mockRequest({ force: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cached).toBe(true);
    expect(body.blog.title).toBe('Today Brief');
  });

  it('maps a missing profile from the blog service to 404', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, blog: null }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ detail: 'Supabase profile not found for user-1' }),
      });
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const res = await POST(mockRequest({}));
    expect(res.status).toBe(404);
  });

  it('does not invent a Next.js filler briefing when FastAPI is unreachable', async () => {
    mockFastApiDown();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const res = await POST(mockRequest({}));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/not generated/i);
    expect(body.blog).toBeUndefined();
  });

  it('returns the pipeline error when FastAPI synthesis fails', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, blog: null }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          detail: 'Synthesis pipeline error: Digest too short for the 18-20 minute target',
        }),
      });
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const res = await POST(mockRequest({}));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/Digest too short/i);
  });

  it('returns a clear 429 error when the blog service reports quota exceeded', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, blog: null }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ detail: '429 quota exceeded' }),
      });
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const res = await POST(mockRequest({}));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toMatch(/quota exceeded \(429\)/i);
  });

  it('returns 503 when FastAPI times out', async () => {
    (global.fetch as any).mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        throw new Error('The operation was aborted due to timeout');
      }
      return {
        ok: true,
        json: async () => ({ success: true, blog: null }),
      };
    });
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    const res = await POST(mockRequest({}));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/still being written/i);
    expect(body.blog).toBeUndefined();
  });

  it('returns a digest that landed after the generate call timed out', async () => {
    const digestDate = todayKey();
    let posts = 0;
    (global.fetch as any).mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts += 1;
        throw new Error('The operation was aborted due to timeout');
      }
      if (posts > 0) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            blog: { id: 'late-1', title: 'Landed Brief', digest_date: digestDate },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({ success: true, blog: null }),
      };
    });
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    const res = await POST(mockRequest({}));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cached).toBe(true);
    expect(body.blog.title).toBe('Landed Brief');
  });

  it('treats an unparseable request body as an empty body and falls through to the session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const bad = new Request('http://localhost/api/digests/generate', {
      method: 'POST',
      body: 'not-json',
    });

    const res = await POST(bad);
    expect(res.status).toBe(401);
  });
});
