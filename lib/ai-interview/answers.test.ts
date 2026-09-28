import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureAllQuestionsAnswered } from './answers';

const mockFrom = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (table: string) => mockFrom(table),
  },
}));

describe('ensureAllQuestionsAnswered', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when sessionId is empty', async () => {
    await ensureAllQuestionsAnswered('');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('inserts blank answers for missing questions', async () => {
    const questions = [
      { id: 'q1', question_order: 1 },
      { id: 'q2', question_order: 2 },
      { id: 'q3', question_order: 3 },
    ];
    const existingAnswers = [
      { question_id: 'q1' },
    ];

    let insertedRows: unknown[] = [];

    mockFrom.mockImplementation((table: string) => {
      if (table === 'interview_questions') {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({ data: questions, error: null }),
            }),
          }),
        };
      }
      if (table === 'interview_answers') {
        return {
          select: () => ({
            eq: async () => ({ data: existingAnswers, error: null }),
          }),
          insert: async (rows: unknown[]) => {
            insertedRows = rows;
            return { error: null };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    await ensureAllQuestionsAnswered('sess-123');

    expect(insertedRows).toHaveLength(2);
    expect(insertedRows).toEqual([
      {
        session_id: 'sess-123',
        question_id: 'q2',
        transcript: '',
        audio_storage_path: null,
        time_to_first_response_sec: 0,
        total_time_taken_sec: 0,
        score: 0,
      },
      {
        session_id: 'sess-123',
        question_id: 'q3',
        transcript: '',
        audio_storage_path: null,
        time_to_first_response_sec: 0,
        total_time_taken_sec: 0,
        score: 0,
      },
    ]);
  });

  it('does not insert anything when all questions already have answers', async () => {
    const questions = [{ id: 'q1', question_order: 1 }];
    const existingAnswers = [{ question_id: 'q1' }];
    const mockInsert = vi.fn();

    mockFrom.mockImplementation((table: string) => {
      if (table === 'interview_questions') {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({ data: questions, error: null }),
            }),
          }),
        };
      }
      if (table === 'interview_answers') {
        return {
          select: () => ({
            eq: async () => ({ data: existingAnswers, error: null }),
          }),
          insert: mockInsert,
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    await ensureAllQuestionsAnswered('sess-123');
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
