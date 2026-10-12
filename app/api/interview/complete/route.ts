import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolveInterviewSessionId, hashToken } from '@/lib/ai-interview/invite-token';
import { scoreInterviewSession } from '@/lib/ai-interview/scorer';
import { ensureAllQuestionsAnswered } from '@/lib/ai-interview/answers';

export const runtime = 'nodejs';

/**
 * POST /api/interview/complete
 *
 * Public endpoint. Marks the interview session and invite as completed so
 * the link cannot be accessed or reused a second time. Persists final warning
 * counts and triggers the background scoring pass.
 *
 * Body: { interviewId: string, warningCounts?: { face: number; object: number; voice: number } }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const interviewId = body?.interviewId as string | undefined;
  const warningCounts = body?.warningCounts as
    | { face: number; object: number; voice: number }
    | undefined;

  if (!interviewId) {
    return NextResponse.json({ error: 'Interview ID is required' }, { status: 400 });
  }

  const targetSessionId = (await resolveInterviewSessionId(interviewId)) || interviewId;
  const now = new Date().toISOString();

  // 1. Update interview_invites
  await supabaseAdmin
    .from('interview_invites')
    .update({ status: 'completed', completed_at: now })
    .or(`session_id.eq.${targetSessionId},id.eq.${interviewId},token_hash.eq.${hashToken(interviewId)}`);

  // 2. Update interview_sessions
  const sessionUpdate: Record<string, unknown> = {
    status: 'completed',
    updated_at: now,
  };

  if (warningCounts) {
    sessionUpdate.face_warning_count = warningCounts.face;
    sessionUpdate.object_warning_count = warningCounts.object;
    sessionUpdate.voice_warning_count = warningCounts.voice;
  }

  await supabaseAdmin
    .from('interview_sessions')
    .update(sessionUpdate)
    .in('id', [targetSessionId, interviewId]);

  // 3. Update legacy ai_interviews table if present
  await supabaseAdmin
    .from('ai_interviews')
    .update({ status: 'completed' })
    .in('id', [targetSessionId, interviewId]);

  // Ensure all questions have an answer record
  await ensureAllQuestionsAnswered(targetSessionId);

  // Trigger post-interview scoring in background
  scoreInterviewSession({ sessionId: targetSessionId }).catch((err) => {
    console.error('[interview-complete] Background scoring error:', err);
  });

  return NextResponse.json({ completed: true, interviewId: targetSessionId });
}
