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
 * Body: { interviewId: string, reason: string }
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const interviewId = body?.interviewId as string | undefined;
  const reason = body?.reason as string | undefined;

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

  await supabaseAdmin
    .from('ai_interviews')
    .update({
      status: 'terminated',
      terminated_at: new Date().toISOString(),
      termination_reason: reason,
    })
    .eq('id', interviewId);

  return NextResponse.json({ terminated: true, interviewId: interview.id });
}
