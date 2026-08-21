import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockListUsers, queryState } = vi.hoisted(() => ({
  mockListUsers: vi.fn(),
  queryState: { result: { data: null as any, error: null as any }, eqCalls: [] as any[] },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(() => ({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) }
  })),
}));

vi.mock('@/lib/supabase/admin', () => {
  const builder: any = {
    select: vi.fn(() => builder),
    eq: vi.fn((col: string, val: unknown) => {
      queryState.eqCalls.push([col, val]);
      return builder;
    }),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    then: (resolve: any) => resolve(queryState.result),
  };
  return {
    supabaseAdmin: {
      from: vi.fn(() => builder),
      auth: { admin: { listUsers: (...a: any[]) => mockListUsers(...a) } },
    },
  };
});

import { GET } from './route';

function req(url = 'http://localhost/api/quizzes/leaderboard') {
  return new Request(url);
}

function attempt(overrides: Partial<any> = {}) {
  return {
    id: 'a1',
    user_id: 'u1',
    score: 8,
    percentage: 100,
    time_taken_seconds: 120,
    completed_at: '2026-08-01T00:00:00Z',
    blog_id: 'b1',
    ...overrides,
  };
}

describe('GET /api/quizzes/leaderboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryState.result = { data: [], error: null };
    queryState.eqCalls = [];
    mockListUsers.mockResolvedValue({ data: { users: [] }, error: null });
  });

  it('returns an empty leaderboard when there are no completed attempts', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, leaderboard: [] });
  });

  it('ranks attempts and resolves display names from auth users', async () => {
    queryState.result = {
      data: [attempt(), attempt({ id: 'a2', user_id: 'u2', score: 6 })],
      error: null,
    };
    mockListUsers.mockResolvedValue({
      data: {
        users: [
          { id: 'u1', email: 'ada@creolestudios.com', user_metadata: { current_role: 'SRE' } },
          { id: 'u2', email: 'grace@creolestudios.com', user_metadata: {} },
        ],
      },
      error: null,
    });

    const body = await (await GET(req())).json();
    expect(body.leaderboard).toHaveLength(2);
    expect(body.leaderboard[0]).toMatchObject({
      rank: 1,
      userId: 'u1',
      userName: 'You (ada)',
      role: 'SRE',
      score: 8,
      timeTaken: 120,
    });
    // Falls back to the default role when user_metadata has none.
    expect(body.leaderboard[1].role).toBe('Developer');
  });

  it('falls back to an anonymized entry when the user is not in the auth list', async () => {
    queryState.result = { data: [attempt({ user_id: 'ghost' })], error: null };
    mockListUsers.mockResolvedValue({ data: { users: [] }, error: null });

    const body = await (await GET(req())).json();
    expect(body.leaderboard[0].userName).toBe('de***r');
    expect(body.leaderboard[0].role).toBe('Developer');
  });

  it('still ranks attempts when the auth lookup errors', async () => {
    queryState.result = { data: [attempt({ user_id: 'other' })], error: null };
    mockListUsers.mockResolvedValue({ data: { users: null }, error: { message: 'auth down' } });

    const body = await (await GET(req())).json();
    expect(body.success).toBe(true);
    expect(body.leaderboard[0].userName).toBe('de***r');
  });

  it('filters by blogId when the query param is present', async () => {
    queryState.result = { data: [attempt()], error: null };
    await GET(req('http://localhost/api/quizzes/leaderboard?blogId=b42'));

    expect(queryState.eqCalls).toContainEqual(['blog_id', 'b42']);
  });

  it('does not filter by blogId when the param is absent', async () => {
    await GET(req());
    expect(queryState.eqCalls.some(([c]) => c === 'blog_id')).toBe(false);
  });

  it('returns a 500 when the attempts query fails', async () => {
    queryState.result = { data: null, error: { message: 'relation missing' } };

    const res = await GET(req());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Internal Server Error');
  });
});
