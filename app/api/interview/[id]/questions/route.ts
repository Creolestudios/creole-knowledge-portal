import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser, supabaseAdmin } from '@/lib/supabase/admin';
import { normalizeQuestionType, normalizeDifficulty, normalizeInteger } from '@/lib/ai-interview/types';

const DEFAULT_FALLBACK_QUESTIONS = [
  {
    question_text: 'Please introduce yourself and highlight the experiences most relevant to this role.',
    question_type: 'hr',
    category: 'hr',
    difficulty: 'easy',
    required_skills: ['Communication', 'Self-Awareness'],
    intent: 'Understand the candidate background and communication style.',
    time_limit_sec: 150,
    is_mandatory_hr: true,
    is_custom: false,
    weight: 10,
  },
  {
    question_text: 'Tell us about a challenging professional situation and what you learned from handling it.',
    question_type: 'behavioral',
    category: 'behavioral',
    difficulty: 'medium',
    required_skills: ['Reflection', 'Judgment'],
    intent: 'Assess behavior, ownership, and learning.',
    time_limit_sec: 150,
    is_mandatory_hr: false,
    is_custom: false,
    weight: 10,
  },
  {
    question_text: 'Walk us through your career journey and the choices that shaped it.',
    question_type: 'hr',
    category: 'experience_overview',
    difficulty: 'easy',
    required_skills: ['Communication', 'Career Overview'],
    intent: 'Understand career progression.',
    time_limit_sec: 150,
    is_mandatory_hr: false,
    is_custom: false,
    weight: 10,
  },
  {
    question_text: 'Describe a time you worked with people who had different working styles.',
    question_type: 'behavioral',
    category: 'teamwork',
    difficulty: 'medium',
    required_skills: ['Collaboration', 'Adaptability'],
    intent: 'Assess collaboration across differences.',
    time_limit_sec: 150,
    is_mandatory_hr: false,
    is_custom: false,
    weight: 10,
  },
  {
    question_text: 'What professional skills would you like to develop over the next few years?',
    question_type: 'hr',
    category: 'career_vision',
    difficulty: 'easy',
    required_skills: ['Growth Mindset', 'Career Planning'],
    intent: 'Understand development goals.',
    time_limit_sec: 150,
    is_mandatory_hr: false,
    is_custom: false,
    weight: 10,
  },
];

async function insertInterviewQuestions(sessionId: string, questions: any[]) {
  const rows = questions.map((question: Record<string, unknown>, index: number) => {
    const isCustom = question.is_custom === true || String(question.category || '') === 'custom';
    return {
      session_id: sessionId,
      question_bank_id:
        typeof question.id === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(question.id)
          ? question.id
          : null,
      question_text: String(question.question_text || ''),
      question_type: normalizeQuestionType(question.question_type, question.category as string),
      category: String(question.category || 'hr'),
      difficulty: normalizeDifficulty(question.difficulty),
      required_skills: Array.isArray(question.required_skills) ? question.required_skills : [],
      intent: question.intent || null,
      evaluation_rubric: {
        ...(typeof question.evaluation_rubric === 'object' && question.evaluation_rubric !== null
          ? question.evaluation_rubric
          : {}),
        is_custom: isCustom,
      },
      question_order: normalizeInteger(index + 1, index + 1, 1),
      time_limit_sec: normalizeInteger(question.time_limit_sec, 150, 30),
      is_mandatory_hr: question.is_mandatory_hr === true,
      is_custom: isCustom,
      weight: normalizeInteger(question.weight, 10, 1),
    };
  });

  let { data, error } = await supabaseAdmin
    .from('interview_questions')
    .insert(rows)
    .select('*');

  // Handle schema where is_custom column doesn't exist in interview_questions table
  if (error && (error.code === 'PGRST204' || error.message?.includes('is_custom'))) {
    const fallbackRows = rows.map(({ is_custom: _discard, ...rest }) => rest);
    const fallbackInsert = await supabaseAdmin
      .from('interview_questions')
      .insert(fallbackRows)
      .select('*');
    data = fallbackInsert.data;
    error = fallbackInsert.error;
  }

  return { data, error };
}

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

    const { data: createdQuestions, error: questionError } = await insertInterviewQuestions(id, questions);

    if (questionError) {
      return NextResponse.json({ error: questionError.message }, { status: 500 });
    }

    const mappedQuestions = (createdQuestions || []).map((q: any) => {
      if (q.is_custom !== undefined) return q;
      if (q.category === 'custom' || q.evaluation_rubric?.is_custom === true) {
        return { ...q, is_custom: true };
      }
      return q;
    });

    return NextResponse.json({ sessionId: id, questions: mappedQuestions });
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
    const adminUser = await requireAdminUser().catch(() => null);
    if (!adminUser) {
      return NextResponse.json({ error: 'Interview verification is required.' }, { status: 401 });
    }
  }

  // Check that the interview exists in ai_interviews
  const { data: interview } = await supabaseAdmin
    .from('ai_interviews')
    .select('id, status')
    .eq('id', id)
    .single();

  if (!interview) {
    return NextResponse.json({ error: 'Interview not found.' }, { status: 404 });
  }

  let { data: session, error: sessionError } = await supabaseAdmin
    .from('interview_sessions')
    .select('id, duration_minutes, question_count, status')
    .eq('id', id)
    .single();

  if (sessionError || !session) {
    return NextResponse.json({ error: 'Interview session not found.' }, { status: 404 });
  }

  let { data: questions, error: questionError } = await supabaseAdmin
    .from('interview_questions')
    .select('*')
    .eq('session_id', id)
    .order('question_order', { ascending: true });

  if (questionError) {
    return NextResponse.json({ error: questionError.message }, { status: 500 });
  }

  // Auto-seed default questions if no questions exist yet for this verified interview
  if (!questions || questions.length === 0) {
    const defaultDuration =
      session?.duration_minutes && session.duration_minutes > 0 ? session.duration_minutes : 15;

    await supabaseAdmin
      .from('interview_sessions')
      .upsert({
        id,
        question_count: DEFAULT_FALLBACK_QUESTIONS.length,
        duration_minutes: defaultDuration,
        status: 'questions_generated',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });

    const seedRes = await insertInterviewQuestions(id, DEFAULT_FALLBACK_QUESTIONS);
    if (!seedRes.error && seedRes.data) {
      questions = seedRes.data;
      session = {
        id,
        duration_minutes: defaultDuration,
        question_count: DEFAULT_FALLBACK_QUESTIONS.length,
        status: 'questions_generated',
      };
    }
  }

  if (!session || !session.duration_minutes || session.duration_minutes <= 0) {
    const fallbackDuration = 15;
    await supabaseAdmin
      .from('interview_sessions')
      .upsert({
        id,
        duration_minutes: fallbackDuration,
        question_count: questions?.length || 5,
        status: 'questions_generated',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
    session = {
      id,
      duration_minutes: fallbackDuration,
      question_count: questions?.length || 5,
      status: 'questions_generated',
    };
  }

  if (!questions || questions.length === 0) {
    return NextResponse.json(
      { error: 'Interview questions are not ready yet.' },
      { status: 404 },
    );
  }

  const mappedQuestions = questions.map((q: any) => ({
    ...q,
    is_custom: q.is_custom ?? (q.category === 'custom' || q.evaluation_rubric?.is_custom === true),
  }));

  return NextResponse.json({ session, questions: mappedQuestions });
}