import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { validateActiveAssessToken } from '@/lib/ai-interview/assess-utils';

export const runtime = 'nodejs';

/**
 * POST /api/assess/[token]/terminate
 *
 * Public endpoint. Called by the candidate-facing proctoring UI the moment a
 * violation (tab switch, minimized window, camera/mic/screen-share stopped)
 * is detected. Marks the invite 'revoked' and the session 'cancelled' so the
 * session cannot be resumed by refreshing and re-submitting the same
 * passcode, and records the violation in `interview_events` for the report.
 *
 * Body: { reason: string, warningCounts?: { face: number, object: number, voice: number } }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const body = await req.json().catch(() => null);
  const reason = (body?.reason as string | undefined)?.trim();
  const warningCounts = body?.warningCounts as
    | { face: number; object: number; voice: number }
    | undefined;

  if (!reason) {
    return NextResponse.json({ error: 'Reason is required' }, { status: 400 });
  }

  const { invite, errorResponse } = await validateActiveAssessToken(token, false);
  if (errorResponse || !invite) return errorResponse;

  if (invite.status === 'revoked' || invite.status === 'completed' || invite.status === 'expired') {
    return NextResponse.json({ terminated: true, session_id: invite.session_id });
  }

  const now = new Date().toISOString();

  const sessionUpdate: Record<string, unknown> = {
    status: 'cancelled',
    updated_at: now,
  };

  if (warningCounts) {
    sessionUpdate.face_warning_count = warningCounts.face;
    sessionUpdate.object_warning_count = warningCounts.object;
    sessionUpdate.voice_warning_count = warningCounts.voice;
  }

  await Promise.all([
    supabaseAdmin
      .from('interview_invites')
      .update({ status: 'revoked', completed_at: now })
      .eq('id', invite.id),
    supabaseAdmin
      .from('interview_sessions')
      .update(sessionUpdate)
      .eq('id', invite.session_id),
    supabaseAdmin.from('interview_events').insert({
      session_id: invite.session_id,
      event_type: 'proctoring_violation',
      category: 'proctoring_violation',
      severity: 'critical',
      metadata: { reason, warningCounts },
      meta: { reason, warningCounts },
    }),
  ]);

  return NextResponse.json({ terminated: true, session_id: invite.session_id });
}

