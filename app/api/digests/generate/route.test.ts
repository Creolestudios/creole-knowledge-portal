import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(() => ({ auth: { getUser: mockGetUser } })),
}));

vi.mock('@/lib/dev/mock-user', () => ({
  mockUserFromCookie: vi.fn().mockReturnValue(null),
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

describe('POST /api/digests/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it('returns 400 when no user id can be resolved', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(mockRequest({}));
    expect(res.status).toBe(400);
  });

  it('proxies generation to the Celery blog service', async () => {
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        blog: { id: 'd1', title: 'Morning Brief', content: '# hi' },
      }),
    });

    const res = await POST(mockRequest({ userId: 'user-1' }));
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
    const res = await POST(mockRequest({ userId: 'user-1' }));
    expect(res.status).toBe(404);
  });

  it('returns 500 when the blog service is unreachable', async () => {
    (global.fetch as any).mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await POST(mockRequest({ userId: 'user-1' }));
    expect(res.status).toBe(500);
  });
});
