import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { ensureAllQuestionsAnswered } from '@/lib/ai-interview/answers';
import { scoreInterviewSession } from '@/lib/ai-interview/scorer';
import { resolveInterviewSessionId, resolveInviteByToken } from '@/lib/ai-interview/invite-token';

export const runtime = 'nodejs';

/**
 * POST /api/interview/terminate
 *
 * Public endpoint. Called by the candidate-facing proctoring UI the moment a
 * violation (tab switch, minimized window, camera/mic/screen-share stopped)
 * is detected. Marks the interview 'terminated'/'revoked' server-side so the session
 * cannot be resumed by refreshing and re-submitting the same passcode.
 *
 * Body: { interviewId: string, reason: string, warningCounts?: { face: number, object: number, voice: number } }
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const interviewId = body?.interviewId as string | undefined;
  const reason = body?.reason as string | undefined;
  const warningCounts = body?.warningCounts as
    | { face: number; object: number; voice: number }
    | undefined;

  if (!interviewId || !reason) {
    return NextResponse.json({ error: 'Interview ID and reason are required' }, { status: 400 });
  }

  const now = new Date().toISOString();
  let found = false;

  // Resolve invite by token / token_hash if provided
  let invite = await resolveInviteByToken(interviewId);
  if (!invite) {
    try {
      const { data: inv } = await supabaseAdmin
        .from('interview_invites')
        .select('*')
        .eq('id', interviewId)
        .single();
      if (inv?.session_id) invite = inv;
    } catch {
      // ignore
    }
  }

  const targetSessionId = invite?.session_id || (await resolveInterviewSessionId(interviewId)) || interviewId;

  // 1. Check legacy ai_interviews table
  let aiInterview: { id: string; status: string } | null = null;
  try {
    const { data } = await supabaseAdmin
      .from('ai_interviews')
      .select('id, status')
      .eq('id', targetSessionId)
      .single();
    if (data) aiInterview = data;
  } catch {
    // ignore
  }

  // 2. Check modern interview_sessions table
  let sessionRecord: { id: string; status: string } | null = null;
  try {
    const { data } = await supabaseAdmin
      .from('interview_sessions')
      .select('id, status')
      .eq('id', targetSessionId)
      .single();
    if (data) sessionRecord = data;
  } catch {
    // ignore
  }

  if (aiInterview || sessionRecord || invite) {
    found = true;
  }

  if (!found) {
    return NextResponse.json({ error: 'Interview not found' }, { status: 404 });
  }

  // Check if already finished
  const isAlreadyFinished =
    aiInterview?.status === 'terminated' ||
    aiInterview?.status === 'completed' ||
    sessionRecord?.status === 'cancelled' ||
    sessionRecord?.status === 'completed' ||
    invite?.status === 'revoked' ||
    invite?.status === 'completed';

  if (isAlreadyFinished) {
    return NextResponse.json({ terminated: true, interviewId: targetSessionId });
  }

  // Update ai_interviews if present
  if (aiInterview) {
    await supabaseAdmin
      .from('ai_interviews')
      .update({
        status: 'terminated',
        terminated_at: now,
        termination_reason: reason,
      })
      .eq('id', targetSessionId);
  }

  // Update interview_sessions and interview_invites
  const sessionUpdate: Record<string, unknown> = {
    status: 'cancelled',
    termination_reason: reason,
    updated_at: now,
  };

  if (warningCounts) {
    sessionUpdate.face_warning_count = warningCounts.face;
    sessionUpdate.object_warning_count = warningCounts.object;
    sessionUpdate.voice_warning_count = warningCounts.voice;
  }

  const updatePromises: Promise<any>[] = [
    supabaseAdmin
      .from('interview_sessions')
      .update(sessionUpdate)
      .eq('id', targetSessionId),
    supabaseAdmin
      .from('interview_invites')
      .update({ status: 'revoked', completed_at: now })
      .eq(invite?.id ? 'id' : 'session_id', invite?.id || targetSessionId),
  ];

  try {
    const eventsTable = supabaseAdmin.from('interview_events');
    if (typeof eventsTable?.insert === 'function') {
      updatePromises.push(
        eventsTable.insert({
          session_id: targetSessionId,
          event_type: 'proctoring_violation',
          category: 'proctoring_violation',
          severity: 'critical',
          metadata: { reason, warningCounts },
          meta: { reason, warningCounts },
        })
      );
    }
  } catch {
    // ignore
  }

  await Promise.all(updatePromises);

  await ensureAllQuestionsAnswered(targetSessionId);

  scoreInterviewSession({ sessionId: targetSessionId }).catch((err) => {
    console.error('[interview-terminate] Background scoring error:', err);
  });

  return NextResponse.json({ terminated: true, interviewId: targetSessionId });
}
