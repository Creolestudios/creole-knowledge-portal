import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getSessionOrError } from '@/lib/ai-interview/session-utils';

async function handleInviteRequest(
  req: NextRequest,
  params: Promise<{ id: string }>,
  isPost: boolean
) {
  try {
    const { id } = await params;
    let body: any = {};
    if (isPost) {
      body = await req.json().catch(() => ({}));
    }

    const { session, errorResponse } = await getSessionOrError(id);
    if (errorResponse || !session) return errorResponse;

    const parsedJd = (session.parsed_jd || {}) as Record<string, any>;
    const existingInvite = parsedJd.invite;

    // If an invite was already generated once for this session and caller is not explicitly asking to regenerate:
    // return the existing one-time link and passcode!
    if (existingInvite?.invite_url && existingInvite?.passcode && !body.regenerate) {
      return NextResponse.json({
        invite_id: existingInvite.invite_id || id,
        session_id: id,
        invite_url: existingInvite.invite_url,
        token: existingInvite.token,
        passcode: existingInvite.passcode,
        expires_at: existingInvite.expires_at,
        status: existingInvite.status || 'active',
      });
    }

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

    const reqHost = req.headers.get('x-forwarded-host') || req.headers.get('host');
    const reqProto = req.headers.get('x-forwarded-proto') || (reqHost?.includes('localhost') ? 'http' : 'https');
    let baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      (reqHost ? `${reqProto}://${reqHost}` : (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'));
    if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
      baseUrl = `http://${baseUrl}`;
    }
    const inviteUrl = `${baseUrl}/interview/${rawToken}`;

    const inviteData = {
      invite_id: invite.id,
      session_id: id,
      invite_url: inviteUrl,
      token: rawToken,
      passcode: rawPasscode,
      expires_at,
      status: 'active',
    };

    // Store the one-time generated invite data in session.parsed_jd so it can be redisplayed
    // whenever an admin clicks on the candidate's name in Recent Interviews
    await supabaseAdmin
      .from('interview_sessions')
      .update({
        ...(session.status !== 'in_progress' && session.status !== 'completed' && session.status !== 'terminated'
          ? { status: 'invite_issued' }
          : {}),
        updated_at: new Date().toISOString(),
        parsed_jd: {
          ...parsedJd,
          invite: inviteData,
        },
      })
      .eq('id', id);

    return NextResponse.json(inviteData);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handleInviteRequest(req, params, false);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handleInviteRequest(req, params, true);
}

