import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(() => ({ auth: { getUser: mockGetUser } })),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) }),
}));

vi.mock('@/lib/dev/mock-user', () => ({
  mockUserFromCookie: vi.fn().mockReturnValue(null),
}));

let tableResponses: Record<string, any[]>;
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        single: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => {
          const queue = tableResponses[table] ?? [];
          const res = queue.length > 0 ? queue.shift() : { data: null, error: null };
          resolve(res);
        }),
      };
      return chain;
    }),
  },
}));

function mockRequest(body: unknown) {
  return new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as any;
}

describe('POST /api/digests/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tableResponses = {};
  });

  it('returns 401 when there is no resolved user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(mockRequest({ blogId: 'b1' }));
    expect(res.status).toBe(401);
  });

  it('requires a blogId', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const res = await POST(mockRequest({}));
    expect(res.status).toBe(400);
  });

  it('returns 404 when the blog part cannot be found', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    tableResponses = { blogs: [{ data: null, error: { message: 'not found' } }] };

    const res = await POST(mockRequest({ blogId: 'b1' }));
    expect(res.status).toBe(404);
  });

  it('forbids marking a part complete that does not belong to the user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    tableResponses = { blogs: [{ data: { url: 'series:someone-else:s1:part:1' }, error: null }] };

    const res = await POST(mockRequest({ blogId: 'b1' }));
    expect(res.status).toBe(403);
  });

  it('marks the part completed and returns the updated blog', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    tableResponses = {
      blogs: [
        { data: { url: 'series:u1:s1:part:1', summary: JSON.stringify({ seriesId: 's1' }) }, error: null },
        { data: { id: 'b1', summary: JSON.stringify({ seriesId: 's1', completed: true }) }, error: null },
      ],
    };

    const res = await POST(mockRequest({ blogId: 'b1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('handles an unparseable summary field gracefully', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    tableResponses = {
      blogs: [
        { data: { url: 'series:u1:s1:part:1', summary: 'not json' }, error: null },
        { data: { id: 'b1' }, error: null },
      ],
    };

    const res = await POST(mockRequest({ blogId: 'b1' }));
    expect(res.status).toBe(200);
  });

  it('returns a 500 when the update fails', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    tableResponses = {
      blogs: [
        { data: { url: 'series:u1:s1:part:1', summary: '{}' }, error: null },
        { data: null, error: { message: 'update failed' } },
      ],
    };

    const res = await POST(mockRequest({ blogId: 'b1' }));
    expect(res.status).toBe(500);
  });
});
