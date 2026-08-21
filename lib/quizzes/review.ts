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
  const qMap = new Map((questions || []).map((q: any) => [q.id, q]));

  if (answers && answers.length > 0) {
    const reviewedAnswerIds = new Set<string>();
    const result: any[] = [];

    for (const ans of answers) {
      if (!ans.question_id || reviewedAnswerIds.has(ans.question_id)) continue;
      reviewedAnswerIds.add(ans.question_id);

      const q = qMap.get(ans.question_id) || {
        id: ans.question_id,
        question: 'Question',
        question_type: 'single',
        options: null,
        correct_answers: [],
        explanation: '',
      };

      result.push({
        questionId: q.id,
        question: q.question,
        questionType: q.question_type,
        options: q.options,
        correctAnswers: q.correct_answers,
        explanation: q.explanation,
        userAnswer: ans.user_answer ?? null,
        isCorrect: Boolean(ans.is_correct),
        pointsAwarded: ans.points_awarded || 0,
        evaluationReason: ans.evaluation_reason || fallbackReason,
      });
    }

    // Append any remaining questions from question bank if not present in answers
    for (const q of questions || []) {
      if (!reviewedAnswerIds.has(q.id)) {
        result.push({
          questionId: q.id,
          question: q.question,
          questionType: q.question_type,
          options: q.options,
          correctAnswers: q.correct_answers,
          explanation: q.explanation,
          userAnswer: null,
          isCorrect: false,
          pointsAwarded: 0,
          evaluationReason: fallbackReason,
        });
      }
    }

    return result;
  }

  return (questions || []).map((q: any) => {
    return {
      questionId: q.id,
      question: q.question,
      questionType: q.question_type,
      options: q.options,
      correctAnswers: q.correct_answers,
      explanation: q.explanation,
      userAnswer: null,
      isCorrect: false,
      pointsAwarded: 0,
      evaluationReason: fallbackReason,
    };
  });
}

export function toValidUUID(id: string): string {
  if (!id) return '00000000-0000-0000-0000-000000000000';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return id;
  }
  const clean = id.replace(/[^0-9a-f]/gi, '').toLowerCase();
  const padded = (clean + '00000000000000000000000000000000').slice(0, 32);
  return `${padded.slice(0, 8)}-${padded.slice(8, 12)}-${padded.slice(12, 16)}-${padded.slice(16, 20)}-${padded.slice(20, 32)}`;
}

