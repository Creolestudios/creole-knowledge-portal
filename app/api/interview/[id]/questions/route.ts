import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser, supabaseAdmin } from '@/lib/supabase/admin';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await requireAdminUser())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;
    const body = await req.json();
    const questions = Array.isArray(body.questions) ? body.questions : [];
    const durationMinutes = Number(body.durationMinutes);

    if (!questions.length || !Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      return NextResponse.json({ error: 'Questions and interview duration are required.' }, { status: 400 });
    }

    const { data: interview, error: interviewError } = await supabaseAdmin
      .from('ai_interviews')
      .select('id')
      .eq('id', id)
      .single();

    if (interviewError || !interview) {
      return NextResponse.json({ error: 'Interview not found.' }, { status: 404 });
    }

    const { error: sessionError } = await supabaseAdmin
      .from('interview_sessions')
      .upsert({
        id,
        question_count: questions.length,
        duration_minutes: durationMinutes,
        status: 'questions_generated',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });

    if (sessionError) {
      return NextResponse.json({ error: sessionError.message }, { status: 500 });
    }

    await supabaseAdmin.from('interview_questions').delete().eq('session_id', id);

    const rows = questions.map((question: Record<string, unknown>, index: number) => ({
      session_id: id,
      question_bank_id: typeof question.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(question.id)
        ? question.id
        : null,
      question_text: String(question.question_text || ''),
      question_type: question.question_type || 'hr',
      category: String(question.category || 'hr'),
      difficulty: question.difficulty || 'medium',
      required_skills: Array.isArray(question.required_skills) ? question.required_skills : [],
      intent: question.intent || null,
      question_order: index + 1,
      time_limit_sec: typeof question.time_limit_sec === 'number' ? question.time_limit_sec : 150,
      is_mandatory_hr: question.is_mandatory_hr === true,
      weight: typeof question.weight === 'number' ? question.weight : 10,
    }));

    const { data: createdQuestions, error: questionError } = await supabaseAdmin
      .from('interview_questions')
      .insert(rows)
      .select('*');

    if (questionError) {
      return NextResponse.json({ error: questionError.message }, { status: 500 });
    }

    return NextResponse.json({ sessionId: id, questions: createdQuestions || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to assign interview questions.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (req.cookies.get('interview_verified_id')?.value !== id) {
    return NextResponse.json({ error: 'Interview verification is required.' }, { status: 401 });
  }
  const { data: session, error: sessionError } = await supabaseAdmin
    .from('interview_sessions')
    .select('id, duration_minutes, question_count, status')
    .eq('id', id)
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: 'Interview questions are not ready.' }, { status: 404 });
  }

  const { data: questions, error: questionError } = await supabaseAdmin
    .from('interview_questions')
    .select('*')
    .eq('session_id', id)
    .order('question_order', { ascending: true });

  if (questionError) {
    return NextResponse.json({ error: questionError.message }, { status: 500 });
  }

  return NextResponse.json({ session, questions: questions || [] });
}