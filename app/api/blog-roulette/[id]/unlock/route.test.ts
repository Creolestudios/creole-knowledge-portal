import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

const mockGetUser = vi.fn();

function makeChain(responses: any[]) {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    then: vi.fn((resolve) => {
      const res = responses.length > 0 ? responses.shift() : { data: null, error: null };
      resolve(res);
    }),
  };
  return chain;
}

let clientResponses: any[];
let adminResponses: any[];

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(() => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(() => makeChain(clientResponses)),
  })),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => makeChain(adminResponses)),
  },
}));

function ctx(id = 'blog-1') {
  return { params: Promise.resolve({ id }) };
}

describe('POST /api/blog-roulette/[id]/unlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientResponses = [];
    adminResponses = [];
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(new Request('http://x'), ctx());
    expect(res.status).toBe(401);
  });

  it('returns 404 when the blog is not found for a non-admin author', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'dev@x.com' } } });
    clientResponses = [{ data: null, error: null }];

    const res = await POST(new Request('http://x'), ctx());
    expect(res.status).toBe(404);
  });

  it('rejects unlocking a blog that is not REJECTED', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'dev@x.com' } } });
    clientResponses = [{ data: { status: 'DRAFT' }, error: null }];

    const res = await POST(new Request('http://x'), ctx());
    expect(res.status).toBe(400);
  });

  it('enforces the cooldown period for a non-admin author', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'dev@x.com' } } });
    const recentRejection = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
    clientResponses = [
      { data: { status: 'REJECTED', updated_at: recentRejection }, error: null }, // blog lookup
      { data: { completed_at: recentRejection }, error: null }, // latest attempt
    ];

    const res = await POST(new Request('http://x'), ctx());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.remaining_ms).toBeGreaterThan(0);
  });

  it('unlocks the blog and clears attempts once the cooldown has passed', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'dev@x.com' } } });
    const oldRejection = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(); // 30h ago
    clientResponses = [
      { data: { status: 'REJECTED', updated_at: oldRejection }, error: null }, // blog lookup
      { data: null, error: null }, // no latest attempt -> falls back to blog.updated_at
      { error: null }, // update to DRAFT
      { error: null }, // delete attempts
    ];

    const res = await POST(new Request('http://x'), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('bypasses the cooldown entirely for the admin using supabaseAdmin', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'admin-1', email: 'priya.dhanani@creolestudios.com' } } });
    const recentRejection = new Date().toISOString();
    adminResponses = [
      { data: { status: 'REJECTED', updated_at: recentRejection }, error: null }, // blog lookup (no cooldown check for admin)
      { error: null }, // update to DRAFT
      { error: null }, // delete attempts
    ];

    const res = await POST(new Request('http://x'), ctx());
    expect(res.status).toBe(200);
  });

  it('returns a 500 when resetting the blog status fails', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'dev@x.com' } } });
    const oldRejection = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
    clientResponses = [
      { data: { status: 'REJECTED', updated_at: oldRejection }, error: null },
      { data: null, error: null },
      { error: { message: 'update failed' } },
    ];

    const res = await POST(new Request('http://x'), ctx());
    expect(res.status).toBe(500);
  });
});
