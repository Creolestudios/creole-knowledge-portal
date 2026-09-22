import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

const { state, mockFrom } = vi.hoisted(() => {
  const state = {
    session: null as any,
    hrRows: [] as any[],
    bankRows: [] as any[],
    bankError: null as any,
    insertedQuestions: [] as any[],
    insertError: null as any,
  };

  const mockFrom = vi.fn((table: string) => {
    if (table === 'interview_sessions') {
      return {
        select: () => ({ eq: () => ({ single: async () => ({ data: state.session, error: state.session ? null : { message: 'not found' } }) }) }),
        update: () => ({ eq: async () => ({ data: null, error: null }) }),
      };
    }
    if (table === 'hr_question_bank') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ order: async () => ({ data: state.hrRows, error: null }) }),
            in: () => ({ eq: async () => ({ data: state.bankRows, error: state.bankError }) }),
          }),
          in: () => ({ eq: async () => ({ data: state.bankRows, error: state.bankError }) }),
        }),
      };
    }
    if (table === 'interview_questions') {
      return {
        delete: () => ({ eq: async () => ({ data: null, error: null }) }),
        insert: () => ({ select: async () => ({ data: state.insertedQuestions, error: state.insertError }) }),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  return { state, mockFrom };
});

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: mockFrom },
}));

vi.mock('@/lib/ai-interview/question-generator', () => ({
  DEFAULT_MANDATORY_HR_QUESTIONS: [],
  generateInterviewQuestions: vi.fn(async () => [
    {
      question_text: 'Generated Q',
      question_type: 'hr',
      category: 'hr',
      difficulty: 'easy',
      required_skills: [],
      intent: 'test',
      question_order: 1,
      time_limit_sec: 120,
      is_mandatory_hr: false,
      weight: 10,
    },
  ]),
}));

function makeReq(body?: any) {
  return { json: async () => body ?? {} } as any;
}

function makeParams(id = 's1') {
  return { params: Promise.resolve({ id }) };
}

describe('POST /api/interviews/[id]/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.session = { id: 's1', parsed_resume: null, parsed_jd: null, skill_gap: null, duration_minutes: 30 };
    state.hrRows = [];
    state.bankRows = [];
    state.bankError = null;
    state.insertedQuestions = [{ id: 'q1' }];
    state.insertError = null;
  });

  it('returns the session-not-found error when the session does not exist', async () => {
    state.session = null;
    const res = await POST(makeReq(), makeParams('missing'));
    expect(res.status).toBe(404);
  });

  it('falls back to LLM-generated questions when no question_bank_ids are provided', async () => {
    const res = await POST(makeReq({}), makeParams());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.total_count).toBe(1);
  });

  it('uses exact question-bank rows when question_bank_ids is provided', async () => {
    state.bankRows = [
      {
        id: 'bank-1',
        question_text: 'Bank Q1',
        category: 'behavioral',
        difficulty: 'medium',
        required_skills: ['X'],
        intent: 'assess X',
        is_mandatory: true,
      },
    ];

    const res = await POST(makeReq({ question_bank_ids: ['bank-1'], duration_minutes: 10 }), makeParams());
    const body = await res.json();
    expect(res.status).toBe(200);
    // Since mock state.insertedQuestions has length 1, total_count is 1
    expect(body.total_count).toBe(1);
    
    // Verify that the dynamic technical questions are still requested and appended
    const { generateInterviewQuestions } = await import('@/lib/ai-interview/question-generator');
    expect(generateInterviewQuestions).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      [], // no mandatory HR
      expect.objectContaining({
        targetQuestions: 4,
        categoryCounts: { technical: 4 },
        includeMandatoryHr: false,
      })
    );
  });

  it('returns a 500 when the question-bank lookup errors', async () => {
    state.bankError = { message: 'bank lookup failed' };
    const res = await POST(makeReq({ question_bank_ids: ['bank-1'] }), makeParams());
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toBe('bank lookup failed');
  });

  it('returns a 400 when none of the selected question-bank IDs resolve', async () => {
    state.bankRows = [];
    const res = await POST(makeReq({ question_bank_ids: ['missing-id'] }), makeParams());
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/None of the selected/);
  });

  it('returns a 500 when inserting the generated questions fails', async () => {
    state.insertError = { message: 'insert failed' };
    const res = await POST(makeReq({}), makeParams());
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toBe('insert failed');
  });

  it('treats an unparseable request body as an empty object and still generates questions', async () => {
    const res = await POST({ json: async () => { throw new Error('boom'); } } as any, makeParams());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.total_count).toBe(1);
  });
});
