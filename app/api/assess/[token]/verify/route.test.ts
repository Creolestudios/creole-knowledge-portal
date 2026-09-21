import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

const { state, mockFrom } = vi.hoisted(() => {
  const state = {
    invite: null as any,
    inviteError: null as any,
    session: null as any,
    sessionError: null as any,
    questions: [] as any[],
    questionsError: null as any,
    updateCalls: [] as { table: string; payload: unknown }[],
  };

  const mockFrom = vi.fn((table: string) => {
    if (table === 'interview_invites') {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: state.invite, error: state.inviteError }),
          }),
        }),
        update: (payload: unknown) => {
          state.updateCalls.push({ table, payload });
          return { eq: async () => ({ error: null }) };
        },
      };
    }
    if (table === 'interview_sessions') {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: state.session, error: state.sessionError }),
          }),
        }),
        update: (payload: unknown) => {
          state.updateCalls.push({ table, payload });
          return { eq: async () => ({ error: null }) };
        },
      };
    }
    if (table === 'interview_questions') {
      return {
        select: () => ({
          eq: () => ({
            order: async () => ({ data: state.questions, error: state.questionsError }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  return { state, mockFrom };
});

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: mockFrom },
}));

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/assess/token123/verify', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function makeParams(token = 'raw-token') {
  return { params: Promise.resolve({ token }) };
}

describe('POST /api/assess/[token]/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.invite = null;
    state.inviteError = null;
    state.session = null;
    state.sessionError = null;
    state.questions = [];
    state.questionsError = null;
    state.updateCalls = [];
  });

  it('requires a passcode', async () => {
    const res = await POST(makeRequest({}), makeParams());
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown token', async () => {
    state.inviteError = { message: 'not found' };
    const res = await POST(makeRequest({ passcode: '123456' }), makeParams());
    expect(res.status).toBe(404);
  });

  it('returns 410 for a revoked invite', async () => {
    state.invite = { id: 'inv1', session_id: 's1', status: 'revoked' };
    const res = await POST(makeRequest({ passcode: '123456' }), makeParams());
    expect(res.status).toBe(410);
  });

  it('returns 410 for an expired invite and marks it expired', async () => {
    state.invite = {
      id: 'inv1',
      session_id: 's1',
      status: 'active',
      expires_at: new Date(Date.now() - 1000).toISOString(),
      passcode_hash: 'x',
      passcode_salt: 'y',
    };
    const res = await POST(makeRequest({ passcode: '123456' }), makeParams());
    expect(res.status).toBe(410);
    expect(state.updateCalls).toContainEqual(
      expect.objectContaining({ table: 'interview_invites', payload: { status: 'expired' } }),
    );
  });

  it('returns 401 for an incorrect passcode', async () => {
    state.invite = {
      id: 'inv1',
      session_id: 's1',
      status: 'active',
      expires_at: new Date(Date.now() + 100000).toISOString(),
      passcode_hash: 'does-not-match',
      passcode_salt: 'salt',
    };
    const res = await POST(makeRequest({ passcode: '000000' }), makeParams());
    expect(res.status).toBe(401);
  });

  it('returns 409 when no questions have been generated', async () => {
    const crypto = await import('node:crypto');
    const passcode = '654321';
    const salt = 'salt';
    const hash = crypto.scryptSync(passcode + salt, salt, 64).toString('hex');

    state.invite = {
      id: 'inv1',
      session_id: 's1',
      status: 'active',
      expires_at: new Date(Date.now() + 100000).toISOString(),
      passcode_hash: hash,
      passcode_salt: salt,
    };
    state.session = { id: 's1', candidate_name: 'Jane', status: 'invite_issued' };
    state.questions = [];

    const res = await POST(makeRequest({ passcode }), makeParams());
    expect(res.status).toBe(409);
  });

  it('verifies a correct passcode and returns the session questions', async () => {
    const crypto = await import('node:crypto');
    const passcode = '654321';
    const salt = 'salt';
    const hash = crypto.scryptSync(passcode + salt, salt, 64).toString('hex');

    state.invite = {
      id: 'inv1',
      session_id: 's1',
      status: 'active',
      expires_at: new Date(Date.now() + 100000).toISOString(),
      passcode_hash: hash,
      passcode_salt: salt,
    };
    state.session = { id: 's1', candidate_name: 'Jane', status: 'invite_issued' };
    state.questions = [{ id: 'q1', question_text: 'Tell me about yourself' }];

    const res = await POST(makeRequest({ passcode }), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verified).toBe(true);
    expect(body.session_id).toBe('s1');
    expect(body.questions).toHaveLength(1);
    expect(state.updateCalls).toContainEqual(
      expect.objectContaining({ table: 'interview_invites' }),
    );
    expect(state.updateCalls).toContainEqual(
      expect.objectContaining({ table: 'interview_sessions', payload: expect.objectContaining({ status: 'in_progress' }) }),
    );
  });
});
