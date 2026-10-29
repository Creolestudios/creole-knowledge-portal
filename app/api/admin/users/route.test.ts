import { describe, it, expect, vi } from 'vitest';

const mockRequireAdminUser = vi.fn();
const mockListUsers = vi.fn();
const mockUpsertSingle = vi.fn();
const mockDeleteUser = vi.fn();
const mockDeleteFrom = vi.fn();
const mockGetUserById = vi.fn().mockResolvedValue({ data: { user: { user_metadata: {} } } });
const mockUpdateUserById = vi.fn().mockResolvedValue({ data: { user: {} }, error: null });

vi.mock('@/lib/supabase/admin', () => ({
  requireAdminUser: (...args: any[]) => mockRequireAdminUser(...args),
  supabaseAdmin: {
    auth: {
      admin: {
        listUsers: (...args: any[]) => mockListUsers(...args),
        deleteUser: (...args: any[]) => mockDeleteUser(...args),
        getUserById: (...args: any[]) => mockGetUserById(...args),
        updateUserById: (...args: any[]) => mockUpdateUserById(...args),
      },
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [] }),
      upsert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ single: (...args: any[]) => mockUpsertSingle(...args) }),
      }),
      delete: vi.fn().mockReturnValue({
        eq: (...args: any[]) => mockDeleteFrom(...args),
      }),
    }),
  },
}));

import { GET, PUT, DELETE } from './route';

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
    mockUpsertSingle.mockResolvedValue({ data: { user_id: 'u1', role: 'admin', ai_subscriptions: ['GitHub Copilot'] }, error: null });

    const res = await PUT(
      new Request('http://x', {
        method: 'PUT',
        body: JSON.stringify({ user_id: 'u1', role: 'admin', ai_subscriptions: ['GitHub Copilot'] }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, data: { user_id: 'u1', role: 'admin', ai_subscriptions: ['GitHub Copilot'] } });
  });

  it('falls back to upserting without ai_subscriptions if column is missing from schema cache', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    // First upsert fails with schema cache error
    mockUpsertSingle
      .mockResolvedValueOnce({
        data: null,
        error: { message: "Could not find the 'ai_subscriptions' column of 'user_profiles' in the schema cache", code: 'PGRST204' },
      })
      // Second upsert succeeds without ai_subscriptions
      .mockResolvedValueOnce({
        data: { user_id: 'u1', role: 'user', current_role: 'Developer' },
        error: null,
      });

    const res = await PUT(
      new Request('http://x', {
        method: 'PUT',
        body: JSON.stringify({ user_id: 'u1', role: 'user', current_role: 'Developer', ai_subscriptions: ['Cursor AI'] }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.ai_subscriptions).toEqual(['Cursor AI']);
  });
});

describe('DELETE /api/admin/users', () => {
  it('returns 401 when the caller is not an admin', async () => {
    mockRequireAdminUser.mockResolvedValue(null);
    const res = await DELETE(new Request('http://localhost/api/admin/users?userId=u1', { method: 'DELETE' }));
    expect(res.status).toBe(401);
  });

  it('requires userId parameter', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    const res = await DELETE(new Request('http://localhost/api/admin/users', { method: 'DELETE' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('User ID is required');
  });

  it('prevents an admin from deleting their own account', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    const res = await DELETE(new Request('http://localhost/api/admin/users?userId=admin-1', { method: 'DELETE' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('cannot delete your own admin account');
  });

  it('deletes the user from auth and returns success', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    mockDeleteUser.mockResolvedValue({ error: null });
    mockDeleteFrom.mockResolvedValue({ error: null });

    const res = await DELETE(new Request('http://localhost/api/admin/users?userId=u-target', { method: 'DELETE' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true, message: 'User deleted successfully' });
    expect(mockDeleteUser).toHaveBeenCalledWith('u-target');
  });
});

const mockGetAuditLogs = vi.fn();

vi.mock('@/lib/data/db', () => ({
  getAuditLogs: (...args: any[]) => mockGetAuditLogs(...args),
}));

import { GET as GET_AUDIT_LOGS } from '../audit-logs/route';

describe('GET /api/admin/audit-logs', () => {
  it('returns 401 when the caller is not an admin', async () => {
    mockRequireAdminUser.mockResolvedValue(null);
    const res = await GET_AUDIT_LOGS(new Request('http://x/api/admin/audit-logs'));
    expect(res.status).toBe(401);
  });

  it('returns audit logs sorted by most recent timestamp first', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    mockGetAuditLogs.mockResolvedValue([
      {
        id: 'log-old',
        action: 'SUBMITTED',
        performedBy: 'dev@creolestudios.com',
        timestamp: '2026-01-01T00:00:00Z',
      },
      {
        id: 'log-new',
        action: 'MODERATOR_APPROVED',
        performedBy: 'admin@creolestudios.com',
        timestamp: '2026-08-01T12:00:00Z',
      },
    ]);

    const res = await GET_AUDIT_LOGS(new Request('http://x/api/admin/audit-logs'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.auditLogs[0].id).toBe('log-new');
    expect(body.auditLogs[1].id).toBe('log-old');
  });

  it('returns 500 when loading audit logs fails', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    mockGetAuditLogs.mockRejectedValue(new Error('db unavailable'));

    const res = await GET_AUDIT_LOGS(new Request('http://x/api/admin/audit-logs'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('db unavailable');
  });
});
