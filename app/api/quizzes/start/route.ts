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

    const { blogId } = await request.json();

    if (!blogId) {
      return NextResponse.json({ error: 'Blog ID is required' }, { status: 400 });
    }

    // Enforce retry restriction (maxAttempts = 1)
    const { count } = await supabaseAdmin
      .from('quiz_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('blog_id', blogId);

    if (count && count >= 1) {
      return NextResponse.json({ error: 'You have already attempted the quiz for this blog.' }, { status: 403 });
    }

    // Fetch the 5 questions generated for this blog
    const { data: questions, error: questionsError } = await supabaseAdmin
      .from('quiz_questions')
      .select('id, question_type, difficulty, question, options, code_snippet')
      .eq('blog_id', blogId)
      .limit(5);

    if (questionsError || !questions || questions.length === 0) {
      return NextResponse.json({ error: 'No quiz found for this blog.' }, { status: 404 });
    }

    // Randomize order of questions for a varied experience (Fisher-Yates shuffle)
    const randomizedQuestions = [...questions];
    for (let i = randomizedQuestions.length - 1; i > 0; i--) {
      const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
      [randomizedQuestions[i], randomizedQuestions[j]] = [randomizedQuestions[j], randomizedQuestions[i]];
    }

    // Create a new attempt record
    const { data: attempt, error: attemptError } = await supabaseAdmin
      .from('quiz_attempts')
      .insert({
        user_id: user.id,
        blog_id: blogId,
        status: 'in_progress',
        total_questions: randomizedQuestions.length
      })
      .select('*')
      .single();

    if (attemptError) {
      console.error('Failed to start quiz attempt:', attemptError);
      return NextResponse.json({ error: 'Failed to start quiz.' }, { status: 500 });
    }

    return NextResponse.json({
      attemptId: attempt.id,
      questions: randomizedQuestions,
      startedAt: attempt.started_at,
    });

  } catch (error: any) {
    console.error('Start quiz error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
