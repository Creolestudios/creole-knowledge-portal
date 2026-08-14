import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './route';

const mockGetUser = vi.fn();
let responseQueue: any[];

function makeChain() {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    then: vi.fn((resolve) => {
      const res = responseQueue.length > 0 ? responseQueue.shift() : { data: null, error: null };
      resolve(res);
    }),
  };
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(() => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(() => makeChain()),
  })),
}));

function mockRequest(body?: unknown) {
  return new Request('http://localhost/api/activity', {
    method: body ? 'POST' : 'GET',
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('GET /api/activity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    responseQueue = [];
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(mockRequest());
    expect(res.status).toBe(401);
  });

  it('returns empty records with a zero streak when the table does not exist', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    responseQueue = [{ data: null, error: { code: '42P01' } }];

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body).toEqual({ success: true, records: [], streak: 0 });
  });

  it('returns a 500 for any other DB error', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    responseQueue = [{ data: null, error: { code: 'XX000', message: 'boom' } }];

    const res = await GET(mockRequest());
    expect(res.status).toBe(500);
  });

  it('computes a consecutive-day streak from today backwards', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    responseQueue = [
      {
        data: [
          { date: today.toISOString(), read_seconds: 100 },
          { date: yesterday.toISOString(), read_seconds: 200 },
          { date: twoDaysAgo.toISOString(), read_seconds: 0 }, // breaks the streak
        ],
        error: null,
      },
    ];

    const res = await GET(mockRequest());
    const body = await res.json();
    expect(body.streak).toBe(2);
  });
});

describe('POST /api/activity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    responseQueue = [];
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(mockRequest({ date: '2026-08-01' }));
    expect(res.status).toBe(401);
  });

  it('requires a date', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const res = await POST(mockRequest({}));
    expect(res.status).toBe(400);
  });

  it('creates a new record when none exists for the date', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    responseQueue = [
      { data: null, error: null }, // existing lookup -> none
      { data: null, error: null }, // insert result
    ];

    const res = await POST(mockRequest({ date: '2026-08-01', readSeconds: 60 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('accumulates read seconds onto an existing record', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    responseQueue = [
      { data: { id: 'rec-1', read_seconds: 30 }, error: null }, // existing lookup
      { data: null, error: null }, // update result
    ];

    const res = await POST(mockRequest({ date: '2026-08-01', readSeconds: 60, quizScore: 2, quizTotal: 3 }));
    expect(res.status).toBe(200);
  });

  it('simulates success when the table does not exist', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    responseQueue = [
      { data: null, error: null }, // existing lookup -> none
      { data: null, error: { code: '42P01' } }, // insert fails: table missing
    ];

    const res = await POST(mockRequest({ date: '2026-08-01', readSeconds: 60 }));
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toContain('Simulated');
  });

  it('returns a 500 for any other DB error on write', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    responseQueue = [
      { data: null, error: null },
      { data: null, error: { code: 'XX000', message: 'write failed' } },
    ];

    const res = await POST(mockRequest({ date: '2026-08-01', readSeconds: 60 }));
    expect(res.status).toBe(500);
  });
});
