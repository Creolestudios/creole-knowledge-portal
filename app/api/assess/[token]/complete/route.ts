import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { validateActiveAssessToken } from '@/lib/ai-interview/assess-utils';

export const runtime = 'nodejs';

/**
 * POST /api/assess/[token]/complete
 *
 * Public endpoint. Called once the candidate has answered every question in
 * `/assess/[token]`. Marks both the invite and the session `completed` so
 * the link can no longer be reused.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const { invite, errorResponse } = await validateActiveAssessToken(token, false);
  if (errorResponse || !invite) return errorResponse;

  if (invite.status === 'revoked' || invite.status === 'expired') {
    return NextResponse.json({ error: 'This interview session has already ended' }, { status: 410 });
  }

  const now = new Date().toISOString();

  await Promise.all([
    supabaseAdmin
      .from('interview_invites')
      .update({ status: 'completed', completed_at: now })
      .eq('id', invite.id),
    supabaseAdmin
      .from('interview_sessions')
      .update({ status: 'completed', updated_at: now })
      .eq('id', invite.session_id),
  ]);

  return NextResponse.json({ completed: true, session_id: invite.session_id });
}
