import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';

const { state, mockFrom } = vi.hoisted(() => {
  const state = {
    session: null as any,
    sessionError: null as any,
    throwOnSession: false,
    questions: [] as any[],
    invites: [] as any[],
  };

  const mockFrom = vi.fn((table: string) => {
    if (table === 'interview_sessions') {
      return {
        select: () => ({
          eq: () => ({
            single: async () => {
              if (state.throwOnSession) throw new Error('lookup boom');
              return { data: state.session, error: state.sessionError };
            },
          }),
        }),
      };
    }
    if (table === 'interview_questions') {
      return {
        select: () => ({
          eq: () => ({
            order: async () => ({ data: state.questions, error: null }),
          }),
        }),
      };
    }
    if (table === 'interview_invites') {
      return {
        select: () => ({
          eq: () => ({
            order: async () => ({ data: state.invites, error: null }),
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

function makeParams(id = 's1') {
  return { params: Promise.resolve({ id }) };
}

describe('GET /api/interviews/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.session = null;
    state.sessionError = null;
    state.throwOnSession = false;
    state.questions = [];
    state.invites = [];
  });

  it('returns 404 when the session does not exist', async () => {
    state.sessionError = { message: 'not found' };
    const res = await GET(new Request('http://localhost') as any, makeParams());
    expect(res.status).toBe(404);
  });

  it('returns the session with its questions and invites', async () => {
    state.session = { id: 's1', candidate_name: 'Jane' };
    state.questions = [{ id: 'q1' }];
    state.invites = [{ id: 'inv1' }];

    const res = await GET(new Request('http://localhost') as any, makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session).toEqual(
      expect.objectContaining({ id: 's1', candidate_name: 'Jane', questions: [{ id: 'q1' }], invites: [{ id: 'inv1' }] }),
    );
  });

  it('returns 500 when an unexpected error is thrown', async () => {
    state.throwOnSession = true;
    const res = await GET(new Request('http://localhost') as any, makeParams());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('lookup boom');
  });
});
