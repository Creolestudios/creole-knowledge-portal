import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

const { state, mockFrom, mockResolveInvite } = vi.hoisted(() => {
  const state = {
    invite: null as any,
    updateCalls: [] as { table: string; payload: unknown }[],
  };

  const mockFrom = vi.fn((table: string) => ({
    update: (payload: unknown) => {
      state.updateCalls.push({ table, payload });
      return { eq: async () => ({ error: null }) };
    },
  }));

  const mockResolveInvite = vi.fn(async () => state.invite);

  return { state, mockFrom, mockResolveInvite };
});

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: mockFrom },
}));

vi.mock('@/lib/ai-interview/invite-token', () => ({
  resolveInviteByToken: mockResolveInvite,
}));

function makeParams(token = 'raw-token') {
  return { params: Promise.resolve({ token }) };
}

describe('POST /api/assess/[token]/complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.invite = null;
    state.updateCalls = [];
  });

  it('returns 404 for an unknown token', async () => {
    const res = await POST(new Request('http://localhost', { method: 'POST' }), makeParams());
    expect(res.status).toBe(404);
  });

  it('returns 410 when the invite is already revoked', async () => {
    state.invite = { id: 'inv1', session_id: 's1', status: 'revoked' };
    const res = await POST(new Request('http://localhost', { method: 'POST' }), makeParams());
    expect(res.status).toBe(410);
  });

  it('returns 410 when the invite is already expired', async () => {
    state.invite = { id: 'inv1', session_id: 's1', status: 'expired' };
    const res = await POST(new Request('http://localhost', { method: 'POST' }), makeParams());
    expect(res.status).toBe(410);
  });

  it('marks the invite and session completed', async () => {
    state.invite = { id: 'inv1', session_id: 's1', status: 'in_progress' };
    const res = await POST(new Request('http://localhost', { method: 'POST' }), makeParams());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ completed: true, session_id: 's1' });
    expect(state.updateCalls).toContainEqual(
      expect.objectContaining({
        table: 'interview_invites',
        payload: expect.objectContaining({ status: 'completed' }),
      }),
    );
    expect(state.updateCalls).toContainEqual(
      expect.objectContaining({
        table: 'interview_sessions',
        payload: expect.objectContaining({ status: 'completed' }),
      }),
    );
  });
});
