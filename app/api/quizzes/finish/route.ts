import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { attemptId, timeLeft } = await request.json();

    if (!attemptId) {
      return NextResponse.json({ error: 'Attempt ID is required' }, { status: 400 });
    }

    // Verify attempt belongs to user and is in_progress
    const { data: attempt } = await supabaseAdmin
      .from('quiz_attempts')
      .select('*, quiz_answers(points_awarded, question_id, is_correct, user_answer, evaluation_reason, quiz_questions(question, options, correct_answers, explanation, question_type))')
      .eq('id', attemptId)
      .eq('user_id', user.id)
      .single();

    if (!attempt || attempt.status !== 'in_progress') {
      return NextResponse.json({ error: 'Invalid or completed quiz attempt' }, { status: 403 });
    }

    const maxPossibleScore = 8; 

    const answers = attempt.quiz_answers || [];
    const totalScore = answers.reduce((sum: number, ans: any) => sum + (ans.points_awarded || 0), 0);
    const correctAnswersCount = answers.filter((ans: any) => ans.is_correct).length;
    const wrongAnswersCount = attempt.total_questions - correctAnswersCount;
    const percentage = Math.round((totalScore / maxPossibleScore) * 100);

    const completedAt = new Date();
    
    // Determine time taken either from passed in timeLeft or the last saved db value
    const storedTimeTaken = attempt.time_taken_seconds || 0;
    const timeTakenSeconds = timeLeft !== undefined ? Math.max(600 - timeLeft, storedTimeTaken) : storedTimeTaken;

    // Update attempt
    const { error: updateError } = await supabaseAdmin
      .from('quiz_attempts')
      .update({
        status: 'completed',
        completed_at: completedAt.toISOString(),
        score: totalScore,
        percentage: percentage,
        time_taken_seconds: timeTakenSeconds
      })
      .eq('id', attemptId);

    if (updateError) {
      throw updateError;
    }

    const { data: questions } = await supabaseAdmin
      .from('quiz_questions')
      .select('*')
      .eq('blog_id', attempt.blog_id)
      .limit(5);

    const reviewData = (questions || []).map((q: any) => {
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
        evaluationReason: ans?.evaluation_reason || 'No answer provided.'
      };
    });

    return NextResponse.json({
      success: true,
      result: {
        score: totalScore,
        total: maxPossibleScore,
        percentage,
        correctAnswers: correctAnswersCount,
        wrongAnswers: wrongAnswersCount,
        timeTaken: timeTakenSeconds,
        reviewData
      }
    });

  } catch (error: any) {
    console.error('Finish quiz error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
