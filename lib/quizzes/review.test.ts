import { describe, it, expect } from 'vitest';
import { buildQuizReviewData } from './review';

describe('buildQuizReviewData', () => {
  const questions = [
    {
      id: 'q1',
      question: 'What is a closure?',
      question_type: 'conceptual',
      options: null,
      correct_answers: ['A function with access to its outer scope'],
      explanation: 'Closures capture their lexical scope.',
    },
    {
      id: 'q2',
      question: 'What does useEffect do?',
      question_type: 'descriptive',
      options: null,
      correct_answers: ['Runs side effects'],
      explanation: 'It runs after render.',
    },
  ];

  it('merges questions with matching answers', () => {
    const answers = [
      {
        question_id: 'q1',
        user_answer: 'Captures outer scope',
        is_correct: true,
        points_awarded: 1,
        evaluation_reason: 'Correct',
      },
    ];

    const review = buildQuizReviewData(questions, answers);

    expect(review).toHaveLength(2);
    expect(review[0]).toMatchObject({
      questionId: 'q1',
      userAnswer: 'Captures outer scope',
      isCorrect: true,
      pointsAwarded: 1,
      evaluationReason: 'Correct',
    });
  });

  it('applies the default fallback reason when no answer exists', () => {
    const review = buildQuizReviewData(questions, []);

    expect(review[0].userAnswer).toBeNull();
    expect(review[0].isCorrect).toBe(false);
    expect(review[0].pointsAwarded).toBe(0);
    expect(review[0].evaluationReason).toBe('No answer provided.');
  });

  it('applies a custom fallback reason when provided', () => {
    const review = buildQuizReviewData(questions, [], 'Time expired.');

    expect(review[0].evaluationReason).toBe('Time expired.');
    expect(review[1].evaluationReason).toBe('Time expired.');
  });

  it('returns an empty array when there are no questions', () => {
    expect(buildQuizReviewData([], [])).toEqual([]);
    expect(buildQuizReviewData(undefined as any, [])).toEqual([]);
  });
});
