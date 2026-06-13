import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { evaluateDescriptiveAnswer } from '@/lib/ai/quiz-evaluator';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { attemptId, questionId, userAnswer, timeLeft } = await request.json();

    if (!attemptId) {
      return NextResponse.json({ error: 'Missing attempt ID' }, { status: 400 });
    }

    // Verify attempt belongs to user and is in_progress
    const { data: attempt } = await supabaseAdmin
      .from('quiz_attempts')
      .select('*')
      .eq('id', attemptId)
      .eq('user_id', user.id)
      .single();

    if (!attempt || attempt.status !== 'in_progress') {
      return NextResponse.json({ error: 'Invalid or completed quiz attempt' }, { status: 403 });
    }

    if (!questionId || userAnswer === undefined) {
      return NextResponse.json({ success: true });
    }

    // Fetch the question to get the correct answers and type
    const { data: question } = await supabaseAdmin
      .from('quiz_questions')
      .select('*')
      .eq('id', questionId)
      .single();

    if (!question) {
      return NextResponse.json({ error: 'Question not found' }, { status: 404 });
    }

    let isCorrect = false;
    let pointsAwarded = 0;
    let evaluationReason = '';

    // Scoring Rules: SC=1, MS=2, Conceptual=1, Code/Descriptive=2
    if (question.question_type === 'single') {
      const correctStr = question.correct_answers[0]?.toLowerCase().trim() || '';
      const userStr = String(userAnswer).toLowerCase().trim();
      isCorrect = (correctStr === userStr);
      pointsAwarded = isCorrect ? 1 : 0;
    } else if (question.question_type === 'multiple') {
      // Expecting array of strings for MS
      const correctArray = (question.correct_answers || []).map((s: string) => s.toLowerCase().trim()).sort();
      const userArray = (Array.isArray(userAnswer) ? userAnswer : [userAnswer]).map((s: string) => String(s).toLowerCase().trim()).sort();
      
      isCorrect = correctArray.length === userArray.length && correctArray.every((v: string, i: number) => v === userArray[i]);
      pointsAwarded = isCorrect ? 2 : 0;
    } else {
      // AI Evaluation for Conceptual, Code Analysis, Descriptive
      const result = await evaluateDescriptiveAnswer(
        question.question_type,
        question.question,
        question.correct_answers || [],
        String(userAnswer)
      );
      isCorrect = result.isCorrect;
      pointsAwarded = result.points;
      evaluationReason = result.reason;
    }

    // Upsert into quiz_answers (allows updating answer before final submit)
    const { data: existingAnswer } = await supabaseAdmin
      .from('quiz_answers')
      .select('id')
      .eq('attempt_id', attemptId)
      .eq('question_id', questionId)
      .single();

    if (existingAnswer) {
      await supabaseAdmin
        .from('quiz_answers')
        .update({
          user_answer: userAnswer,
          is_correct: isCorrect,
          points_awarded: pointsAwarded,
          evaluation_reason: evaluationReason,
          created_at: new Date().toISOString()
        })
        .eq('id', existingAnswer.id);
    } else {
      await supabaseAdmin
        .from('quiz_answers')
        .insert({
          attempt_id: attemptId,
          question_id: questionId,
          user_answer: userAnswer,
          is_correct: isCorrect,
          points_awarded: pointsAwarded,
          evaluation_reason: evaluationReason
        });
    }

    return NextResponse.json({
      success: true,
      isCorrect,
      pointsAwarded,
      evaluationReason
    });

  } catch (error: any) {
    console.error('Evaluate answer error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
