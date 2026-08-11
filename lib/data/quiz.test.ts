import { describe, it, expect } from 'vitest';
import { scoreQuiz, isPassing } from './quiz';
import type { Quiz } from '@/types/contracts';

const quiz: Quiz = {
  quiz_id: 'q-test',
  questions: [
    { id: 'a', prompt: '1', options: ['x', 'y'], answerIndex: 0 },
    { id: 'b', prompt: '2', options: ['x', 'y'], answerIndex: 1 },
    { id: 'c', prompt: '3', options: ['x', 'y'], answerIndex: 0 },
  ],
};

describe('scoreQuiz', () => {
  it('scores all correct', () => {
    const r = scoreQuiz(quiz, { a: 0, b: 1, c: 0 }, '2026-06-30');
    expect(r.score).toBe(3);
    expect(r.total).toBe(3);
    expect(r.wrongIds).toEqual([]);
    expect(r.correctIds).toEqual(['a', 'b', 'c']);
  });

  it('marks wrong and unanswered as incorrect', () => {
    const r = scoreQuiz(quiz, { a: 1, b: 1 }, '2026-06-30');
    expect(r.score).toBe(1);
    expect(r.correctIds).toEqual(['b']);
    expect(r.wrongIds).toEqual(['a', 'c']);
  });

  it('carries the date through', () => {
    expect(scoreQuiz(quiz, {}, '2026-06-30').date).toBe('2026-06-30');
  });
});

describe('isPassing', () => {
  it('passes at 60% or more', () => {
    expect(isPassing(scoreQuiz(quiz, { a: 0, b: 1, c: 0 }, 'd'))).toBe(true); // 100%
    expect(isPassing(scoreQuiz(quiz, { a: 0, b: 1 }, 'd'))).toBe(true); // ~67%
  });

  it('fails below 60%', () => {
    expect(isPassing(scoreQuiz(quiz, { a: 0 }, 'd'))).toBe(false); // 33%
  });

  it('treats an empty quiz as not passing', () => {
    expect(
      isPassing({ quiz_id: 'e', date: 'd', score: 0, total: 0, correctIds: [], wrongIds: [] })
    ).toBe(false);
  });
});
