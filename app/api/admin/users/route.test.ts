import { describe, it, expect, vi } from 'vitest';

const mockRequireAdminUser = vi.fn();
const mockListUsers = vi.fn();
const mockUpsertSingle = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  requireAdminUser: (...args: any[]) => mockRequireAdminUser(...args),
  supabaseAdmin: {
    auth: { admin: { listUsers: (...args: any[]) => mockListUsers(...args) } },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [] }),
      upsert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ single: (...args: any[]) => mockUpsertSingle(...args) }),
      }),
    }),
  },
}));

import { GET, PUT } from './route';

describe('GET /api/admin/users', () => {
  it('returns 401 when the caller is not an admin', async () => {
    mockRequireAdminUser.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns merged users sorted by most recently updated', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    mockListUsers.mockResolvedValue({
      data: {
        users: [
          { id: 'u1', email: 'a@x.com', updated_at: '2026-01-01T00:00:00Z' },
          { id: 'u2', email: 'b@x.com', updated_at: '2026-06-01T00:00:00Z' },
        ],
      },
      error: null,
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].user_id).toBe('u2'); // most recently updated first
  });
});

describe('PUT /api/admin/users', () => {
  it('returns 401 when the caller is not an admin', async () => {
    mockRequireAdminUser.mockResolvedValue(null);
    const res = await PUT(new Request('http://x', { method: 'PUT', body: '{}' }));
    expect(res.status).toBe(401);
  });

  it('requires a user_id in the request body', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    const res = await PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
  });

  it('upserts the profile and returns it on success', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    mockUpsertSingle.mockResolvedValue({ data: { user_id: 'u1', role: 'admin' }, error: null });

    const res = await PUT(
      new Request('http://x', { method: 'PUT', body: JSON.stringify({ user_id: 'u1', role: 'admin' }) }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, data: { user_id: 'u1', role: 'admin' } });
  });
});
