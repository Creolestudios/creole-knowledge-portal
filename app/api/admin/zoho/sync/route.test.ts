import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './route';

vi.mock('@/lib/supabase/admin', () => ({
  requireAdminUser: vi.fn(() => Promise.resolve({ userId: 'admin-123' })),
}));

const mockSyncLiveZohoTasks = vi.fn();
vi.mock('@/lib/zoho/sync', () => ({
  syncLiveZohoTasks: (...args: any[]) => mockSyncLiveZohoTasks(...args),
}));

describe('Admin Zoho Sync API (/api/admin/zoho/sync)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST triggers live sync and returns success report', async () => {
    mockSyncLiveZohoTasks.mockResolvedValue({
      success: true,
      taskCount: 550,
      userCount: 12,
      lastSyncedAt: '2026-10-29T07:45:00.000Z',
    });

    const req = new Request('http://localhost:3000/api/admin/zoho/sync', {
      method: 'POST',
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.taskCount).toBe(550);
    expect(json.userCount).toBe(12);
    expect(mockSyncLiveZohoTasks).toHaveBeenCalledWith(true);
  });

  it('GET returns current sync status without forcing refresh', async () => {
    mockSyncLiveZohoTasks.mockResolvedValue({
      success: true,
      taskCount: 550,
      userCount: 12,
      lastSyncedAt: '2026-10-29T07:45:00.000Z',
    });

    const req = new Request('http://localhost:3000/api/admin/zoho/sync', {
      method: 'GET',
    });
    const res = await GET(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.isLive).toBe(true);
    expect(mockSyncLiveZohoTasks).toHaveBeenCalledWith(false);
  });
});
