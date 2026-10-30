import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockResolvedValue({ data: [], error: null }),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        getUser: vi.fn(() =>
          Promise.resolve({
            data: { user: { id: 'user-123', email: 'jayesh.patel@creolestudios.com' } },
            error: null,
          })
        ),
      },
    })
  ),
}));

describe('User Zoho Evaluations API (/api/user/zoho/my-evaluations)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns read-only evaluation data for the authenticated employee', async () => {
    const req = new Request('http://localhost:3000/api/user/zoho/my-evaluations?type=week');
    const response = await GET(req);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.readOnly).toBe(true);
    expect(json.evaluation).toBeDefined();
    expect(json.evaluation.email).toBe('jayesh.patel@creolestudios.com');
    expect(json.evaluation.tillDateSummary).toBeDefined();
  });

  it('filters evaluation data by custom date range', async () => {
    const req = new Request('http://localhost:3000/api/user/zoho/my-evaluations?type=range&startDate=2026-10-01&endDate=2026-10-07');
    const response = await GET(req);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.readOnly).toBe(true);
    expect(json.filter.range.start).toBe('2026-10-01');
    expect(json.filter.range.end).toBe('2026-10-07');
    expect(json.evaluation).toBeDefined();
  });
});
