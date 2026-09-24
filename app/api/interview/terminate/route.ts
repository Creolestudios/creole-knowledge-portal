import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

/**
 * POST /api/interview/terminate
 *
 * Public endpoint. Called by the candidate-facing proctoring UI the moment a
 * violation (tab switch, minimized window, camera/mic/screen-share stopped)
 * is detected. Marks the interview 'terminated' server-side so the session
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

  const { data: interview, error } = await supabaseAdmin
    .from('ai_interviews')
    .select('id, status')
    .eq('id', interviewId)
    .single();

  if (error || !interview) {
    return NextResponse.json({ error: 'Interview not found' }, { status: 404 });
  }

  if (interview.status === 'terminated' || interview.status === 'completed') {
    return NextResponse.json({ terminated: true, interviewId: interview.id });
  }

  const now = new Date().toISOString();

  const { error: updateError } = await supabaseAdmin
    .from('ai_interviews')
    .update({
      status: 'terminated',
      terminated_at: now,
      termination_reason: reason,
    })
    .eq('id', interviewId);

  if (updateError) {
    console.error('[terminate] ai_interviews update error:', updateError);
  }

  // Sync cancellation into interview_sessions with per-type warning counts
  const sessionUpdate: Record<string, unknown> = {
    status: 'cancelled',
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
    .eq('id', interviewId);

  return NextResponse.json({ terminated: true, interviewId: interview.id });
}
