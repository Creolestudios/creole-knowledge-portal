import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

const { state, mockFrom, mockResolveInvite } = vi.hoisted(() => {
  const state = {
    invite: null as any,
    question: null as any,
    questionError: null as any,
    answer: null as any,
    insertError: null as any,
    insertedPayload: null as any,
  };

  const mockFrom = vi.fn((table: string) => {
    if (table === 'interview_questions') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => ({ data: state.question, error: state.questionError }),
            }),
          }),
        }),
      };
    }
    if (table === 'interview_answers') {
      return {
        insert: (payload: unknown) => {
          state.insertedPayload = payload;
          return {
            select: () => ({
              single: async () => ({ data: state.answer, error: state.insertError }),
            }),
          };
        },
      };
    }
    throw new Error(`Unexpected table: ${table}`);
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
  return new Request('http://localhost/api/assess/token123/answer', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function makeParams(token = 'raw-token') {
  return { params: Promise.resolve({ token }) };
}

describe('POST /api/assess/[token]/answer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.invite = null;
    state.question = null;
    state.questionError = null;
    state.answer = null;
    state.insertError = null;
    state.insertedPayload = null;
  });

  it('requires a question_id', async () => {
    const res = await POST(makeRequest({ transcript: 'hi' }), makeParams());
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown token', async () => {
    state.invite = null;
    const res = await POST(makeRequest({ question_id: 'q1' }), makeParams());
    expect(res.status).toBe(404);
  });

  it('rejects when the invite is not in_progress', async () => {
    state.invite = { id: 'inv1', session_id: 's1', status: 'active' };
    const res = await POST(makeRequest({ question_id: 'q1' }), makeParams());
    expect(res.status).toBe(409);
  });

  it('rejects a question that does not belong to the session', async () => {
    state.invite = { id: 'inv1', session_id: 's1', status: 'in_progress' };
    state.questionError = { message: 'not found' };
    const res = await POST(makeRequest({ question_id: 'q1' }), makeParams());
    expect(res.status).toBe(400);
  });

  it('saves a valid answer and defaults missing timing fields to 0', async () => {
    state.invite = { id: 'inv1', session_id: 's1', status: 'in_progress' };
    state.question = { id: 'q1', session_id: 's1' };
    state.answer = { id: 'ans1' };

    const res = await POST(
      makeRequest({ question_id: 'q1', transcript: 'My answer' }),
      makeParams(),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ saved: true, answer_id: 'ans1' });
    expect(state.insertedPayload).toEqual(
      expect.objectContaining({
        session_id: 's1',
        question_id: 'q1',
        transcript: 'My answer',
        time_to_first_response_sec: 0,
        total_time_taken_sec: 0,
      }),
    );
  });

  it('returns 500 when the insert fails', async () => {
    state.invite = { id: 'inv1', session_id: 's1', status: 'in_progress' };
    state.question = { id: 'q1', session_id: 's1' };
    state.insertError = { message: 'db error' };

    const res = await POST(makeRequest({ question_id: 'q1' }), makeParams());
    expect(res.status).toBe(500);
  });
});
