import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';

vi.mock('@/lib/supabase/admin', () => ({
  requireAdminUser: vi.fn(() => Promise.resolve({ userId: 'admin-123' })),
}));

describe('Admin Zoho Report API (/api/admin/zoho/report)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates full evaluation report for target user', async () => {
    const req = new Request('http://localhost:3000/api/admin/zoho/report?userId=mock-user-1&type=week');
    const response = await GET(req);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.employee.name).toBe('Jayesh Patel');
    expect(json.performanceSummary.averageScore).toBe(89);
    expect(json.performanceSummary.timeAdherenceDistribution).toBeDefined();
    expect(json.taskRecords.length).toBeGreaterThan(0);
    expect(json.taskRecords[0].zohoLink).toContain('projects.zoho.com');
  });
});
