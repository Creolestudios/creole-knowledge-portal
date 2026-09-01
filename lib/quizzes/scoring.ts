/**
 * Quiz pass/score rules, shared so the API, the activity log and the result
 * screen cannot drift apart.
 */

/** Questions served per attempt. */
export const QUIZ_QUESTIONS_PER_ATTEMPT = 5;

/** Correct answers needed to pass an attempt. */
export const QUIZ_PASS_CORRECT_ANSWERS = 3;

/** Attempts a user gets per blog. */
export const QUIZ_MAX_ATTEMPTS = 3;

export function hasPassedQuiz(correctAnswers: number): boolean {
  return correctAnswers >= QUIZ_PASS_CORRECT_ANSWERS;
}

export type QuizAnswerRow = {
  is_correct?: boolean | null;
  created_at?: string | null;
};

export type AttemptSummary = {
  attemptNumber: number;
  correctAnswers: number;
  totalQuestions: number;
  passed: boolean;
  completedAt: string | null;
  inProgress: boolean;
};

/**
 * Split one `quiz_attempts` row into the attempts it actually represents.
 *
 * Where the database still carries the single-attempt unique constraint, the
 * start route reuses one row for all three attempts and simply appends another
 * five answers each time (`total_questions` grows 5 -> 15 -> 25). Chunking the
 * answers by five recovers the individual attempts in both schemas, so the
 * activity log can show them separately instead of as one merged total.
 */
export function summarizeAttemptRow(
  row: {
    status?: string | null;
    completed_at?: string | null;
    attempt_number?: number | null;
    quiz_answers?: QuizAnswerRow[] | null;
  },
  startingAttemptNumber = 1,
): AttemptSummary[] {
  const answers = [...(row.quiz_answers || [])].sort(
    (a, b) =>
      new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime(),
  );

  if (answers.length === 0) {
    return [];
  }

  const chunks: QuizAnswerRow[][] = [];
  for (let i = 0; i < answers.length; i += QUIZ_QUESTIONS_PER_ATTEMPT) {
    chunks.push(answers.slice(i, i + QUIZ_QUESTIONS_PER_ATTEMPT));
  }

  const base = row.attempt_number ?? startingAttemptNumber;

  return chunks.map((chunk, index) => {
    const correctAnswers = chunk.filter((a) => a.is_correct === true).length;
    // Only the final chunk can still be open; earlier ones were superseded.
    const isLast = index === chunks.length - 1;
    const inProgress = isLast && row.status === 'in_progress';

    return {
      attemptNumber: base + index,
      correctAnswers,
      totalQuestions: chunk.length,
      passed: !inProgress && hasPassedQuiz(correctAnswers),
      completedAt: isLast ? (row.completed_at ?? null) : null,
      inProgress,
    };
  });
}
