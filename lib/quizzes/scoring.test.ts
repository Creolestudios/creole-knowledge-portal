import { describe, it, expect } from 'vitest';
import {
  QUIZ_PASS_CORRECT_ANSWERS,
  hasPassedQuiz,
  summarizeAttemptRow,
} from './scoring';

const answer = (correct: boolean, minute: number) => ({
  is_correct: correct,
  created_at: `2026-09-03T10:${String(minute).padStart(2, '0')}:00Z`,
});

describe('hasPassedQuiz', () => {
  it('passes at three correct answers and fails below', () => {
    expect(QUIZ_PASS_CORRECT_ANSWERS).toBe(3);
    expect(hasPassedQuiz(3)).toBe(true);
    expect(hasPassedQuiz(5)).toBe(true);
    expect(hasPassedQuiz(2)).toBe(false);
    expect(hasPassedQuiz(0)).toBe(false);
  });
});

describe('summarizeAttemptRow', () => {
  it('summarises a single completed attempt', () => {
    const summaries = summarizeAttemptRow({
      status: 'completed',
      completed_at: '2026-09-03T10:30:00Z',
      attempt_number: 1,
      quiz_answers: [
        answer(true, 1), answer(true, 2), answer(false, 3), answer(false, 4), answer(false, 5),
      ],
    });

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      attemptNumber: 1,
      correctAnswers: 2,
      totalQuestions: 5,
      passed: false,
      inProgress: false,
    });
  });

  it('splits a reused row into one summary per attempt', () => {
    // The single-attempt unique constraint makes the start route append another
    // five answers to the same row instead of inserting a new one.
    const summaries = summarizeAttemptRow({
      status: 'completed',
      completed_at: '2026-09-03T12:00:00Z',
      attempt_number: 1,
      quiz_answers: [
        // Attempt 1 -> 1 correct (failed)
        answer(true, 1), answer(false, 2), answer(false, 3), answer(false, 4), answer(false, 5),
        // Attempt 2 -> 3 correct (passed)
        answer(true, 6), answer(true, 7), answer(true, 8), answer(false, 9), answer(false, 10),
        // Attempt 3 -> 5 correct (passed)
        answer(true, 11), answer(true, 12), answer(true, 13), answer(true, 14), answer(true, 15),
      ],
    });

    expect(summaries).toHaveLength(3);
    expect(summaries.map((a) => a.attemptNumber)).toEqual([1, 2, 3]);
    expect(summaries.map((a) => a.correctAnswers)).toEqual([1, 3, 5]);
    expect(summaries.map((a) => a.passed)).toEqual([false, true, true]);
    // Only the final chunk carries the row's completion timestamp.
    expect(summaries[0].completedAt).toBeNull();
    expect(summaries[2].completedAt).toBe('2026-09-03T12:00:00Z');
  });

  it('orders answers by creation time before chunking', () => {
    const summaries = summarizeAttemptRow({
      status: 'completed',
      quiz_answers: [
        answer(true, 9), answer(true, 8), answer(true, 7), answer(true, 6),
        answer(false, 1), answer(false, 2), answer(false, 3), answer(false, 4),
        answer(false, 5), answer(true, 10),
      ],
    });

    expect(summaries.map((a) => a.correctAnswers)).toEqual([0, 5]);
  });

  it('marks only the last chunk of an unfinished row as in progress', () => {
    const summaries = summarizeAttemptRow({
      status: 'in_progress',
      completed_at: null,
      attempt_number: 1,
      quiz_answers: [
        answer(true, 1), answer(true, 2), answer(true, 3), answer(true, 4), answer(true, 5),
        answer(true, 6), answer(true, 7), answer(true, 8),
      ],
    });

    expect(summaries[0].inProgress).toBe(false);
    expect(summaries[0].passed).toBe(true);
    // Still open, so it is not reported as passed even with 3 correct so far.
    expect(summaries[1].inProgress).toBe(true);
    expect(summaries[1].passed).toBe(false);
    expect(summaries[1].totalQuestions).toBe(3);
  });

  it('returns nothing for a row with no answers', () => {
    expect(summarizeAttemptRow({ status: 'in_progress', quiz_answers: [] })).toEqual([]);
    expect(summarizeAttemptRow({ status: 'in_progress' })).toEqual([]);
  });

  it('falls back to the given starting number when attempt_number is absent', () => {
    const summaries = summarizeAttemptRow(
      { status: 'completed', quiz_answers: [answer(true, 1)] },
      2,
    );
    expect(summaries[0].attemptNumber).toBe(2);
  });
});
