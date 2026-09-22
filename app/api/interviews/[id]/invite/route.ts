import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getSessionOrError } from '@/lib/ai-interview/session-utils';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    const { session, errorResponse } = await getSessionOrError(id);
    if (errorResponse || !session) return errorResponse;

    // Generate high-entropy token and passcode
    const rawToken = crypto.randomBytes(24).toString('hex');
    const token_hash = crypto.createHash('sha256').update(rawToken).digest('hex');

    // crypto.randomInt (CSPRNG) rather than Math.random() — this passcode
    // gates access to a candidate's interview session, so it must not be
    // predictable.
    const rawPasscode = body.passcode || crypto.randomInt(100000, 1000000).toString();
    const passcode_salt = crypto.randomBytes(16).toString('hex');
    const passcode_hash = crypto
      .scryptSync(rawPasscode + passcode_salt, passcode_salt, 64)
      .toString('hex');

    const expires_in_hours = body.expires_in_hours || 72;
    const expires_at = new Date(
      Date.now() + expires_in_hours * 60 * 60 * 1000
    ).toISOString();

    const max_alerts = body.max_alerts || 3;

    const { data: invite, error: inviteErr } = await supabaseAdmin
      .from('interview_invites')
      .insert({
        session_id: id,
        token_hash,
        passcode_hash,
        passcode_salt,
        status: 'active',
        max_warnings: max_alerts,
        max_alerts,
        allowed_modes: ['interview'],
        expires_at,
      })
      .select()
      .single();

    if (inviteErr || !invite) {
      return NextResponse.json({ error: inviteErr?.message }, { status: 500 });
    }

    await supabaseAdmin
      .from('interview_sessions')
      .update({
        status: 'invite_issued',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    let baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
    if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
      baseUrl = `http://${baseUrl}`;
    }
    const inviteUrl = `${baseUrl}/assess/${rawToken}`;

    return NextResponse.json({
      invite_id: invite.id,
      session_id: id,
      invite_url: inviteUrl,
      token: rawToken,
      passcode: rawPasscode,
      expires_at,
      status: 'active',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
