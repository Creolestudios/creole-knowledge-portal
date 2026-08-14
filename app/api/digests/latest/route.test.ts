import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({}),
}));

const mockResolveUserOrMock = vi.fn();
vi.mock('@/lib/dev/mock-user', () => ({
  resolveUserOrMock: (...args: any[]) => mockResolveUserOrMock(...args),
}));

let mockDbResponses: any[] = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => {
      const chain: any = {
        select: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => {
          const res = mockDbResponses.length > 0 ? mockDbResponses.shift() : { data: null, error: null };
          resolve(res);
        }),
      };
      return chain;
    }),
  },
}));

describe('GET /api/digests/latest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbResponses = [];
  });

  it('returns 401 when there is no resolved user (real or mock)', async () => {
    mockResolveUserOrMock.mockResolvedValue(null);
    const res = await GET(new Request('http://x'));
    expect(res.status).toBe(401);
  });

  it('falls back to the legacy daily briefing when no active series exists', async () => {
    mockResolveUserOrMock.mockResolvedValue({ id: 'user-1' });
    mockDbResponses = [
      { data: [], error: null }, // series blogs
      { data: [{ id: 'brief-1', title: 'Daily Briefing' }], error: null }, // legacy brief
    ];

    const res = await GET(new Request('http://x'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.blog).toEqual({ id: 'brief-1', title: 'Daily Briefing' });
  });
});
