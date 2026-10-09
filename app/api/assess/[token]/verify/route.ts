import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  hashPasscode,
  isInviteExpired,
} from '@/lib/ai-interview/invite-token';
import { validateActiveAssessToken } from '@/lib/ai-interview/assess-utils';
import {
  acquireJoinLock,
  releaseJoinLock,
  registerActiveSession,
  CONCURRENT_SESSION_ERROR,
} from '@/lib/ai-interview/session-lock';

export const runtime = 'nodejs';

/**
 * GET /api/assess/[token]/verify
 *
 * Checks if the assess link is still active and valid for single-use access.
 * If already consumed or completed, returns 410 with expired status.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) {
    return NextResponse.json({ error: 'Token is required' }, { status: 400 });
  }

  const { invite, errorResponse } = await validateActiveAssessToken(token, false);
  if (errorResponse || !invite) return errorResponse;

  if (isInviteExpired(invite)) {
    return NextResponse.json({
      error: 'This interview link has expired',
      note: 'Note: This interview link has expired.',
      expired: true,
      expirationReason: 'time_expired',
      reasonTitle: 'Assessment Deadline Expired',
      reasonDetail: 'The scheduled invitation window to access and take this interview has elapsed.',
    }, { status: 410 });
  }

  const { data: session } = await supabaseAdmin
    .from('interview_sessions')
    .select('id, status, voice_warning_count, face_warning_count, object_warning_count')
    .eq('id', invite.session_id)
    .maybeSingle();

  if (invite.status === 'completed' || session?.status === 'completed') {
    return NextResponse.json({
      error: 'This interview has already been completed.',
      note: 'Note: This interview link has already been used and is expired.',
      expired: true,
      used: true,
      status: 'completed',
      expirationReason: 'completed',
      reasonTitle: 'Interview Already Completed',
      reasonDetail: 'This interview session has already been successfully submitted and completed. All answers are finalized.',
    }, { status: 410 });
  }

  if (invite.status === 'revoked' || session?.status === 'cancelled' || session?.status === 'terminated') {
    return NextResponse.json({
      error: 'This interview link has already been used and is expired',
      note: 'Note: This interview link has already been used and is expired.',
      expired: true,
      used: true,
      status: 'expired',
      expirationReason: 'already_used',
      reasonTitle: 'Link is expired',
      reasonDetail: 'For security and assessment integrity, each interview link is strictly single-use. Because this link has already been accessed, it cannot be opened again.',
    }, { status: 410 });
  }

  if (
    invite.consumed_at ||
    invite.status === 'in_progress' ||
    invite.status === 'expired' ||
    session?.status === 'in_progress'
  ) {
    return NextResponse.json({
      error: 'This interview link has already been used and is expired',
      note: 'Note: This interview link has already been used and is expired.',
      expired: true,
      used: true,
      status: invite.status,
      expirationReason: 'already_used',
      reasonTitle: 'Link is expired',
      reasonDetail: 'For security and assessment integrity, each interview link is strictly single-use. Because this link has already been opened, it cannot be accessed again.',
    }, { status: 410 });
  }

  return NextResponse.json({ active: true, status: invite.status });
}

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
  const deviceId =
    (body?.deviceId as string | undefined)?.trim() ||
    req.headers.get('x-device-id') ||
    `dev_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  if (!passcode) {
    return NextResponse.json({ error: 'Passcode is required' }, { status: 400 });
  }

  // Acquire concurrency join lock for token (protecting millisecond race condition)
  const lock = acquireJoinLock(token, deviceId);
  if (!lock.acquired) {
    return NextResponse.json({
      error: lock.reason || CONCURRENT_SESSION_ERROR,
      concurrent: true,
      code: 'CONCURRENT_SESSION_DETECTED',
    }, { status: 409 });
  }

  const { invite, errorResponse } = await validateActiveAssessToken(token, false);
  if (errorResponse || !invite) {
    releaseJoinLock(token, deviceId);
    return errorResponse;
  }

  if (invite.status === 'revoked') {
    releaseJoinLock(token, deviceId);
    return NextResponse.json({
      error: 'This interview link has already been used and is expired',
      note: 'Note: This interview link has already been used and is expired.',
      expired: true,
      used: true,
      status: 'expired',
      expirationReason: 'already_used',
      reasonTitle: 'Link is expired',
      reasonDetail: 'For security and assessment integrity, each interview link is strictly single-use. Because this link has already been accessed, it cannot be opened again.',
    }, { status: 410 });
  }

  if (invite.status === 'completed') {
    releaseJoinLock(token, deviceId);
    return NextResponse.json({
      error: 'This interview has already been completed.',
      note: 'This interview session has already been successfully submitted and completed. Submissions are finalized.',
      expired: true,
      used: true,
      status: 'completed',
      expirationReason: 'completed',
      reasonTitle: 'Interview Already Completed',
      reasonDetail: 'This interview session has already been successfully submitted and completed. All answers are finalized.',
    }, { status: 410 });
  }

  if (isInviteExpired(invite)) {
    releaseJoinLock(token, deviceId);
    await supabaseAdmin
      .from('interview_invites')
      .update({ status: 'expired' })
      .eq('id', invite.id);
    return NextResponse.json({
      error: 'This interview link has expired',
      note: 'The scheduled window to complete this interview has passed.',
      expired: true,
      expirationReason: 'time_expired',
      reasonTitle: 'Assessment Deadline Expired',
      reasonDetail: 'The scheduled invitation window to access and take this interview has elapsed.',
    }, { status: 410 });
  }

  if (invite.consumed_at || invite.status === 'in_progress' || invite.status === 'expired') {
    releaseJoinLock(token, deviceId);
    return NextResponse.json({
      error: 'This interview link has already been used and is expired',
      note: 'Note: This single-use interview link has already been accessed.',
      expired: true,
      used: true,
      concurrent: true,
      expirationReason: 'already_used',
      reasonTitle: 'Single-Use Link Already Accessed',
      reasonDetail: 'For security and assessment integrity, each interview link is strictly single-use. Because this link has already been opened, it cannot be accessed again.',
    }, { status: 410 });
  }

  if (!invite.passcode_hash || !invite.passcode_salt) {
    releaseJoinLock(token, deviceId);
    return NextResponse.json({ error: 'This invite is misconfigured. Contact your interviewer.' }, { status: 500 });
  }

  const suppliedHash = hashPasscode(passcode, invite.passcode_salt);
  if (suppliedHash !== invite.passcode_hash) {
    releaseJoinLock(token, deviceId);
    return NextResponse.json({ error: 'Incorrect passcode' }, { status: 401 });
  }

  const { data: session, error: sessionErr } = await supabaseAdmin
    .from('interview_sessions')
    .select('id, candidate_name, status, duration_minutes')
    .eq('id', invite.session_id)
    .single();

  if (sessionErr || !session) {
    releaseJoinLock(token, deviceId);
    return NextResponse.json({ error: 'Interview session not found' }, { status: 404 });
  }

  if (session.status === 'completed') {
    releaseJoinLock(token, deviceId);
    return NextResponse.json({
      error: 'This interview has already ended',
      note: 'Note: This interview link has already been used and is expired.',
      expired: true,
      used: true,
      status: 'completed',
      expirationReason: 'completed',
      reasonTitle: 'Interview Already Completed',
      reasonDetail: 'This interview session has already been successfully submitted and completed. All answers are finalized.',
    }, { status: 410 });
  }

  if (session.status === 'cancelled' || session.status === 'terminated') {
    releaseJoinLock(token, deviceId);
    return NextResponse.json({
      error: 'This interview link has already been used and is expired',
      note: 'Note: This interview link has already been used and is expired.',
      expired: true,
      used: true,
      status: 'expired',
      expirationReason: 'already_used',
      reasonTitle: 'Link is expired',
      reasonDetail: 'For security and assessment integrity, each interview link is strictly single-use. Because this link has already been accessed, it cannot be opened again.',
    }, { status: 410 });
  }

  const { data: questions, error: questionsErr } = await supabaseAdmin
    .from('interview_questions')
    .select('id, question_text, question_type, category, difficulty, question_order, time_limit_sec, is_mandatory_hr')
    .eq('session_id', invite.session_id)
    .order('question_order', { ascending: true });

  if (questionsErr || !questions || questions.length === 0) {
    releaseJoinLock(token, deviceId);
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
  registerActiveSession(token, deviceId);
  if (invite.session_id) {
    registerActiveSession(invite.session_id, deviceId);
  }

  const response = NextResponse.json({
    verified: true,
    session_id: invite.session_id,
    candidate_name: session.candidate_name,
    duration_minutes: session.duration_minutes || 15,
    questions,
  });

  response.cookies.set('assess_verified_token', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 4,
    path: `/api/assess`,
  });

  return response;
}