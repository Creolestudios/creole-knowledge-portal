/**
 * Builds the per-question review payload shared by the quiz finish/status
 * API routes: merges the fetched question bank with the user's recorded
 * answers so the client can render a scored review.
 */
export function buildQuizReviewData(
  questions: any[],
  answers: any[],
  fallbackReason = 'No answer provided.',
) {
  return (questions || []).map((q: any) => {
    const ans = answers.find((a: any) => a.question_id === q.id);
    return {
      questionId: q.id,
      question: q.question,
      questionType: q.question_type,
      options: q.options,
      correctAnswers: q.correct_answers,
      explanation: q.explanation,
      userAnswer: ans?.user_answer || null,
      isCorrect: ans?.is_correct || false,
      pointsAwarded: ans?.points_awarded || 0,
      evaluationReason: ans?.evaluation_reason || fallbackReason,
    };
  });
}
