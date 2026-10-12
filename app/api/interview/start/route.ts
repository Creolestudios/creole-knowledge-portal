import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolveInviteByToken } from '@/lib/ai-interview/invite-token';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const interviewId = body?.interviewId as string | undefined;

  if (!interviewId) {
    return NextResponse.json({ error: 'Interview ID is required' }, { status: 400 });
  }

  try {
    // 1. Try resolving via ai_interviews table
    const { data: interview } = await supabaseAdmin
      .from('ai_interviews')
      .select('id, status')
      .eq('id', interviewId)
      .maybeSingle();

    if (interview && interview.status === 'pending') {
      const { data: updatedInterview } = await supabaseAdmin
        .from('ai_interviews')
        .update({ status: 'in_progress', used_at: new Date().toISOString() })
        .eq('id', interviewId)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();

      if (!updatedInterview) {
        return NextResponse.json({ error: 'Failed to start interview.' }, { status: 409 });
      }
      return NextResponse.json({ success: true, status: 'in_progress' });
    }

    // 2. Try resolving via interview_invites
    const invite = await resolveInviteByToken(interviewId);
    if (invite) {
      if (invite.status === 'active') {
        const { data: updatedInvite } = await supabaseAdmin
          .from('interview_invites')
          .update({ status: 'in_progress', consumed_at: new Date().toISOString() })
          .eq('id', invite.id)
          .eq('status', 'active')
          .select('id, session_id')
          .maybeSingle();

        if (updatedInvite?.session_id) {
          await supabaseAdmin
            .from('interview_sessions')
            .update({ status: 'in_progress', updated_at: new Date().toISOString() })
            .eq('id', updatedInvite.session_id);
        }
        return NextResponse.json({ success: true, status: 'in_progress' });
      } else if (invite.status === 'in_progress') {
         return NextResponse.json({ success: true, status: 'in_progress' });
      }
    }

    // 3. Try resolving via interview_sessions directly
    const { data: session } = await supabaseAdmin
      .from('interview_sessions')
      .select('id, status')
      .eq('id', interviewId)
      .maybeSingle();

    if (session && session.status === 'pending') {
       await supabaseAdmin
        .from('interview_sessions')
        .update({ status: 'in_progress', updated_at: new Date().toISOString() })
        .eq('id', interviewId);
       return NextResponse.json({ success: true, status: 'in_progress' });
    } else if (session && session.status === 'in_progress') {
       return NextResponse.json({ success: true, status: 'in_progress' });
    }

    return NextResponse.json({ error: 'Interview not found or already started.' }, { status: 404 });
  } catch (error) {
    console.error('[API /api/interview/start] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
