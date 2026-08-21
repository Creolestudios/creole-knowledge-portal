import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(() => ({ auth: { getUser: mockGetUser } })),
}));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {},
}));

let mockDbResponses: any[] = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => {
      const chain: any = {
        select: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => {
          const res = mockDbResponses.length > 0 ? mockDbResponses.shift() : { data: null, error: null };
          resolve(res);
        }),
      };
      return chain;
    }),
  },
}));

describe('GET /api/digests/trending', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbResponses = [];
  });

  it('returns 401 when there is no session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(new Request('http://x'));
    expect(res.status).toBe(401);
  });

  it('returns cached trending blogs when fresh ones already exist', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const fresh = [
      { id: 't1', title: 'Trend 1', created_at: new Date().toISOString() },
      { id: 't2', title: 'Trend 2', created_at: new Date().toISOString() },
    ];
    mockDbResponses = [{ data: fresh, error: null }];

    const res = await GET(new Request('http://x'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.blogs).toHaveLength(2);
  });
});
