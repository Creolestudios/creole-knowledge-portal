import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { validateActiveAssessToken } from '@/lib/ai-interview/assess-utils';
import { scoreInterviewSession } from '@/lib/ai-interview/scorer';

export const runtime = 'nodejs';

/**
 * POST /api/assess/[token]/complete
 *
 * Public endpoint. Called once the candidate has answered every question in
 * `/assess/[token]`. Marks both the invite and the session `completed` so
 * the link can no longer be reused. Also persists per-type proctoring
 * warning counts and triggers post-interview scoring pass.
 *
 * Body: { warningCounts?: { face: number, object: number, voice: number } }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const body = await req.json().catch(() => ({}));
  const warningCounts = body?.warningCounts as
    | { face: number; object: number; voice: number }
    | undefined;

  const { invite, errorResponse } = await validateActiveAssessToken(token, false);
  if (errorResponse || !invite) return errorResponse;

  if (invite.status === 'revoked' || invite.status === 'expired') {
    return NextResponse.json({ error: 'This interview session has already ended' }, { status: 410 });
  }

  const now = new Date().toISOString();

  const sessionUpdate: Record<string, unknown> = {
    status: 'completed',
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
      .update({ status: 'completed', completed_at: now })
      .eq('id', invite.id),
    supabaseAdmin
      .from('interview_sessions')
      .update(sessionUpdate)
      .eq('id', invite.session_id),
  ]);

  // Trigger post-interview scoring in background
  scoreInterviewSession({ sessionId: invite.session_id }).catch((err) => {
    console.error('[assess-complete] Background scoring error:', err);
  });

  return NextResponse.json({ completed: true, session_id: invite.session_id });
}


