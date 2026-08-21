import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { buildQuizReviewData } from '@/lib/quizzes/review';

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
      .select('*, quiz_answers(points_awarded, question_id, is_correct, user_answer, evaluation_reason, created_at)')
      .eq('id', attemptId)
      .eq('user_id', user.id)
      .single();

    if (!attempt || attempt.status !== 'in_progress') {
      return NextResponse.json({ error: 'Invalid or completed quiz attempt' }, { status: 403 });
    }

    const rawAnswers = attempt.quiz_answers || [];
    const sortedAnswers = [...rawAnswers].sort(
      (a: any, b: any) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
    );
    const answers = sortedAnswers.slice(-5);
    const totalScore = answers.reduce((sum: number, ans: any) => sum + (ans.points_awarded || 0), 0);
    const correctAnswersCount = answers.filter((ans: any) => ans.is_correct).length;
    const passed = correctAnswersCount >= 3;

    const completedAt = new Date();
    
    // Determine time taken based on wall-clock
    const elapsedSeconds = Math.floor((Date.now() - new Date(attempt.started_at).getTime()) / 1000);
    const timeTakenSeconds = Math.min(600, Math.max(0, elapsedSeconds));

    // Update attempt
    const updatePayload: any = {
      status: 'completed',
      completed_at: completedAt.toISOString(),
      score: totalScore,
      percentage: Math.round((totalScore / 5) * 100),
      time_taken_seconds: timeTakenSeconds,
      passed: passed
    };

    let { error: updateError } = await supabaseAdmin
      .from('quiz_attempts')
      .update(updatePayload)
      .eq('id', attemptId);

    if (updateError && (updateError.code === '42703' || updateError.message.includes('passed'))) {
      delete updatePayload.passed;
      const retryResult = await supabaseAdmin
        .from('quiz_attempts')
        .update(updatePayload)
        .eq('id', attemptId);
      updateError = retryResult.error;
    }

    if (updateError) {
      throw updateError;
    }

    const questionIds = answers.map((a: any) => a.question_id);
    let questions: any[] = [];
    if (questionIds.length > 0) {
      const { data: qData } = await supabaseAdmin
        .from('quiz_questions')
        .select('*')
        .in('id', questionIds);
      questions = qData || [];
    }

    let maxPossibleScore = 0;
    questions.forEach((q: any) => {
      if (['multiple', 'code', 'descriptive'].includes(q.question_type)) {
        maxPossibleScore += 2;
      } else {
        maxPossibleScore += 1;
      }
    });
    if (maxPossibleScore === 0) maxPossibleScore = 5;

    const wrongAnswersCount = Math.max(0, questions.length - correctAnswersCount);
    const percentage = Math.round((totalScore / maxPossibleScore) * 100);

    const reviewData = buildQuizReviewData(questions, answers);

    const { data: allUserAttempts } = await supabaseAdmin
      .from('quiz_attempts')
      .select('id, status, total_questions')
      .eq('user_id', user.id)
      .eq('blog_id', attempt.blog_id);

    let finishedAttemptsCount = 0;
    if (allUserAttempts && allUserAttempts.length > 0) {
      if (allUserAttempts.length > 1) {
        finishedAttemptsCount = allUserAttempts.filter((a: any) => a.status === 'completed').length;
      } else {
        const single = allUserAttempts[0];
        const tq = single.total_questions || 5;
        const attemptNum = tq >= 25 ? 3 : (tq >= 15 ? 2 : 1);
        if (single.status === 'completed') {
          finishedAttemptsCount = attemptNum;
        } else {
          finishedAttemptsCount = Math.max(0, attemptNum - 1);
        }
      }
    }
    const attemptsRemaining = Math.max(0, 3 - finishedAttemptsCount);

    return NextResponse.json({
      success: true,
      passed,
      attemptsCount: finishedAttemptsCount,
      attemptsRemaining,
      result: {
        score: totalScore,
        total: maxPossibleScore,
        percentage,
        correctAnswers: correctAnswersCount,
        wrongAnswers: wrongAnswersCount,
        totalQuestions: questions.length,
        timeTaken: timeTakenSeconds,
        reviewData,
        passed,
        attemptsCount: finishedAttemptsCount,
        attemptsRemaining
      }
    });

  } catch (error: any) {
    console.error('Finish quiz error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
