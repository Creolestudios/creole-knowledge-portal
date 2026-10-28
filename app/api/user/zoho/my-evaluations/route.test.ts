import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';

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
});
