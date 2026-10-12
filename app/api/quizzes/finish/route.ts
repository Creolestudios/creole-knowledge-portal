import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requireUser } from '@/lib/api/require-user';
import { buildQuizReviewData } from '@/lib/quizzes/review';
import { blogServiceHeaders, blogServiceUrl } from '@/lib/blog-service';
import { buildLearningPathQuizPayload } from '@/lib/quizzes/learning-path-sync';
import { resolveTimeTakenSeconds } from '@/lib/quizzes/timing';
import { QUIZ_QUESTIONS_PER_ATTEMPT, hasPassedQuiz, calculateFinishedAttempts, calculateMaxPossibleScore } from '@/lib/quizzes/scoring';

async function syncQuizLearningPathToMongo(
  userId: string,
  blogId: string,
  fallbackScore: number,
  fallbackTotal: number,
  fallbackPassed: boolean,
) {
  try {
    const { data: attempts } = await supabaseAdmin
      .from('quiz_attempts')
      .select(
        'id, status, score, percentage, passed, attempt_number, blog_id, quiz_answers(question_id, is_correct, points_awarded)',
      )
      .eq('user_id', userId)
      .eq('blog_id', blogId)
      .eq('status', 'completed')
      .order('attempt_number', { ascending: true });

    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('primary_tech_stack, secondary_tech_stack, interests, current_role')
      .eq('user_id', userId)
      .maybeSingle();

    const completed = attempts || [];
    const questionIds = [
      ...new Set(
        completed.flatMap((a: any) =>
          (a.quiz_answers || []).map((ans: any) => ans.question_id).filter(Boolean),
        ),
      ),
    ];

    let questions: any[] = [];
    if (questionIds.length > 0) {
      const { data: qData } = await supabaseAdmin
        .from('quiz_questions')
        .select('id, question, question_type')
        .in('id', questionIds);
      questions = qData || [];
    }

    const profileTerms = [
      ...(profile?.primary_tech_stack || []),
      ...(profile?.secondary_tech_stack || []),
      ...(profile?.interests || []),
      profile?.current_role,
    ].filter(Boolean) as string[];

    const payload = buildLearningPathQuizPayload(
      blogId,
      completed,
      questions,
      fallbackScore,
      fallbackTotal,
      fallbackPassed,
      profileTerms,
    );

    await fetch(blogServiceUrl(`/profiles/${userId}/quiz`), {
      method: 'POST',
      headers: blogServiceHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    console.warn('Quiz learning path was not synced to Mongo:', err);
  }
}

export async function POST(request: Request) {
  try {
    const { user, errorResponse } = await requireUser();
    if (errorResponse) return errorResponse;

    const { attemptId, clientElapsedSeconds } = await request.json();

    if (!attemptId) {
      return NextResponse.json({ error: 'Attempt ID is required' }, { status: 400 });
    }

    // Verify attempt belongs to user and is in_progress
    const { data: attempt } = await supabaseAdmin
      .from('quiz_attempts')
      .select('*, quiz_answers(points_awarded, question_id, is_correct, user_answer, evaluation_reason, match_percentage, created_at)')
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
    const answers = sortedAnswers.slice(-QUIZ_QUESTIONS_PER_ATTEMPT);
    const totalScore = answers.reduce((sum: number, ans: any) => sum + (ans.points_awarded || 0), 0);
    const correctAnswersCount = answers.filter((ans: any) => ans.is_correct).length;
    const passed = hasPassedQuiz(correctAnswersCount);

    const completedAt = new Date();
    
    // Server wall-clock is authoritative; the client value may only lower it
    // (correcting a resumed attempt, whose started_at is never reset).
    const timeTakenSeconds = resolveTimeTakenSeconds(
      attempt.started_at,
      clientElapsedSeconds,
      completedAt.getTime(),
    );

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

    const maxPossibleScore = calculateMaxPossibleScore(questions);

    const wrongAnswersCount = Math.max(0, questions.length - correctAnswersCount);
    const percentage = Math.round((totalScore / maxPossibleScore) * 100);

    // Persist the accurate percentage now that max score is known
    await supabaseAdmin
      .from('quiz_attempts')
      .update({ percentage })
      .eq('id', attemptId);

    const reviewData = buildQuizReviewData(questions, answers);

    const { data: allUserAttempts } = await supabaseAdmin
      .from('quiz_attempts')
      .select('id, status, total_questions')
      .eq('user_id', user.id)
      .eq('blog_id', attempt.blog_id);

    const { finishedAttemptsCount, attemptsRemaining } = calculateFinishedAttempts(allUserAttempts);

    // Bridge: all attempts' answers → Mongo learning_path for next-day scrape
    await syncQuizLearningPathToMongo(
      user.id,
      attempt.blog_id,
      totalScore,
      maxPossibleScore,
      passed,
    );

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
