import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  hashPasscode,
  isInviteExpired,
} from '@/lib/ai-interview/invite-token';
import { validateActiveAssessToken } from '@/lib/ai-interview/assess-utils';

export const runtime = 'nodejs';

/**
 * POST /api/assess/[token]/verify
 *
 * Public endpoint hit by the candidate-facing `/assess/[token]` page. Given
 * the invite token from the URL and the passcode the candidate typed in,
 * validates both against `interview_invites`, then returns the session's
 * generated questions so the interview can start.
 *
 * Body: { passcode: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const body = await req.json().catch(() => null);
  const passcode = (body?.passcode as string | undefined)?.trim();

  if (!passcode) {
    return NextResponse.json({ error: 'Passcode is required' }, { status: 400 });
  }

  const { invite, errorResponse } = await validateActiveAssessToken(token, false);
  if (errorResponse || !invite) return errorResponse;

  if (invite.status === 'revoked' || invite.status === 'expired') {
    return NextResponse.json({ error: 'This interview link is no longer active' }, { status: 410 });
  }

  if (invite.status === 'completed') {
    return NextResponse.json({ error: 'This interview has already been completed' }, { status: 410 });
  }

  if (isInviteExpired(invite)) {
    await supabaseAdmin
      .from('interview_invites')
      .update({ status: 'expired' })
      .eq('id', invite.id);
    return NextResponse.json({ error: 'This interview link has expired' }, { status: 410 });
  }

  if (!invite.passcode_hash || !invite.passcode_salt) {
    return NextResponse.json({ error: 'This invite is misconfigured. Contact your interviewer.' }, { status: 500 });
  }

  const suppliedHash = hashPasscode(passcode, invite.passcode_salt);
  if (suppliedHash !== invite.passcode_hash) {
    return NextResponse.json({ error: 'Incorrect passcode' }, { status: 401 });
  }

  const { data: session, error: sessionErr } = await supabaseAdmin
    .from('interview_sessions')
    .select('id, candidate_name, status')
    .eq('id', invite.session_id)
    .single();

  if (sessionErr || !session) {
    return NextResponse.json({ error: 'Interview session not found' }, { status: 404 });
  }

  if (session.status === 'completed' || session.status === 'cancelled') {
    return NextResponse.json({ error: 'This interview has already ended' }, { status: 410 });
  }

  const { data: questions, error: questionsErr } = await supabaseAdmin
    .from('interview_questions')
    .select('id, question_text, question_type, category, difficulty, question_order, time_limit_sec, is_mandatory_hr')
    .eq('session_id', invite.session_id)
    .order('question_order', { ascending: true });

  if (questionsErr || !questions || questions.length === 0) {
    return NextResponse.json(
      { error: 'No interview questions have been generated for this session yet' },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();

  if (invite.status === 'active') {
    await supabaseAdmin
      .from('interview_invites')
      .update({ status: 'in_progress', consumed_at: now })
      .eq('id', invite.id);
  }

  if (session.status === 'invite_issued' || session.status === 'questions_generated') {
    await supabaseAdmin
      .from('interview_sessions')
      .update({ status: 'in_progress', updated_at: now })
      .eq('id', invite.session_id);
  }

  return NextResponse.json({
    verified: true,
    session_id: invite.session_id,
    candidate_name: session.candidate_name,
    questions,
  });
}
