import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  hashPasscode,
  isInviteExpired,
  resolveInviteByToken,
  ResolvedInvite,
} from '@/lib/ai-interview/invite-token';
import {
  acquireJoinLock,
  releaseJoinLock,
  registerActiveSession,
  CONCURRENT_SESSION_ERROR,
} from '@/lib/ai-interview/session-lock';

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
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const interviewId = searchParams.get('interviewId');

  if (!interviewId) {
    return NextResponse.json({ error: 'Interview ID is required' }, { status: 400 });
  }

  let cookieStore;
  try {
    cookieStore = await cookies();
  } catch {
    cookieStore = { get: () => null };
  }
  
  const verifiedId = cookieStore.get('interview_verified_id')?.value;
  const verifiedToken = cookieStore.get('interview_verified_token')?.value;

  const matchesCookie = (sessionId?: string) => {
    if (verifiedToken === interviewId) return true;
    if (verifiedId === interviewId) return true;
    if (sessionId && verifiedId === sessionId) return true;
    return false;
  };

  // 1. ai_interviews
  try {
    const { data: interview } = await supabaseAdmin
      .from('ai_interviews')
      .select('id, status, expires_at, used_at')
      .eq('id', interviewId)
      .single();

    if (interview) {
      if (new Date(interview.expires_at) < new Date()) {
        return NextResponse.json({
          error: 'This interview link has expired',
          note: 'Note: This interview link has expired.',
          expired: true,
        }, { status: 410 });
      }
      if (
        (interview.used_at && interview.status !== 'in_progress') ||
        interview.status === 'terminated' ||
        interview.status === 'completed'
      ) {
        return NextResponse.json({
          error: 'This interview link has already been used and is expired',
          note: 'Note: This interview link has already been used and is expired.',
          expired: true,
          used: true,
        }, { status: 410 });
      }
      return NextResponse.json({
        active: true,
        status: interview.status,
        inProgress: interview.status === 'in_progress',
        requiresAccessCode: !matchesCookie(interview.id),
      });
    }
  } catch {
    // continue
  }

  // 2. interview_invites
  const invite = await resolveInviteByToken(interviewId);
  if (invite) {
    if (isInviteExpired(invite)) {
      return NextResponse.json({
        error: 'This interview link has expired',
        note: 'Note: This interview link has expired.',
        expired: true,
      }, { status: 410 });
    }
    if (
      (invite.consumed_at && invite.status !== 'in_progress') ||
      invite.status === 'completed' ||
      invite.status === 'revoked' ||
      invite.status === 'expired'
    ) {
      return NextResponse.json({
        error: 'This interview link has already been used and is expired',
        note: 'Note: This interview link has already been used and is expired.',
        expired: true,
        used: true,
      }, { status: 410 });
    }
    return NextResponse.json({
      active: true,
      status: invite.status,
      inProgress: invite.status === 'in_progress',
      requiresAccessCode: !matchesCookie(invite.session_id),
      bypassProctoring: (invite.max_alerts ?? 0) > 1000,
    });
  }

  // 3. interview_sessions
  try {
    const { data: session } = await supabaseAdmin
      .from('interview_sessions')
      .select('id, status')
      .eq('id', interviewId)
      .maybeSingle();

    if (session) {
      if (
        session.status === 'completed' ||
        session.status === 'cancelled'
      ) {
        return NextResponse.json({
          error: 'This interview link has already been used and is expired',
          note: 'Note: This interview link has already been used and is expired.',
          expired: true,
          used: true,
        }, { status: 410 });
      }
      return NextResponse.json({
        active: true,
        status: session.status,
        inProgress: session.status === 'in_progress',
        requiresAccessCode: !matchesCookie(session.id),
      });
    }
  } catch {
    // continue
  }

  return NextResponse.json({ error: 'Interview not found' }, { status: 404 });
}

