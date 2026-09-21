import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

const { state, mockFrom, mockResolveInvite } = vi.hoisted(() => {
  const state = {
    invite: null as any,
    updateCalls: [] as { table: string; payload: unknown }[],
    insertedEvent: null as any,
  };

  const mockFrom = vi.fn((table: string) => {
    if (table === 'interview_events') {
      return {
        insert: async (payload: unknown) => {
          state.insertedEvent = payload;
          return { error: null };
        },
      };
    }
    return {
      update: (payload: unknown) => {
        state.updateCalls.push({ table, payload });
        return { eq: async () => ({ error: null }) };
      },
    };
  });

  const mockResolveInvite = vi.fn(async () => state.invite);

  return { state, mockFrom, mockResolveInvite };
});

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: mockFrom },
}));

vi.mock('@/lib/ai-interview/invite-token', () => ({
  resolveInviteByToken: mockResolveInvite,
}));

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/assess/token123/terminate', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function makeParams(token = 'raw-token') {
  return { params: Promise.resolve({ token }) };
}

describe('POST /api/assess/[token]/terminate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.invite = null;
    state.updateCalls = [];
    state.insertedEvent = null;
  });

  it('requires a reason', async () => {
    const res = await POST(makeRequest({}), makeParams());
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown token', async () => {
    const res = await POST(makeRequest({ reason: 'tab-switch' }), makeParams());
    expect(res.status).toBe(404);
  });

  it('is idempotent for an already-terminated invite', async () => {
    state.invite = { id: 'inv1', session_id: 's1', status: 'revoked' };
    const res = await POST(makeRequest({ reason: 'tab-switch' }), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ terminated: true, session_id: 's1' });
    expect(state.updateCalls).toHaveLength(0);
  });

  it('revokes an active invite, cancels the session, and logs the violation', async () => {
    state.invite = { id: 'inv1', session_id: 's1', status: 'in_progress' };
    const res = await POST(makeRequest({ reason: 'tab-switch' }), makeParams());

    expect(res.status).toBe(200);
    expect(state.updateCalls).toContainEqual(
      expect.objectContaining({
        table: 'interview_invites',
        payload: expect.objectContaining({ status: 'revoked' }),
      }),
    );
    expect(state.updateCalls).toContainEqual(
      expect.objectContaining({
        table: 'interview_sessions',
        payload: expect.objectContaining({ status: 'cancelled' }),
      }),
    );
    expect(state.insertedEvent).toEqual(
      expect.objectContaining({
        session_id: 's1',
        event_type: 'proctoring_violation',
        severity: 'critical',
        metadata: { reason: 'tab-switch' },
      }),
    );
  });
});
