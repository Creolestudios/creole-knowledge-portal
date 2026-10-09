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
  // NOTE: interview_sessions does NOT have a termination_reason column.
  // The reason is stored in interview_events (event_type: 'proctoring_violation').
  const sessionUpdate: Record<string, unknown> = {
    status: 'cancelled',
    updated_at: now,
  };

  if (warningCounts) {
    sessionUpdate.face_warning_count = warningCounts.face;
    sessionUpdate.object_warning_count = warningCounts.object;
    sessionUpdate.voice_warning_count = warningCounts.voice;
  }

  // Supabase builders are PromiseLike — use PromiseLike<unknown>[] which Promise.all accepts
  const updatePromises: PromiseLike<unknown>[] = [
    supabaseAdmin
      .from('interview_sessions')
      .update(sessionUpdate)
      .eq('id', targetSessionId)
      .then((r) => r),
    supabaseAdmin
      .from('interview_invites')
      .update({ status: 'revoked', completed_at: now })
      .eq(invite?.id ? 'id' : 'session_id', invite?.id || targetSessionId)
      .then((r) => r),
    supabaseAdmin
      .from('interview_events')
      .insert({
        session_id: targetSessionId,
        event_type: 'proctoring_violation',
        category: 'proctoring_violation',
        severity: 'critical',
        ts_ms: typeof body?.ts_ms === 'number' && body.ts_ms > 0 ? body.ts_ms : Date.now(),
        metadata: {
          reason,
          warningCounts,
          ...(typeof body?.offsetSeconds === 'number' ? { offsetSeconds: body.offsetSeconds } : {}),
          ...(typeof body?.screenToastOffsetSec === 'number' ? { screenToastOffsetSec: body.screenToastOffsetSec } : {}),
          ...(typeof body?.client_ts === 'number' ? { client_ts: body.client_ts } : {}),
        },
        meta: {
          reason,
          warningCounts,
          ...(typeof body?.offsetSeconds === 'number' ? { offsetSeconds: body.offsetSeconds } : {}),
          ...(typeof body?.screenToastOffsetSec === 'number' ? { screenToastOffsetSec: body.screenToastOffsetSec } : {}),
          ...(typeof body?.client_ts === 'number' ? { client_ts: body.client_ts } : {}),
        },
      })
      .then((r) => r),
  ];

  await Promise.all(updatePromises);

  // Broadcast termination to connected clients (admin dashboard)
  try {
    const channel1 = supabaseAdmin.channel(`interview-sync-${interviewId}`);
    const channel2 = supabaseAdmin.channel(`interview-sync-${targetSessionId}`);
    
    const subscribeChannel = (channel: ReturnType<typeof supabaseAdmin.channel>) => {
      return new Promise<void>((resolve) => {
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') resolve();
          // Also resolve on error so we don't hang forever
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') resolve();
        });
      });
    };

    await subscribeChannel(channel1);
    if (interviewId !== targetSessionId) await subscribeChannel(channel2);
    
    const payload = {
      type: 'broadcast' as const,
      event: 'state-sync',
      payload: {
        type: 'terminate',
        reason: reason || 'Interview terminated by system.',
      },
    };
    await channel1.send(payload);
    if (interviewId !== targetSessionId) await channel2.send(payload);
    
    await supabaseAdmin.removeChannel(channel1);
    if (interviewId !== targetSessionId) await supabaseAdmin.removeChannel(channel2);
  } catch (err) {
    console.error('[interview-terminate] Failed to broadcast termination:', err);
  }

  await ensureAllQuestionsAnswered(targetSessionId);

  scoreInterviewSession({ sessionId: targetSessionId }).catch((err) => {
    console.error('[interview-terminate] Background scoring error:', err);
  });

  return NextResponse.json({ terminated: true, interviewId: targetSessionId });
}
