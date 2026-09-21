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
 * Body: { reason: string }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const body = await req.json().catch(() => null);
  const reason = (body?.reason as string | undefined)?.trim();

  if (!reason) {
    return NextResponse.json({ error: 'Reason is required' }, { status: 400 });
  }

  const { invite, errorResponse } = await validateActiveAssessToken(token, false);
  if (errorResponse || !invite) return errorResponse;

  if (invite.status === 'revoked' || invite.status === 'completed' || invite.status === 'expired') {
    return NextResponse.json({ terminated: true, session_id: invite.session_id });
  }

  const now = new Date().toISOString();

  await Promise.all([
    supabaseAdmin
      .from('interview_invites')
      .update({ status: 'revoked', completed_at: now })
      .eq('id', invite.id),
    supabaseAdmin
      .from('interview_sessions')
      .update({ status: 'cancelled', updated_at: now })
      .eq('id', invite.session_id),
    supabaseAdmin.from('interview_events').insert({
      session_id: invite.session_id,
      event_type: 'proctoring_violation',
      severity: 'critical',
      metadata: { reason },
    }),
  ]);

  return NextResponse.json({ terminated: true, session_id: invite.session_id });
}
