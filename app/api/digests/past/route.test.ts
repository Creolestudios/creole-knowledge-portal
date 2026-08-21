import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetUser, queryState } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  queryState: {
    result: { data: null as any, error: null as any },
    ilikeCalls: [] as any[],
    limitCalls: [] as any[],
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(() => ({ auth: { getUser: mockGetUser } })),
}));

vi.mock('@/lib/supabase/admin', () => {
  const builder: any = {
    select: vi.fn(() => builder),
    ilike: vi.fn((col: string, val: unknown) => {
      queryState.ilikeCalls.push([col, val]);
      return builder;
    }),
    order: vi.fn(() => builder),
    limit: vi.fn((n: number) => {
      queryState.limitCalls.push(n);
      return builder;
    }),
    then: (resolve: any) => resolve(queryState.result),
  };
  return { supabaseAdmin: { from: vi.fn(() => builder) } };
});

vi.mock('@/lib/blog-service', () => ({
  blogServiceUrl: (path: string) => `http://blog.test${path}`,
  blogServiceHeaders: () => ({ 'X-Internal-Token': 't' }),
}));

import { GET } from './route';

function req(url = 'http://localhost/api/digests/past') {
  return new Request(url);
}

describe('GET /api/digests/past', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryState.result = { data: [], error: null };
    queryState.ilikeCalls = [];
    queryState.limitCalls = [];
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('blog service down')));
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it('returns every stored briefing when no date is supplied', async () => {
    queryState.result = { data: [{ id: 'b1' }, { id: 'b2' }], error: null };

    const body = await (await GET(req())).json();
    expect(body.success).toBe(true);
    expect(body.blogs).toHaveLength(2);
    expect(queryState.limitCalls).toEqual([]);
  });

  it('returns an empty array when the user has no briefings', async () => {
    const body = await (await GET(req())).json();
    expect(body.blogs).toEqual([]);
  });

  it('narrows the query to a single day and returns one blog when a date is supplied', async () => {
    queryState.result = { data: [{ id: 'b1', title: 'That day' }], error: null };

    const body = await (await GET(req('http://localhost/api/digests/past?date=2026-08-01'))).json();
    expect(body.blog).toEqual({ id: 'b1', title: 'That day' });
    expect(queryState.ilikeCalls).toContainEqual(['url', 'briefing:u1:2026-08-01%']);
    // The date branch must not apply the 10-row cap.
    expect(queryState.limitCalls).toEqual([]);
  });

  it('returns a null blog when the requested date has no briefing', async () => {
    const body = await (await GET(req('http://localhost/api/digests/past?date=2026-08-02'))).json();
    expect(body).toEqual({ success: true, blog: null });
  });

  it('returns a 500 with the DB message when the query fails', async () => {
    queryState.result = { data: null, error: { message: 'relation "blogs" does not exist' } };

    const res = await GET(req());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain('relation');
  });

  it('returns a 500 when session lookup throws', async () => {
    mockGetUser.mockRejectedValue(new Error('auth service unreachable'));

    const res = await GET(req());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain('auth service unreachable');
  });

  it('returns Mongo past blogs from the blog service when it is available', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, blogs: [{ title: 'From Mongo', digest_date: '2026-08-18' }] }),
      }),
    );

    const body = await (await GET(req())).json();
    expect(body.blogs[0].title).toBe('From Mongo');
  });

  it('keeps yesterday blogs from Supabase when Mongo returns an empty list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, blogs: [] }),
      }),
    );
    queryState.result = {
      data: [
        { id: 's1', title: 'Yesterday brief', published_at: '2026-08-18T10:00:00.000Z', url: 'briefing:u1:2026-08-18' },
      ],
      error: null,
    };

    const body = await (await GET(req())).json();
    expect(body.blogs).toHaveLength(1);
    expect(body.blogs[0].title).toBe('Yesterday brief');
    expect(body.blogs[0].digest_date).toBe('2026-08-18');
  });
});