async function broadcastTermination(interviewId: string) {
  try {
    const channel = supabaseAdmin.channel(`interview-sync-${interviewId}`);
    await channel.subscribe();
    await channel.send({
      type: 'broadcast',
      event: 'state-sync',
      payload: {
        type: 'terminate',
        reason: 'Interview terminated due to page refresh or unauthorized re-entry.',
      },
    });
    await supabaseAdmin.removeChannel(channel);
  } catch {
    // ignore
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const interviewId = body?.interviewId as string | undefined;
  const accessCode = body?.accessCode as string | undefined;
  const email = body?.email as string | undefined;
  const deviceId =
    (body?.deviceId as string | undefined)?.trim() ||
    req.headers.get('x-device-id') ||
    `dev_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

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

  // Acquire concurrency lock if non-admin is submitting passcode to start interview
  let lockAcquired = false;
  if (!isRequesterAdmin && accessCode) {
    const lock = acquireJoinLock(interviewId, deviceId);
    if (!lock.acquired) {
      return NextResponse.json({
        error: lock.reason || CONCURRENT_SESSION_ERROR,
        concurrent: true,
        code: 'CONCURRENT_SESSION_DETECTED',
      }, { status: 409 });
    }
    lockAcquired = true;
  }

  // 1. Try resolving via ai_interviews table (primary/legacy table)
  try {
    const { data: interview } = await supabaseAdmin
      .from('ai_interviews')
      .select('id, status, expires_at, access_code, used_at')
      .eq('id', interviewId)
      .single();

    if (interview) {
      if (new Date(interview.expires_at) < new Date()) {
        if (lockAcquired) releaseJoinLock(interviewId, deviceId);
        return NextResponse.json({
          error: 'This interview link has expired',
          note: 'Note: This interview link has expired.',
          expired: true,
        }, { status: 410 });
      }

      if (interview.status === 'terminated' || interview.status === 'completed') {
        if (lockAcquired) releaseJoinLock(interviewId, deviceId);
        return NextResponse.json({
          error: 'This interview has already ended',
          note: 'Note: This interview link has already been used and is expired.',
          expired: true,
          used: true,
          ended: true,
        }, { status: 410 });
      }

      if (!isRequesterAdmin) {
        if (interview.status === 'in_progress' || interview.used_at) {
          if (lockAcquired) releaseJoinLock(interviewId, deviceId);
          await supabaseAdmin.from('ai_interviews').update({ status: 'terminated' }).eq('id', interview.id);
          await broadcastTermination(interviewId);
          return NextResponse.json({
            error: 'Interview terminated due to page refresh or unauthorized re-entry.',
            note: 'Interview terminated due to page refresh or unauthorized re-entry.',
            status: 'terminated',
            ended: true,
            concurrent: true,
          }, { status: 410 });
        }

        if (!accessCode) {
          return NextResponse.json({ requiresAccessCode: true }, { status: 200 });
        }

        if (interview.access_code !== accessCode.trim()) {
          if (lockAcquired) releaseJoinLock(interviewId, deviceId);
          return NextResponse.json({ error: 'Incorrect passcode' }, { status: 401 });
        }

        if (interview.status === 'pending') {
          // Do not update the DB to in_progress here.
          // The interview is only marked in_progress when they actually start answering questions.
          // The lockAcquired handles concurrent protection for now.
        }
        registerActiveSession(interviewId, deviceId);
      }

      const inProgress = interview.status === 'in_progress';
      const response = NextResponse.json({
        verified: true,
        isAdmin: isRequesterAdmin,
        interviewId: interview.id,
        status: interview.status,
        inProgress,
      });
      try {
        response.cookies.set('interview_verified_id', interview.id, {
          httpOnly: true,
          sameSite: 'strict',
          secure: process.env.NODE_ENV === 'production',
          maxAge: 60 * 60 * 4,
          path: '/',
        });
      } catch {
        // ignore in test
      }
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
      return NextResponse.json({
        error: 'This interview link has expired',
        note: 'Note: This interview link has expired.',
        expired: true,
      }, { status: 410 });
    }

    if (invite.status === 'completed' || invite.status === 'revoked') {
      return NextResponse.json({
        error: 'This interview has already ended',
        note: 'Note: This interview link has already been used and is expired.',
        expired: true,
        used: true,
        ended: true,
      }, { status: 410 });
    }

    if (!isRequesterAdmin) {
      if (invite.status === 'in_progress' || invite.consumed_at) {
        if (lockAcquired) releaseJoinLock(interviewId, deviceId);
        await supabaseAdmin.from('interview_invites').update({ status: 'revoked' }).eq('id', invite.id);
        if (invite.session_id) {
          await supabaseAdmin.from('interview_sessions').update({ status: 'terminated' }).eq('id', invite.session_id);
        }
        await broadcastTermination(interviewId);
        return NextResponse.json({
          error: 'Interview terminated due to page refresh or unauthorized re-entry.',
          note: 'Interview terminated due to page refresh or unauthorized re-entry.',
          status: 'terminated',
          ended: true,
          concurrent: true,
        }, { status: 410 });
      }

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
        if (lockAcquired) releaseJoinLock(interviewId, deviceId);
        return NextResponse.json({ error: 'Incorrect passcode' }, { status: 401 });
      }
    }

    const sessionId = invite.session_id;

    const { data: session } = await supabaseAdmin
      .from('interview_sessions')
      .select('status')
      .eq('id', sessionId)
      .maybeSingle();

    if (session && (session.status === 'completed' || session.status === 'cancelled')) {
      if (lockAcquired) releaseJoinLock(interviewId, deviceId);
      return NextResponse.json({
        error: 'This interview has already ended',
        note: 'Note: This interview link has already been used and is expired.',
        expired: true,
        used: true,
        ended: true,
      }, { status: 410 });
    }

    if (!isRequesterAdmin) {
      if (invite.status === 'in_progress' || invite.consumed_at) {
        if (lockAcquired) releaseJoinLock(interviewId, deviceId);
        await supabaseAdmin.from('interview_invites').update({ status: 'revoked' }).eq('id', invite.id);
        if (invite.session_id) {
          await supabaseAdmin.from('interview_sessions').update({ status: 'terminated' }).eq('id', invite.session_id);
        }
        await broadcastTermination(interviewId);
        return NextResponse.json({
          error: 'Interview terminated due to page refresh or unauthorized re-entry.',
          note: 'Interview terminated due to page refresh or unauthorized re-entry.',
          status: 'terminated',
          ended: true,
          concurrent: true,
        }, { status: 410 });
      }

      // Do not update the DB to in_progress here.
      // We wait for the client to call /api/interview/start when they actually begin the interview.

      registerActiveSession(interviewId, deviceId);
      if (sessionId) {
        registerActiveSession(sessionId, deviceId);
      }
    }

    const inProgress = session?.status === 'in_progress' || invite.status === 'in_progress';
    const response = NextResponse.json({
      verified: true,
      isAdmin: isRequesterAdmin,
      interviewId: sessionId,
      status: session?.status || invite.status,
      inProgress,
      bypassProctoring: (invite.max_alerts ?? 0) > 1000,
    });
    try {
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
    } catch {
      // ignore in test
    }
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
      if (
        session.status === 'completed' ||
        session.status === 'cancelled' ||
        (!isRequesterAdmin && session.status === 'in_progress')
      ) {
        if (!isRequesterAdmin && session.status === 'in_progress') {
          await supabaseAdmin.from('interview_sessions').update({ status: 'terminated' }).eq('id', session.id);
          await broadcastTermination(interviewId);
          return NextResponse.json({
            error: 'Interview terminated due to page refresh or unauthorized re-entry.',
            note: 'Interview terminated due to page refresh or unauthorized re-entry.',
            status: 'terminated',
            ended: true,
          }, { status: 410 });
        }
        return NextResponse.json({
          error: 'This interview has already ended',
          note: 'Note: This interview link has already been used and is expired.',
          expired: true,
          used: true,
          ended: true,
        }, { status: 410 });
      }

      if (!isRequesterAdmin && !accessCode) {
        return NextResponse.json({ requiresAccessCode: true }, { status: 200 });
      }

      if (!isRequesterAdmin && session.status !== 'in_progress') {
        // Do not update the DB to in_progress here.
        // We wait for the client to call /api/interview/start when they actually begin the interview.
        registerActiveSession(interviewId, deviceId);
      }

      const sessionInProgress = session.status === 'in_progress';
      const response = NextResponse.json({
        verified: true,
        isAdmin: isRequesterAdmin,
        interviewId: session.id,
        status: session.status,
        inProgress: sessionInProgress,
      });
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

  if (lockAcquired) releaseJoinLock(interviewId, deviceId);
  return NextResponse.json({ error: 'Interview not found' }, { status: 404 });
}
