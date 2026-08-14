import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, PATCH } from './route';

const mockGetUser = vi.fn();

function makeChain(responses: any[]) {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    then: vi.fn((resolve) => {
      const res = responses.length > 0 ? responses.shift() : { data: null, error: null };
      resolve(res);
    }),
  };
  return chain;
}

let queue: any[];
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(() => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(() => makeChain(queue)),
  })),
}));

function ctx(id = 'blog-1') {
  return { params: Promise.resolve({ id }) };
}
function patchRequest(body: unknown) {
  return new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) });
}

describe('GET /api/blog-roulette/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queue = [];
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(new Request('http://x'), ctx());
    expect(res.status).toBe(401);
  });

  it('returns 404 when the blog is not found for this author', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    queue = [{ data: null, error: null }];
    const res = await GET(new Request('http://x'), ctx());
    expect(res.status).toBe(404);
  });

  it('returns the blog with its tags and keywords', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    queue = [
      { data: { id: 'blog-1', title: 'My Blog' }, error: null }, // blog lookup
      { data: [{ tag: 'react' }, { tag: 'nextjs' }], error: null }, // tags
      { data: [{ keyword: 'react hooks' }], error: null }, // keywords
    ];

    const res = await GET(new Request('http://x'), ctx());
    const body = await res.json();
    expect(body.blog.title).toBe('My Blog');
    expect(body.tags).toEqual(['react', 'nextjs']);
    expect(body.keywords).toEqual([{ keyword: 'react hooks' }]);
  });
});

describe('PATCH /api/blog-roulette/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queue = [];
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await PATCH(patchRequest({}), ctx());
    expect(res.status).toBe(401);
  });

  it('rejects editing once the blog is locked (non-DRAFT)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    queue = [{ data: { id: 'blog-1', status: 'SUBMITTED' }, error: null }];

    const res = await PATCH(patchRequest({ title: 'New title over ten chars' }), ctx());
    expect(res.status).toBe(409);
  });

  it('validates the update payload against the schema', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    queue = [{ data: { id: 'blog-1', status: 'DRAFT' }, error: null }];

    const res = await PATCH(patchRequest({ title: 'short' }), ctx()); // < 10 chars
    expect(res.status).toBe(400);
  });

  it('updates the blog and replaces its tags', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    queue = [
      { data: { id: 'blog-1', status: 'DRAFT' }, error: null }, // authBlog lookup
      { error: null }, // update
      { error: null }, // delete tags
      { error: null }, // insert tags
    ];

    const res = await PATCH(
      patchRequest({ title: 'A perfectly fine new title', tags: ['react', 'testing'] }),
      ctx(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('clears tags without inserting when an empty tags array is given', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    queue = [
      { data: { id: 'blog-1', status: 'DRAFT' }, error: null },
      { error: null }, // update
      { error: null }, // delete tags
    ];

    const res = await PATCH(patchRequest({ title: 'A perfectly fine new title', tags: [] }), ctx());
    expect(res.status).toBe(200);
  });

  it('returns a 500 when the update write fails', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    queue = [
      { data: { id: 'blog-1', status: 'DRAFT' }, error: null },
      { error: { message: 'write failed' } },
    ];

    const res = await PATCH(patchRequest({ title: 'A perfectly fine new title' }), ctx());
    expect(res.status).toBe(500);
  });
});
