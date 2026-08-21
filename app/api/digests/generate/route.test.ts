import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(() => ({ auth: { getUser: mockGetUser } })),
}));

describe('POST /api/digests/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('returns 401 when there is no session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it('proxies generation to the Celery blog service', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        blog: { id: 'd1', title: 'Morning Brief', content: '# hi' },
      }),
    });

    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.blog.title).toBe('Morning Brief');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/digests/generate'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('maps a missing profile from the blog service to 404', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ detail: 'Supabase profile not found for user-1' }),
    });
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const res = await POST();
    expect(res.status).toBe(404);
  });

  it('returns 500 when the blog service is unreachable', async () => {
    (global.fetch as any).mockRejectedValue(new Error('ECONNREFUSED'));
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const res = await POST();
    expect(res.status).toBe(500);
  });

  it('maps a non-404 blog-service error payload to 500', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: 'celery unavailable' }),
    });
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const res = await POST();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('celery unavailable');
  });

  it('uses the generic generation error when the payload is empty', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const res = await POST();
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toBe('Blog service generation failed');
  });

  it('falls back to the celery unreachable message when the thrown error has no message', async () => {
    (global.fetch as any).mockRejectedValue({});
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const res = await POST();
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toContain('Could not reach the Celery blog service');
  });
});
