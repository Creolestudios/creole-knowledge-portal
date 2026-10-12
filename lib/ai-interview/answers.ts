import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Ensures that every question configured for an interview session has a corresponding
 * record in `interview_answers`. If the candidate did not answer or skipped a question
 * (or if the session terminated before reaching it), a blank answer (`transcript: ''`)
 * is recorded so that all questions and answers are consistently preserved.
 */
export async function ensureAllQuestionsAnswered(sessionId: string): Promise<void> {
  if (!sessionId) return;

  try {
    // 1. Fetch all questions assigned to this interview session
    const { data: questions, error: qErr } = await supabaseAdmin
      .from('interview_questions')
      .select('id, question_order')
      .eq('session_id', sessionId)
      .order('question_order', { ascending: true });

    if (qErr || !questions || questions.length === 0) return;

    // 2. Fetch existing answer records for this session
    const { data: existingAnswers, error: aErr } = await supabaseAdmin
      .from('interview_answers')
      .select('question_id')
      .eq('session_id', sessionId);

    if (aErr) {
      console.warn('[answers] Failed to fetch existing answers for session:', aErr.message);
      return;
    }

    const answeredQuestionIds = new Set((existingAnswers || []).map((a) => a.question_id));
    const missingQuestions = questions.filter((q) => !answeredQuestionIds.has(q.id));

    if (missingQuestions.length === 0) return;

    // 3. Insert blank records for any questions that lack an answer
    const blankRows = missingQuestions.map((q) => ({
      session_id: sessionId,
      question_id: q.id,
      transcript: '',
      audio_storage_path: null,
      time_to_first_response_sec: 0,
      total_time_taken_sec: 0,
      score: 0,
    }));

    const { error: insertErr } = await supabaseAdmin
      .from('interview_answers')
      .insert(blankRows);

    if (insertErr) {
      console.warn('[answers] Could not insert blank answers for session:', insertErr.message);
    }
  } catch (err) {
    console.error('[answers] Error in ensureAllQuestionsAnswered:', err);
  }
}
