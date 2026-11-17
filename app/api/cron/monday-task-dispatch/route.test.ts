import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET, POST } from './route';

const mockRequireAdminUser = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  requireAdminUser: () => mockRequireAdminUser(),
}));

const mockSyncQueuedPlannedTasks = vi.fn();
vi.mock('@/lib/zoho/planned-task-sync', () => ({
  syncQueuedPlannedTasks: (...args: any[]) => mockSyncQueuedPlannedTasks(...args),
}));

describe('/api/cron/monday-task-dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'production');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 401 Unauthorized if neither CRON_SECRET nor Admin session is provided', async () => {
    mockRequireAdminUser.mockResolvedValueOnce(null);

    const req = new Request('http://localhost/api/cron/monday-task-dispatch', {
      headers: { Authorization: 'Bearer wrong-secret' },
    });
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('authorizes successfully with valid Bearer CRON_SECRET and executes sync', async () => {
    mockSyncQueuedPlannedTasks.mockResolvedValueOnce({
      totalQueued: 3,
      syncedCount: 3,
      failedCount: 0,
      skippedCount: 0,
      details: [],
    });

    const req = new Request('http://localhost/api/cron/monday-task-dispatch?date=2026-11-16', {
      headers: { Authorization: 'Bearer creole-cron-secret-123' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.syncedCount).toBe(3);
    expect(mockSyncQueuedPlannedTasks).toHaveBeenCalledWith('2026-11-16', { dryRun: false });
  });

  it('handles POST requests identically to GET requests', async () => {
    mockSyncQueuedPlannedTasks.mockResolvedValueOnce({
      totalQueued: 1,
      syncedCount: 1,
      failedCount: 0,
      skippedCount: 0,
      details: [],
    });

    const req = new Request('http://localhost/api/cron/monday-task-dispatch?date=2026-11-16', {
      method: 'POST',
      headers: { Authorization: 'Bearer creole-cron-secret-123' },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});
