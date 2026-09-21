import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function getSessionOrError(id: string) {
  const { data: session, error: fetchErr } = await supabaseAdmin
    .from('interview_sessions')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr || !session) {
    return { errorResponse: NextResponse.json({ error: 'Interview session not found' }, { status: 404 }) };
  }

  return { session };
}
