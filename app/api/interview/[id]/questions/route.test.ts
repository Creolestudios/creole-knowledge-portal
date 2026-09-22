import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { state, mockRequireAdminUser, mockFrom } = vi.hoisted(() => {
  const state = {
    interview: { id: 'sess-1' } as { id: string } | null,
    interviewError: null as { message: string } | null,
    sessionUpsertError: null as { message: string } | null,
    createdQuestions: [{ id: 'q1' }] as unknown[],
    questionInsertError: null as { message: string } | null,
    session: { id: 'sess-1', duration_minutes: 30, question_count: 1, status: 'questions_generated' } as
      | Record<string, unknown>
      | null,
    sessionSelectError: null as { message: string } | null,
    questions: [{ id: 'q1' }] as unknown[],
    questionsSelectError: null as { message: string } | null,
  };

  const mockRequireAdminUser = vi.fn().mockResolvedValue({ userId: 'admin-1' });

  const mockFrom = vi.fn((table: string) => {
    if (table === 'ai_interviews') {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: state.interview, error: state.interviewError }),
          }),
        }),
      };
    }
    if (table === 'interview_sessions') {
      return {
        upsert: async () => ({ error: state.sessionUpsertError }),
        select: () => ({
          eq: () => ({
            single: async () => ({ data: state.session, error: state.sessionSelectError }),
          }),
        }),
      };
    }
    if (table === 'interview_questions') {
      return {
        delete: () => ({ eq: async () => ({ error: null }) }),
        insert: () => ({
          select: async () => ({ data: state.createdQuestions, error: state.questionInsertError }),
        }),
        select: () => ({
          eq: () => ({
            order: async () => ({ data: state.questions, error: state.questionsSelectError }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  return { state, mockRequireAdminUser, mockFrom };
});

vi.mock('@/lib/supabase/admin', () => ({
  requireAdminUser: mockRequireAdminUser,
  supabaseAdmin: { from: mockFrom },
}));

import { GET, POST } from './route';

function makeParams(id = 'sess-1') {
  return { params: Promise.resolve({ id }) };
}

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/interview/sess-1/questions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/interview/[id]/questions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    state.interview = { id: 'sess-1' };
    state.interviewError = null;
    state.sessionUpsertError = null;
    state.createdQuestions = [{ id: 'q1' }];
    state.questionInsertError = null;
  });

  it('returns 401 when the caller is not an admin', async () => {
    mockRequireAdminUser.mockResolvedValue(null);
    const res = await POST(makePostRequest({ questions: [{}], durationMinutes: 30 }), makeParams());
    expect(res.status).toBe(401);
  });

  it('returns 400 when questions or duration are missing', async () => {
    const res = await POST(makePostRequest({ questions: [], durationMinutes: 0 }), makeParams());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('Questions and interview duration are required.');
  });

  it('returns 404 when the interview does not exist', async () => {
    state.interview = null;
    state.interviewError = { message: 'not found' };
    const res = await POST(
      makePostRequest({ questions: [{ question_text: 'Q1' }], durationMinutes: 30 }),
      makeParams(),
    );
    expect(res.status).toBe(404);
  });

  it('returns 500 when the session upsert fails', async () => {
    state.sessionUpsertError = { message: 'upsert failed' };
    const res = await POST(
      makePostRequest({ questions: [{ question_text: 'Q1' }], durationMinutes: 30 }),
      makeParams(),
    );
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('upsert failed');
  });

  it('returns 500 when question insert fails', async () => {
    state.questionInsertError = { message: 'insert failed' };
    const res = await POST(
      makePostRequest({ questions: [{ question_text: 'Q1' }], durationMinutes: 30 }),
      makeParams(),
    );
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('insert failed');
  });

  it('creates interview questions successfully', async () => {
    const res = await POST(
      makePostRequest({
        questions: [
          {
            id: 'not-a-uuid',
            question_text: 'Tell me about yourself',
            category: 'hr',
            time_limit_sec: 120,
            weight: 5,
            is_mandatory_hr: true,
          },
        ],
        durationMinutes: 30,
      }),
      makeParams(),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sessionId).toBe('sess-1');
    expect(body.questions).toEqual([{ id: 'q1' }]);
  });

  it('returns 500 with a generic message when an unexpected error is thrown', async () => {
    mockRequireAdminUser.mockRejectedValueOnce(new Error('boom'));
    const res = await POST(makePostRequest({ questions: [{}], durationMinutes: 30 }), makeParams());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('boom');
  });
});

describe('GET /api/interview/[id]/questions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminUser.mockResolvedValue(null);
    state.session = { id: 'sess-1', duration_minutes: 30, question_count: 1, status: 'questions_generated' };
    state.sessionSelectError = null;
    state.questions = [{ id: 'q1' }];
    state.questionsSelectError = null;
  });

  function makeGetRequest(cookieValue?: string): NextRequest {
    const req = new NextRequest('http://localhost/api/interview/sess-1/questions');
    if (cookieValue) {
      req.cookies.set('interview_verified_id', cookieValue);
    }
    return req;
  }

  it('returns 401 when the interview_verified_id cookie does not match', async () => {
    const res = await GET(makeGetRequest('other-id'), makeParams());
    expect(res.status).toBe(401);
  });

  it('allows access without cookie if the user is an admin', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    const res = await GET(makeGetRequest('other-id'), makeParams());
    expect(res.status).toBe(200);
  });

  it('returns 404 when the session is not found', async () => {
    state.session = null;
    state.sessionSelectError = { message: 'not found' };
    const res = await GET(makeGetRequest('sess-1'), makeParams());
    expect(res.status).toBe(404);
  });

  it('returns 500 when fetching questions fails', async () => {
    state.questionsSelectError = { message: 'query failed' };
    const res = await GET(makeGetRequest('sess-1'), makeParams());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('query failed');
  });

  it('returns the session and its questions', async () => {
    const res = await GET(makeGetRequest('sess-1'), makeParams());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.session).toEqual(state.session);
    expect(body.questions).toEqual([{ id: 'q1', is_custom: false }]);
  });
});
