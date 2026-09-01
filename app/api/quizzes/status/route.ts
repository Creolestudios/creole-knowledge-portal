import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { buildQuizReviewData } from '@/lib/quizzes/review';
import { toValidUUID } from '@/lib/quizzes/review';
import {
  QUIZ_TIME_LIMIT_SECONDS,
  elapsedSecondsSince,
  resolveTimeTakenSeconds,
} from '@/lib/quizzes/timing';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const blogId = searchParams.get('blogId');

    if (!blogId) {
      return NextResponse.json({ error: 'Blog ID is required' }, { status: 400 });
    }

    const formattedBlogId = toValidUUID(blogId);

    const { data: existingAttempts, error: attemptsError } = await supabaseAdmin
      .from('quiz_attempts')
      .select('*')
      .eq('user_id', user.id)
      .eq('blog_id', formattedBlogId)
      .order('started_at', { ascending: false });

    if (attemptsError) {
      console.error('Error fetching attempts:', attemptsError);
      return NextResponse.json({ error: 'Failed to retrieve quiz status.' }, { status: 500 });
    }

    let finishedAttemptsCount = 0;
    if (existingAttempts && existingAttempts.length > 0) {
      if (existingAttempts.length > 1) {
        // Multi-row schema
        finishedAttemptsCount = existingAttempts.filter((a: any) => a.status === 'completed').length;
      } else {
        // Single-row schema with total_questions encoding (5=1st attempt, 15=2nd attempt, 25=3rd attempt)
        const single = existingAttempts[0];
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

    // Helper to fetch review details for a given attempt
    const getReviewDetails = async (attempt: any) => {
      const { data: fullAttempt } = await supabaseAdmin
        .from('quiz_attempts')
        .select('*, quiz_answers(points_awarded, question_id, is_correct, user_answer, evaluation_reason, match_percentage, created_at)')
        .eq('id', attempt.id)
        .single();

      const rawAnswers = fullAttempt?.quiz_answers || [];
      const sortedAnswers = [...rawAnswers].sort(
        (a: any, b: any) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
      );
      const answers = sortedAnswers.slice(-5);
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

      const correctAnswersCount = answers.filter((a: any) => a.is_correct).length;
      const reviewData = buildQuizReviewData(questions, answers);

      return {
        reviewData,
        maxPossibleScore,
        correctAnswersCount,
        totalQuestions: questions.length || 5
      };
    };

    // 1. Check if user passed any attempt
    const passingAttempt = existingAttempts?.find(a => a.passed || (a.score !== null && a.status === 'completed' && (a.percentage >= 60 || a.score >= 3)));
    
    if (passingAttempt) {
      const { reviewData, maxPossibleScore, correctAnswersCount, totalQuestions } = await getReviewDetails(passingAttempt);
      return NextResponse.json({
        completed: true,
        passed: true,
        attemptsCount: finishedAttemptsCount,
        attemptsRemaining,
        result: {
          score: passingAttempt.score,
          percentage: passingAttempt.percentage,
          timeTaken: passingAttempt.time_taken_seconds,
          total: maxPossibleScore,
          correctAnswers: correctAnswersCount,
          totalQuestions,
          reviewData,
          passed: true,
          attemptsCount: finishedAttemptsCount,
          attemptsRemaining
        }
      });
    }

    // 2. Check if there is an in-progress attempt
    const activeAttempt = existingAttempts?.find(a => a.status === 'in_progress');
    if (activeAttempt) {
      // Fetch questions assigned to this active attempt (latest 5 answers)
      const { data: activeAnswersData } = await supabaseAdmin
        .from('quiz_answers')
        .select('question_id, user_answer, created_at')
        .eq('attempt_id', activeAttempt.id)
        .order('created_at', { ascending: false })
        .limit(5);

      const activeAnswers = activeAnswersData ? (Array.isArray(activeAnswersData) ? activeAnswersData : (activeAnswersData as any)?.quiz_answers || []) : [];
      const questionIds = activeAnswers.map((a: any) => a.question_id).filter(Boolean);
      
      let questions: any[] = [];
      if (questionIds.length > 0) {
        const { data: qData } = await supabaseAdmin
          .from('quiz_questions')
          .select('id, question_type, difficulty, question, options, code_snippet')
          .in('id', questionIds);
        questions = qData || [];
      }

      if (questions.length === 0) {
        const { data: qData } = await supabaseAdmin
          .from('quiz_questions')
          .select('id, question_type, difficulty, question, options, code_snippet')
          .eq('blog_id', formattedBlogId)
          .limit(5);
        questions = qData || [];
      }

      if (questions.length > 0) {
        // Calculate remaining time for 20-min (1200s) idle window based on wall-clock
        const elapsedSeconds = elapsedSecondsSince(activeAttempt.started_at) ?? 0;
        const timeLeft = Math.max(0, QUIZ_TIME_LIMIT_SECONDS - elapsedSeconds);

        if (timeLeft <= 0) {
          // Time expired, auto-submit the quiz
          const { reviewData, maxPossibleScore, correctAnswersCount, totalQuestions } = await getReviewDetails(activeAttempt);
          const autoAnswers = activeAnswers || [];
          const totalScore = autoAnswers.reduce((sum: number, ans: any) => sum + (ans.points_awarded || 0), 0);
          const percentage = Math.round((totalScore / maxPossibleScore) * 100);
          const passed = percentage >= 60 || correctAnswersCount >= 3;
          const updatedAttemptsCount = finishedAttemptsCount + 1;

          // One value for both the stored row and the response -- these used to
          // disagree (1200 written, 600 returned) for the same attempt.
          const autoSubmitTimeTaken = resolveTimeTakenSeconds(activeAttempt.started_at);

          const autoSubmitPayload: any = {
            status: 'completed',
            completed_at: new Date().toISOString(),
            score: totalScore,
            percentage: percentage,
            time_taken_seconds: autoSubmitTimeTaken,
            passed: passed
          };

          let { error: autoSubmitErr } = await supabaseAdmin
            .from('quiz_attempts')
            .update(autoSubmitPayload)
            .eq('id', activeAttempt.id);

          if (autoSubmitErr && (autoSubmitErr.code === '42703' || autoSubmitErr.message.includes('passed'))) {
            delete autoSubmitPayload.passed;
            await supabaseAdmin
              .from('quiz_attempts')
              .update(autoSubmitPayload)
              .eq('id', activeAttempt.id);
          }

          return NextResponse.json({
            completed: true,
            passed: passed,
            failed: !passed && (updatedAttemptsCount >= 3),
            attemptsCount: updatedAttemptsCount,
            attemptsRemaining: Math.max(0, 3 - updatedAttemptsCount),
            result: {
              score: totalScore,
              percentage: percentage,
              timeTaken: autoSubmitTimeTaken,
              total: maxPossibleScore,
              correctAnswers: correctAnswersCount,
              totalQuestions,
              reviewData,
              passed: passed,
              attemptsCount: updatedAttemptsCount,
              attemptsRemaining: Math.max(0, 3 - updatedAttemptsCount)
            }
          });
        }

        const formattedAnswers: Record<string, any> = {};
        activeAnswers?.forEach((a: any) => {
          formattedAnswers[a.question_id] = a.user_answer;
        });

        return NextResponse.json({
          inProgress: true,
          attemptId: activeAttempt.id,
          timeLeft,
          questions: questions,
          answers: formattedAnswers,
          attemptsCount: finishedAttemptsCount,
          attemptsRemaining
        });
      }
    }

    // 3. Check if they have exhausted all 3 attempts
    if (finishedAttemptsCount >= 3) {
      // Failed all 3 attempts!
      const latestAttempt = existingAttempts?.[0];
      const { reviewData, maxPossibleScore, correctAnswersCount, totalQuestions } = await getReviewDetails(latestAttempt);
      return NextResponse.json({
        completed: true,
        passed: false,
        failed: true,
        attemptsCount: finishedAttemptsCount,
        attemptsRemaining: 0,
        result: {
          score: latestAttempt?.score || 0,
          percentage: latestAttempt?.percentage || 0,
          timeTaken: latestAttempt?.time_taken_seconds || 0,
          total: maxPossibleScore,
          correctAnswers: correctAnswersCount,
          totalQuestions,
          reviewData,
          passed: false,
          attemptsCount: finishedAttemptsCount,
          attemptsRemaining: 0
        }
      });
    }

    // 4. Default: not completed, not in-progress, has attempts remaining
    return NextResponse.json({
      completed: false,
      inProgress: false,
      attemptsCount: finishedAttemptsCount,
      attemptsRemaining
    });

  } catch (error: any) {
    console.error('Quiz status error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
