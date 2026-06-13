import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

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

    const { data: existingAttempts } = await supabaseAdmin
      .from('quiz_attempts')
      .select('*')
      .eq('user_id', user.id)
      .eq('blog_id', blogId)
      .order('started_at', { ascending: false })
      .limit(1);

    if (existingAttempts && existingAttempts.length > 0) {
      const attempt = existingAttempts[0];
      if (attempt.status === 'completed') {
        
        // Reconstruct the result format
        const totalPossible = Math.round((attempt.score / (attempt.percentage || 1)) * 100) || 8;
        
        // Fetch detailed answers for review
        const { data: fullAttempt } = await supabaseAdmin
          .from('quiz_attempts')
          .select('*, quiz_answers(points_awarded, question_id, is_correct, user_answer, evaluation_reason, quiz_questions(question, options, correct_answers, explanation, question_type))')
          .eq('id', attempt.id)
          .single();

        const { data: questions } = await supabaseAdmin
          .from('quiz_questions')
          .select('*')
          .eq('blog_id', attempt.blog_id)
          .limit(5);

        const answers = fullAttempt?.quiz_answers || [];

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
          completed: true,
          result: {
            score: attempt.score,
            percentage: attempt.percentage,
            timeTaken: attempt.time_taken_seconds,
            total: totalPossible,
            correctAnswers: Math.round((attempt.percentage / 100) * attempt.total_questions) || 0,
            reviewData
          }
        });
      } else {
        // Calculate remaining time (600s = 10 mins) based on stored time_taken_seconds instead of wall-clock
        const elapsedSeconds = attempt.time_taken_seconds || 0;
        const timeLeft = Math.max(0, 600 - elapsedSeconds);

        // Fetch questions
        const { data: questions } = await supabaseAdmin
          .from('quiz_questions')
          .select('id, question_type, difficulty, question, options, code_snippet')
          .eq('blog_id', blogId)
          .limit(5);

        // Fetch existing answers to restore state
        const { data: answers } = await supabaseAdmin
          .from('quiz_answers')
          .select('question_id, user_answer')
          .eq('attempt_id', attempt.id);

        const formattedAnswers: Record<string, any> = {};
        answers?.forEach(a => {
          formattedAnswers[a.question_id] = a.user_answer;
        });

        return NextResponse.json({
          inProgress: true,
          attemptId: attempt.id,
          timeLeft,
          questions: questions || [],
          answers: formattedAnswers
        });
      }
    }

    return NextResponse.json({
      completed: false,
      inProgress: false
    });

  } catch (error: any) {
    console.error('Quiz status error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
