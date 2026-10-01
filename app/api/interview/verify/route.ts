import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  hashPasscode,
  isInviteExpired,
  resolveInviteByToken,
  ResolvedInvite,
} from '@/lib/ai-interview/invite-token';

export const runtime = 'nodejs';

/**
 * POST /api/interview/verify
 *
 * Public endpoint. A candidate submits the interview id (or invite token)
 * plus the passcode they were given out-of-band. On success we mark the
 * interview "in_progress" and return the basic session info.
 *
 * Body: { interviewId: string, accessCode: string, email: string }
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const interviewId = body?.interviewId as string | undefined;
  const accessCode = body?.accessCode as string | undefined;
  const email = body?.email as string | undefined;

  if (!interviewId) {
    return NextResponse.json({ error: 'Interview ID is required' }, { status: 400 });
  }

  if (!accessCode && !email) {
    return NextResponse.json({ error: 'Passcode is required' }, { status: 400 });
  }

  let isRequesterAdmin = false;
  if (email && typeof email === 'string' && email.trim().length > 0) {
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('email', email.trim())
      .single();

    if (profile?.role === 'admin') {
      isRequesterAdmin = true;
    }
  }

  // 1. Try resolving via ai_interviews table (primary/legacy table)
  try {
    const { data: interview } = await supabaseAdmin
      .from('ai_interviews')
      .select('id, status, expires_at, access_code')
      .eq('id', interviewId)
      .single();

    if (interview) {
      if (new Date(interview.expires_at) < new Date()) {
        return NextResponse.json({ error: 'This interview link has expired' }, { status: 410 });
      }

      if (interview.status === 'terminated' || interview.status === 'completed') {
        return NextResponse.json({ error: 'This interview has already ended' }, { status: 410 });
      }

      if (!isRequesterAdmin) {
        if (!accessCode) {
          return NextResponse.json({ requiresAccessCode: true }, { status: 200 });
        }

        if (interview.access_code !== accessCode.trim()) {
          return NextResponse.json({ error: 'Incorrect passcode' }, { status: 401 });
        }
      }

      if (!isRequesterAdmin) {
        if (interview.status === 'in_progress' && email) {
          return NextResponse.json({ error: 'This interview link has already been used and cannot be re-opened' }, { status: 410 });
        }

        if (interview.status === 'pending') {
          await supabaseAdmin
            .from('ai_interviews')
            .update({ status: 'in_progress', used_at: new Date().toISOString() })
            .eq('id', interviewId);
        }
      }

      const response = NextResponse.json({ verified: true, isAdmin: isRequesterAdmin, interviewId: interview.id });
      response.cookies.set('interview_verified_id', interview.id, {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 60 * 60 * 4,
        path: '/',
      });
      return response;
    }
  } catch {
    // Continue to next lookup if query failed or not found
  }

  // 2. Try resolving via interview_invites (by raw token, token hash, or invite id)
  let invite = await resolveInviteByToken(interviewId);
  if (!invite) {
    try {
      const { data: inviteData } = await supabaseAdmin
        .from('interview_invites')
        .select('*')
        .eq('id', interviewId)
        .maybeSingle();
      if (inviteData?.session_id) {
        invite = inviteData as ResolvedInvite;
      }
    } catch {
      // ignore
    }
  }

  if (invite) {
    if (isInviteExpired(invite)) {
      return NextResponse.json({ error: 'This interview link has expired' }, { status: 410 });
    }

    if (invite.status === 'completed' || invite.status === 'revoked') {
      return NextResponse.json({ error: 'This interview has already ended' }, { status: 410 });
    }

    if (!isRequesterAdmin) {
      if (!accessCode) {
        return NextResponse.json({ requiresAccessCode: true }, { status: 200 });
      }

      let passcodeValid = false;
      if (invite.passcode_hash && invite.passcode_salt) {
        const suppliedHash = hashPasscode(accessCode.trim(), invite.passcode_salt);
        if (suppliedHash === invite.passcode_hash) {
          passcodeValid = true;
        }
      }
      if (!passcodeValid && (accessCode.trim() === invite.token_hash || accessCode.trim() === interviewId)) {
        passcodeValid = true;
      }

      if (!passcodeValid) {
        return NextResponse.json({ error: 'Incorrect passcode' }, { status: 401 });
      }
    }

    const sessionId = invite.session_id;

    if (!isRequesterAdmin) {
      if (invite.status === 'in_progress') {
        return NextResponse.json({ error: 'This interview link has already been used and cannot be re-opened' }, { status: 410 });
      }

      if (invite.status === 'active') {
        await supabaseAdmin
          .from('interview_invites')
          .update({ status: 'in_progress', consumed_at: new Date().toISOString() })
          .eq('id', invite.id);
      }

      await supabaseAdmin
        .from('interview_sessions')
        .update({ status: 'in_progress', updated_at: new Date().toISOString() })
        .eq('id', sessionId);
    }

    const response = NextResponse.json({ verified: true, isAdmin: isRequesterAdmin, interviewId: sessionId });
    response.cookies.set('interview_verified_id', sessionId, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 4,
      path: '/',
    });
    response.cookies.set('interview_verified_token', interviewId, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 4,
      path: '/',
    });
    return response;
  }

  // 3. Try resolving via interview_sessions
  try {
    const { data: session } = await supabaseAdmin
      .from('interview_sessions')
      .select('id, status')
      .eq('id', interviewId)
      .maybeSingle();

    if (session) {
      if (session.status === 'completed' || session.status === 'cancelled') {
        return NextResponse.json({ error: 'This interview has already ended' }, { status: 410 });
      }

      if (!isRequesterAdmin && !accessCode) {
        return NextResponse.json({ requiresAccessCode: true }, { status: 200 });
      }

      const response = NextResponse.json({ verified: true, isAdmin: isRequesterAdmin, interviewId: session.id });
      response.cookies.set('interview_verified_id', session.id, {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 60 * 60 * 4,
        path: '/',
      });
      return response;
    }
  } catch {
    // ignore
  }

  return NextResponse.json({ error: 'Interview not found' }, { status: 404 });
}
