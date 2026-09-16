import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

/**
 * POST /api/interview/verify
 *
 * Public endpoint. A candidate submits the interview id (from the link)
 * plus the passcode they were given out-of-band. On success we mark the
 * interview "in_progress" and return the basic session info; the actual
 * interview flow (question generation, live session) is a later phase.
 *
 * Body: { interviewId: string, accessCode: string }
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const interviewId = body?.interviewId as string | undefined;
  const accessCode = body?.accessCode as string | undefined;

  if (!interviewId || !accessCode) {
    return NextResponse.json({ error: 'Interview ID and passcode are required' }, { status: 400 });
  }

  const { data: interview, error } = await supabaseAdmin
    .from('ai_interviews')
    .select('id, status, expires_at, access_code')
    .eq('id', interviewId)
    .single();

  if (error || !interview) {
    return NextResponse.json({ error: 'Interview not found' }, { status: 404 });
  }

  if (new Date(interview.expires_at) < new Date()) {
    return NextResponse.json({ error: 'This interview link has expired' }, { status: 410 });
  }

  if (interview.status === 'terminated' || interview.status === 'completed') {
    return NextResponse.json({ error: 'This interview has already ended' }, { status: 410 });
  }

  if (interview.access_code !== accessCode.trim()) {
    return NextResponse.json({ error: 'Incorrect passcode' }, { status: 401 });
  }

  if (interview.status === 'pending') {
    await supabaseAdmin
      .from('ai_interviews')
      .update({ status: 'in_progress', used_at: new Date().toISOString() })
      .eq('id', interviewId);
  }

  return NextResponse.json({ verified: true, interviewId: interview.id });
}
