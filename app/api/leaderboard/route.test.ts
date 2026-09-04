import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';

const mockListUsers = vi.fn();
let responseQueue: Array<{ data: unknown; error: unknown }>;

function makeChain() {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    then: vi.fn((resolve: (value: unknown) => void) => {
      const res =
        responseQueue.length > 0
          ? responseQueue.shift()
          : { data: null, error: null };
      resolve(res);
    }),
  };
  return chain;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => makeChain()),
    auth: {
      admin: {
        listUsers: (...args: unknown[]) => mockListUsers(...args),
      },
    },
  },
}));

describe('GET /api/leaderboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    responseQueue = [];
  });

  it('aggregates read time, quiz scores, and xp then ranks users', async () => {
    mockListUsers.mockResolvedValue({
      data: {
        users: [
          { id: 'u1', email: 'ada@creole.com' },
          { id: 'u2', email: 'grace@creole.com' },
          { id: 'u3', email: 'idle@creole.com' },
        ],
      },
      error: null,
    });
    responseQueue = [
      {
        data: [
          { user_id: 'u1', metadata: { read_seconds: 120 } },
          { user_id: 'u1', metadata: { read_seconds: 30 } },
          { user_id: 'u2', metadata: { read_seconds: 10 } },
          { user_id: 'missing', metadata: { read_seconds: 99 } },
        ],
        error: null,
      },
      {
        data: [
          { user_id: 'u1', score: 4 },
          { user_id: 'u2', score: 8 },
          { user_id: 'missing', score: 50 },
        ],
        error: null,
      },
      {
        data: [
          { user_id: 'u1', xp: 50, level: 2, current_role: 'SRE' },
          { user_id: 'u2', xp: 100, level: 3, current_role: 'Backend' },
          { user_id: 'ghost', xp: 999, level: 9, current_role: 'Ghost' },
        ],
        error: null,
      },
    ];

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.leaderboard).toHaveLength(2);
    expect(body.leaderboard[0]).toMatchObject({
      userId: 'u2',
      email: 'grace@creole.com',
      xp: 100,
      level: 3,
      role: 'Backend',
      totalScore: 8,
      readTimeSec: 10,
    });
    expect(body.leaderboard[1]).toMatchObject({
      userId: 'u1',
      xp: 50,
      role: 'SRE',
      totalScore: 4,
      readTimeSec: 150,
    });
  });

  it('ignores missing activity tables and still returns profile xp ranks', async () => {
    mockListUsers.mockResolvedValue({
      data: { users: [{ id: 'u1', email: 'ada@creole.com' }] },
      error: null,
    });
    responseQueue = [
      { data: null, error: { code: 'PGRST205' } },
      { data: null, error: { code: '42P01' } },
      {
        data: [{ user_id: 'u1', xp: 10, level: 1, current_role: 'Dev' }],
        error: null,
      },
    ];

    const body = await (await GET()).json();
    expect(body.success).toBe(true);
    expect(body.leaderboard).toEqual([
      expect.objectContaining({
        userId: 'u1',
        xp: 10,
        role: 'Dev',
        readTimeSec: 0,
        totalScore: 0,
      }),
    ]);
  });

  it('falls back to basic profiles when gamification columns are missing', async () => {
    mockListUsers.mockResolvedValue({
      data: { users: [{ id: 'u1', email: 'ada@creole.com' }] },
      error: null,
    });
    responseQueue = [
      {
        data: [{ user_id: 'u1', metadata: { read_seconds: 5 } }],
        error: null,
      },
      { data: [], error: null },
      {
        data: null,
        error: { message: 'column xp does not exist' },
      },
      {
        data: [{ user_id: 'u1', current_role: 'Reader' }],
        error: null,
      },
    ];

    const body = await (await GET()).json();
    expect(body.success).toBe(true);
    expect(body.leaderboard[0]).toMatchObject({
      userId: 'u1',
      role: 'Reader',
      xp: 0,
      level: 1,
      readTimeSec: 5,
    });
  });

  it('keeps ranking when the basic profile fallback also fails', async () => {
    mockListUsers.mockResolvedValue({
      data: { users: [{ id: 'u1', email: 'ada@creole.com' }] },
      error: null,
    });
    responseQueue = [
      {
        data: [{ user_id: 'u1', metadata: { read_seconds: 12 } }],
        error: null,
      },
      { data: [], error: null },
      { data: null, error: { message: 'column xp does not exist' } },
      { data: null, error: { message: 'basic fetch failed' } },
    ];

    const body = await (await GET()).json();
    expect(body.success).toBe(true);
    expect(body.leaderboard[0]).toMatchObject({
      userId: 'u1',
      xp: 0,
      role: 'Reader',
      readTimeSec: 12,
    });
  });

  it('returns 500 when auth listUsers fails', async () => {
    mockListUsers.mockResolvedValue({
      data: { users: null },
      error: { message: 'auth down' },
    });

    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'auth down' });
  });

  it('returns Internal Server Error when the thrown error has no message', async () => {
    mockListUsers.mockResolvedValue({
      data: { users: null },
      error: {},
    });

    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal Server Error' });
  });

  it('returns 500 for non-optional read-log errors', async () => {
    mockListUsers.mockResolvedValue({
      data: { users: [{ id: 'u1', email: 'a@b.com' }] },
      error: null,
    });
    responseQueue = [{ data: null, error: { code: 'XX000', message: 'read failed' } }];

    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'read failed' });
  });

  it('returns 500 for non-optional quiz errors', async () => {
    mockListUsers.mockResolvedValue({
      data: { users: [{ id: 'u1', email: 'a@b.com' }] },
      error: null,
    });
    responseQueue = [
      { data: [], error: null },
      { data: null, error: { code: 'XX000', message: 'quiz failed' } },
    ];

    const res = await GET();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'quiz failed' });
  });

  it('sorts by totalScore then readTime when xp ties', async () => {
    mockListUsers.mockResolvedValue({
      data: {
        users: [
          { id: 'u1', email: 'a@creole.com' },
          { id: 'u2', email: 'b@creole.com' },
        ],
      },
      error: null,
    });
    responseQueue = [
      {
        data: [
          { user_id: 'u1', metadata: { read_seconds: 100 } },
          { user_id: 'u2', metadata: { read_seconds: 20 } },
        ],
        error: null,
      },
      {
        data: [
          { user_id: 'u1', score: 2 },
          { user_id: 'u2', score: 5 },
        ],
        error: null,
      },
      {
        data: [
          { user_id: 'u1', xp: 10, level: 1, current_role: null },
          { user_id: 'u2', xp: 10, level: 1, current_role: null },
        ],
        error: null,
      },
    ];

    const body = await (await GET()).json();
    expect(body.leaderboard[0].userId).toBe('u2');
    expect(body.leaderboard[0].role).toBe('Reader');
    expect(body.leaderboard[1].userId).toBe('u1');
  });

  it('sorts by readTime when xp and totalScore both tie', async () => {
    mockListUsers.mockResolvedValue({
      data: {
        users: [
          { id: 'u1', email: 'a@creole.com' },
          { id: 'u2', email: 'b@creole.com' },
        ],
      },
      error: null,
    });
    responseQueue = [
      {
        data: [
          { user_id: 'u1', metadata: { read_seconds: 40 } },
          { user_id: 'u2', metadata: { read_seconds: 90 } },
          { user_id: 'u1', metadata: {} },
        ],
        error: null,
      },
      {
        data: [
          { user_id: 'u1', score: 3 },
          { user_id: 'u2', score: 3 },
          { user_id: 'u1', score: null },
        ],
        error: null,
      },
      {
        data: [
          { user_id: 'u1', xp: 10, level: 1, current_role: 'Dev' },
          { user_id: 'u2', xp: 10, level: 1, current_role: 'Dev' },
        ],
        error: null,
      },
    ];

    const body = await (await GET()).json();
    expect(body.leaderboard.map((row: { userId: string }) => row.userId)).toEqual([
      'u2',
      'u1',
    ]);
  });
});
