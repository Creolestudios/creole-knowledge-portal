/**
 * Quiz scoring helpers. Pure functions — no DOM, unit-tested directly.
 */
import type { Quiz, QuizResult, ISODate } from '@/types/contracts';

/** Score a set of answers against a quiz. `answers` maps question id -> chosen option index. */
export function scoreQuiz(quiz: Quiz, answers: Record<string, number>, date: ISODate): QuizResult {
  const correctIds: string[] = [];
  const wrongIds: string[] = [];

  for (const q of quiz.questions) {
    if (answers[q.id] === q.answerIndex) {
      correctIds.push(q.id);
    } else {
      wrongIds.push(q.id);
    }
  }

  return {
    quiz_id: quiz.quiz_id,
    date,
    score: correctIds.length,
    total: quiz.questions.length,
    correctIds,
    wrongIds,
  };
}

/** A quiz is "passed" at 60% or more correct. */
export function isPassing(result: QuizResult): boolean {
  if (result.total === 0) return false;
  return result.score / result.total >= 0.6;
}
