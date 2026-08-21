import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}));

describe('GET /api/digests/by-id', () => {
  const mockUser = { id: 'user-123', email: 'test@example.com' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 if user is not authenticated', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });

    const req = new Request('http://localhost/api/digests/by-id?id=123');
    const res = await GET(req);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('Unauthorized');
  });

  it('returns 400 if blog id parameter is missing', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) },
    });

    const req = new Request('http://localhost/api/digests/by-id');
    const res = await GET(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Blog ID is required');
  });

  it('returns blog from primary Supabase lookup when found', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) },
    });

    const mockBlog = { id: 'blog-1', title: 'Test Blog' };
    (supabaseAdmin.from as any).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: mockBlog }),
        }),
      }),
    });

    const req = new Request('http://localhost/api/digests/by-id?id=blog-1');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.blog).toEqual(mockBlog);
  });

  it('returns blog from FastAPI secondary lookup if primary Supabase fails', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) },
    });

    (supabaseAdmin.from as any).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null }),
        }),
      }),
    });

    const mockFastApiBlog = { id: 'fastapi-blog-123', title: 'FastAPI Blog' };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ blog: mockFastApiBlog, success: true }),
    } as any);

    const req = new Request('http://localhost/api/digests/by-id?id=fastapi-blog-123');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.blog).toEqual(mockFastApiBlog);
  });

  it('returns blog from fallback Supabase search when primary & FastAPI fail', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) },
    });

    const mockFallbackBlog = { id: 'fallback-1', title: 'Fallback Blog' };

    (supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'blogs') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: null }),
            }),
            or: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [mockFallbackBlog] }),
            }),
          }),
        };
      }
      return {};
    });

    global.fetch = vi.fn().mockRejectedValue(new Error('FastAPI error'));

    const req = new Request('http://localhost/api/digests/by-id?id=fallback-1');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.blog).toEqual(mockFallbackBlog);
  });

  it('returns 404 when no blog is found anywhere', async () => {
    (createClient as any).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) },
    });

    (supabaseAdmin.from as any).mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null }),
        }),
        or: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [] }),
        }),
      }),
    });

    global.fetch = vi.fn().mockResolvedValue({ ok: false } as any);

    const req = new Request('http://localhost/api/digests/by-id?id=nonexistent');
    const res = await GET(req);
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe('Blog not found');
  });

  it('returns 500 when an exception is thrown', async () => {
    (createClient as any).mockRejectedValue(new Error('Database explosion'));

    const req = new Request('http://localhost/api/digests/by-id?id=123');
    const res = await GET(req);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Database explosion');
  });
});
