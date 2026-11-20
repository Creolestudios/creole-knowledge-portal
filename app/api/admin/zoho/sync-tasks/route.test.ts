import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './route';

// Mocks
const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
    },
  }),
}));

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (...args: any[]) => mockFrom(...args),
  },
}));

const mockSyncQueuedPlannedTasks = vi.fn();
vi.mock('@/lib/zoho/planned-task-sync', () => ({
  syncQueuedPlannedTasks: (...args: any[]) => mockSyncQueuedPlannedTasks(...args),
}));

describe('Admin Zoho Sync-Tasks API (/api/admin/zoho/sync-tasks)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthorized requests with 401', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });

    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('rejects non-admin users with 403', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'dev-1' } } });
    mockFrom.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { role: 'developer' } }),
        }),
      }),
    });

    const res = await GET();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('Forbidden');
  });

  it('returns queued task count on GET', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'admin-1' } } });
    mockFrom.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { role: 'admin' } }),
        }),
      }),
    });
    mockFrom.mockReturnValueOnce({
      select: () => ({
        eq: async () => ({ count: 5, error: null }),
      }),
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.queuedCount).toBe(5);
  });

  it('falls back to zoho_status = Planned excluding synced tasks when sync_status column is missing', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'admin-1' } } });
    mockFrom.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { role: 'admin' } }),
        }),
      }),
    });
    // First call throws 42703 (sync_status not found)
    mockFrom.mockReturnValueOnce({
      select: () => ({
        eq: async () => ({ count: null, error: { code: '42703', message: 'column sync_status does not exist' } }),
      }),
    });
    // Fallback call
    mockFrom.mockReturnValueOnce({
      select: () => ({
        eq: async () => ({
          data: [
            { id: 't-1', zoho_task_id: 'temp_123' },
            { id: 't-2', zoho_task_id: null },
            { id: 't-3', zoho_task_id: '568690000123' }, // Already synced with real Zoho ID, excluded!
          ],
        }),
      }),
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.queuedCount).toBe(2);
  });

  it('triggers sync on POST and returns result', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'admin-1' } } });
    mockFrom.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { role: 'admin' } }),
        }),
      }),
    });

    mockSyncQueuedPlannedTasks.mockResolvedValueOnce({
      totalQueued: 4,
      syncedCount: 4,
      failedCount: 0,
      skippedCount: 0,
      adminEmailSent: true,
      details: [],
    });

    const req = new Request('http://localhost/api/admin/zoho/sync-tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskDate: '2026-11-23' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.syncedCount).toBe(4);
    expect(body.message).toContain('Successfully synchronized 4 queued task(s)');
  });

  it('handles missing parent task gracefully without error on POST', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: { id: 'admin-1' } } });
    mockFrom.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { role: 'admin' } }),
        }),
      }),
    });

    mockSyncQueuedPlannedTasks.mockResolvedValueOnce({
      totalQueued: 3,
      syncedCount: 0,
      failedCount: 0,
      skippedCount: 3,
      details: [],
    });

    const req = new Request('http://localhost/api/admin/zoho/sync-tasks', {
      method: 'POST',
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.skippedCount).toBe(3);
    expect(body.message).toContain('Parent task not found in Zoho Projects');
  });
});
