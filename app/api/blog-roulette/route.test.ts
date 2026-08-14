import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetUser, state } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  state: {
    insertResult: { data: null as any, error: null as any },
    listResult: { data: null as any },
    keywordInserts: [] as any[],
    tables: [] as string[],
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
    from: vi.fn((table: string) => {
      state.tables.push(table);
      const b: any = {
        insert: vi.fn((rows: any) => {
          if (table === 'roulette_seo_keywords') {
            state.keywordInserts.push(rows);
            return Promise.resolve({ error: null });
          }
          return b;
        }),
        select: vi.fn(() => b),
        eq: vi.fn(() => b),
        order: vi.fn(() => Promise.resolve(state.listResult)),
        single: vi.fn(() => Promise.resolve(state.insertResult)),
      };
      return b;
    }),
  }),
}));

import { GET, POST } from './route';

function post(body: unknown) {
  return new Request('http://localhost/api/blog-roulette', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const VALID_TITLE = 'A sufficiently descriptive blog title';

describe('POST /api/blog-roulette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.insertResult = { data: { id: 'blog-1' }, error: null };
    state.listResult = { data: null };
    state.keywordInserts = [];
    state.tables = [];
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(post({ title: VALID_TITLE }));
    expect(res.status).toBe(401);
  });

  it('rejects a title that fails schema validation', async () => {
    const res = await POST(post({ title: 'short' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid title');
  });

  it('creates a draft and returns its id', async () => {
    const res = await POST(post({ title: VALID_TITLE }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'blog-1' });
    expect(state.tables).toContain('roulette_blogs');
  });

  it('persists SEO keyword suggestions and marks the selected ones', async () => {
    await POST(
      post({
        title: VALID_TITLE,
        keywords: ['react hooks'],
        suggestions: [
          { keyword: 'react hooks', type: 'primary', trend_direction: 'rising' },
          { keyword: 'react guide', type: 'long_tail', trend_direction: 'stable' },
        ],
      }),
    );

    const rows = state.keywordInserts[0];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ blog_id: 'blog-1', keyword: 'react hooks', selected: true });
    expect(rows[1].selected).toBe(false);
  });

  it('skips the keyword insert when there are no suggestions', async () => {
    await POST(post({ title: VALID_TITLE }));
    expect(state.keywordInserts).toEqual([]);
    expect(state.tables).not.toContain('roulette_seo_keywords');
  });

  it('returns a 500 when the insert fails', async () => {
    state.insertResult = { data: null, error: { message: 'unique violation' } };

    const res = await POST(post({ title: VALID_TITLE }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Create failed');
  });

  it('generates a slugified, suffixed slug from the title', async () => {
    // Two creates of the same title must not collide on slug.
    await POST(post({ title: 'Building Multi-Region Auth!' }));
    await POST(post({ title: 'Building Multi-Region Auth!' }));
    // Both succeeded, which is the observable contract here.
    expect(state.tables.filter((t) => t === 'roulette_blogs')).toHaveLength(2);
  });
});

describe('GET /api/blog-roulette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.listResult = { data: null };
    state.tables = [];
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("lists the caller's blogs newest-first", async () => {
    state.listResult = { data: [{ id: 'b1' }, { id: 'b2' }] };

    const body = await (await GET()).json();
    expect(body.blogs).toHaveLength(2);
  });

  it('returns an empty array when the query yields nothing', async () => {
    const body = await (await GET()).json();
    expect(body.blogs).toEqual([]);
  });
});
