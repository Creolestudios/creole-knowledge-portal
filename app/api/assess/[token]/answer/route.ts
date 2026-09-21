import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { validateActiveAssessToken } from '@/lib/ai-interview/assess-utils';

export const runtime = 'nodejs';

/**
 * POST /api/assess/[token]/answer
 *
 * Public endpoint. Records a candidate's answer to one interview question
 * during a live `/assess/[token]` session. Requires the invite to still be
 * `in_progress` — a revoked/completed/expired invite can no longer submit
 * answers even with a valid token.
 *
 * Body: { question_id: string, transcript: string, time_to_first_response_sec?: number, total_time_taken_sec?: number }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const body = await req.json().catch(() => null);
  const questionId = body?.question_id as string | undefined;
  const transcript = (body?.transcript as string | undefined) ?? '';
  const timeToFirstResponseSec = Number(body?.time_to_first_response_sec) || 0;
  const totalTimeTakenSec = Number(body?.total_time_taken_sec) || 0;

  if (!questionId) {
    return NextResponse.json({ error: 'question_id is required' }, { status: 400 });
  }

  const { invite, errorResponse } = await validateActiveAssessToken(token);
  if (errorResponse || !invite) return errorResponse;

  const { data: question, error: questionErr } = await supabaseAdmin
    .from('interview_questions')
    .select('id, session_id')
    .eq('id', questionId)
    .eq('session_id', invite.session_id)
    .single();

  if (questionErr || !question) {
    return NextResponse.json({ error: 'Question does not belong to this session' }, { status: 400 });
  }

  const { data: answer, error: insertErr } = await supabaseAdmin
    .from('interview_answers')
    .insert({
      session_id: invite.session_id,
      question_id: questionId,
      transcript,
      time_to_first_response_sec: timeToFirstResponseSec,
      total_time_taken_sec: totalTimeTakenSec,
    })
    .select('id')
    .single();

  if (insertErr || !answer) {
    return NextResponse.json({ error: insertErr?.message || 'Failed to save answer' }, { status: 500 });
  }

  return NextResponse.json({ saved: true, answer_id: answer.id });
}
