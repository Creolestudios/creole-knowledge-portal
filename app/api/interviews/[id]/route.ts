import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { data: session, error: sessionErr } = await supabaseAdmin
      .from('interview_sessions')
      .select('*')
      .eq('id', id)
      .single();

    if (sessionErr || !session) {
      return NextResponse.json(
        { error: 'Interview session not found' },
        { status: 404 }
      );
    }

    const { data: questions } = await supabaseAdmin
      .from('interview_questions')
      .select('*')
      .eq('session_id', id)
      .order('question_order', { ascending: true });

    const { data: invites } = await supabaseAdmin
      .from('interview_invites')
      .select('id, status, expires_at, created_at')
      .eq('session_id', id)
      .order('created_at', { ascending: false });

    return NextResponse.json({
      session: {
        ...session,
        questions: questions || [],
        invites: invites || [],
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
