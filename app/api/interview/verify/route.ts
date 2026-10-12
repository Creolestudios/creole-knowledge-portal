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
      .select('id, status, expires_at, used_at, termination_reason')
      .eq('id', interviewId)
      .single();

    if (interview) {
      if (new Date(interview.expires_at) < new Date()) {
        return NextResponse.json({
          error: 'This interview link has expired',
          note: 'Note: This interview link has expired.',
          expired: true,
          expirationReason: 'time_expired',
          reasonTitle: 'Assessment Deadline Expired',
          reasonDetail: 'The scheduled invitation window to access and take this interview has elapsed.',
        }, { status: 410 });
      }
      if (interview.status === 'terminated' || interview.status === 'completed' || interview.used_at) {
        const isCompleted = interview.status === 'completed';
        const isTerminated = interview.status === 'terminated';
        const violationReason = isTerminated ? (interview.termination_reason || 'The interview session was terminated due to a proctoring violation.') : undefined;
        return NextResponse.json({
          error: isCompleted
            ? 'This interview has already been completed'
            : 'This interview link has already been used and is expired',
          note: 'Note: This interview link has already been used and is expired.',
          expired: true,
          used: true,
          status: isCompleted ? 'completed' : 'expired',
          expirationReason: isCompleted ? 'completed' : (isTerminated ? 'violation' : 'already_used'),
          reasonTitle: isCompleted ? 'Interview Completed' : (isTerminated ? 'Interview Terminated' : 'Link is expired'),
          reasonDetail: isCompleted
            ? 'This link is expired it is one time use , your interview is completed we will get back to you soon'
            : 'This link is expired it is one time use',
          violationReason,
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
        note: 'The scheduled window to complete this interview has passed.',
        expired: true,
        expirationReason: 'time_expired',
        reasonTitle: 'Assessment Deadline Expired',
        reasonDetail: 'The scheduled invitation window to access and take this interview has elapsed.',
      }, { status: 410 });
    }
    if (
      invite.status === 'revoked' ||
      invite.status === 'expired' ||
      invite.status === 'completed' ||
      invite.consumed_at
    ) {
      let isCompleted = invite.status === 'completed';
      let isRevoked = invite.status === 'revoked';
      let violationReason: string | undefined;
      let warningCount: number | undefined;

      if (invite.session_id) {
        try {
          const { data: linkedSession } = await supabaseAdmin
            .from('interview_sessions')
            .select('status, voice_warning_count, face_warning_count, object_warning_count')
            .eq('id', invite.session_id)
            .maybeSingle();

          if (linkedSession) {
            if (linkedSession.status === 'cancelled' || linkedSession.status === 'terminated') {
              isRevoked = true;
            } else if (linkedSession.status === 'completed') {
              isCompleted = true;
            }
            const total = (linkedSession.face_warning_count || 0) + (linkedSession.object_warning_count || 0) + (linkedSession.voice_warning_count || 0);
            if (total > 0) warningCount = total;
          }
        } catch {}

        try {
          const { data: violationEvt } = await supabaseAdmin
            .from('interview_events')
            .select('meta, metadata')
            .eq('session_id', invite.session_id)
            .in('event_type', ['proctoring_violation', 'terminated'])
            .order('ts_ms', { ascending: false })
            .limit(1)
            .maybeSingle();

          const meta = (violationEvt?.meta || violationEvt?.metadata) as Record<string, any> | undefined;
          if (meta?.reason) {
            violationReason = String(meta.reason);
            isRevoked = true;
          }
        } catch {}
      }

      return NextResponse.json({
        error: isCompleted ? 'This interview has already been completed' : 'This interview link has already been used and is expired',
        note: 'Note: This interview link has already been used and is expired.',
        expired: true,
        used: true,
        status: isCompleted ? 'completed' : 'expired',
        expirationReason: isCompleted ? 'completed' : (isRevoked ? 'violation' : 'already_used'),
        reasonTitle: isCompleted ? 'Interview Completed' : (isRevoked ? 'Interview Terminated' : 'Link is expired'),
        reasonDetail: isCompleted
          ? 'This link is expired it is one time use , your interview is completed we will get back to you soon'
          : 'This link is expired it is one time use',
        violationReason: isRevoked ? (violationReason || 'The interview session was terminated due to a proctoring violation.') : undefined,
        warningCount,
      }, { status: 410 });
    }

    if (invite.session_id) {
      const { data: linkedSession } = await supabaseAdmin
        .from('interview_sessions')
        .select('id, status, voice_warning_count, face_warning_count, object_warning_count')
        .eq('id', invite.session_id)
        .maybeSingle();

      if (
        linkedSession &&
        (linkedSession.status === 'cancelled' ||
          linkedSession.status === 'terminated' ||
          linkedSession.status === 'completed')
      ) {
        const isCompleted = linkedSession.status === 'completed';
        let violationReason: string | undefined;
        let warningCount: number | undefined;

        if (!isCompleted) {
          try {
            const { data: violationEvt } = await supabaseAdmin
              .from('interview_events')
              .select('meta, metadata')
              .eq('session_id', linkedSession.id)
              .in('event_type', ['proctoring_violation', 'terminated'])
              .order('ts_ms', { ascending: false })
              .limit(1)
              .maybeSingle();

            const meta = (violationEvt?.meta || violationEvt?.metadata) as Record<string, any> | undefined;
            if (meta?.reason) {
              violationReason = String(meta.reason);
            }
          } catch {}

          const totalWarnings =
            (linkedSession.face_warning_count || 0) +
            (linkedSession.object_warning_count || 0) +
            (linkedSession.voice_warning_count || 0);
          if (totalWarnings > 0) warningCount = totalWarnings;
        }

        return NextResponse.json({
          error: isCompleted ? 'This interview has already been completed' : 'This interview link has already been used and is expired',
          note: 'Note: This interview link has already been used and is expired.',
          expired: true,
          used: true,
          status: isCompleted ? 'completed' : 'expired',
          expirationReason: isCompleted ? 'completed' : 'violation',
          reasonTitle: isCompleted ? 'Interview Completed' : 'Interview Terminated',
          reasonDetail: isCompleted
            ? 'This link is expired it is one time use , your interview is completed we will get back to you soon'
            : 'This link is expired it is one time use',
          violationReason: isCompleted ? undefined : (violationReason || 'The interview session was terminated due to a proctoring violation.'),
          warningCount,
        }, { status: 410 });
      }
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
      .select('id, status, voice_warning_count, face_warning_count, object_warning_count')
      .eq('id', interviewId)
      .maybeSingle();

    if (session) {
      if (
        session.status === 'cancelled' ||
        session.status === 'terminated' ||
        session.status === 'completed'
      ) {
        let violationReason: string | undefined;
        let warningCount: number | undefined;

        if (session.status === 'cancelled' || session.status === 'terminated') {
          try {
            const { data: violationEvt } = await supabaseAdmin
              .from('interview_events')
              .select('meta, metadata')
              .eq('session_id', session.id)
              .in('event_type', ['proctoring_violation', 'terminated'])
              .order('ts_ms', { ascending: false })
              .limit(1)
              .maybeSingle();

            const meta = (violationEvt?.meta || violationEvt?.metadata) as Record<string, any> | undefined;
            if (meta?.reason) {
              violationReason = String(meta.reason);
            }
          } catch {
            // ignore
          }

          const totalWarnings =
            (session.face_warning_count || 0) +
            (session.object_warning_count || 0) +
            (session.voice_warning_count || 0);
          if (totalWarnings > 0) {
            warningCount = totalWarnings;
          }
        }

        const isCompleted = session.status === 'completed';
        return NextResponse.json({
          error: isCompleted
            ? 'This interview has already been completed'
            : 'This interview link has already been used and is expired',
          note: 'Note: This interview link has already been used and is expired.',
          expired: true,
          used: true,
          status: isCompleted ? 'completed' : 'expired',
          expirationReason: isCompleted ? 'completed' : 'violation',
          reasonTitle: isCompleted ? 'Interview Completed' : 'Interview Terminated',
          reasonDetail: isCompleted
            ? 'This link is expired it is one time use , your interview is completed we will get back to you soon'
            : 'This link is expired it is one time use',
          violationReason: isCompleted
            ? undefined
            : (violationReason || 'The interview session was terminated due to a proctoring violation.'),
          warningCount,
        }, { status: 410 });
      }

      let bypassProctoring = false;
      try {
        const { data: inv } = await supabaseAdmin
          .from('interview_invites')
          .select('max_alerts')
          .eq('session_id', session.id)
          .maybeSingle();
        if (inv && (inv.max_alerts ?? 0) > 1000) {
          bypassProctoring = true;
        }
      } catch {}

      return NextResponse.json({
        active: true,
        status: session.status,
        inProgress: session.status === 'in_progress',
        requiresAccessCode: !matchesCookie(session.id),
        bypassProctoring,
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
    await new Promise<void>((resolve) => {
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') resolve();
      });
    });
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

  const cleanEmail = typeof email === 'string' ? email.trim() : '';
  if (!cleanEmail) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanEmail)) {
    return NextResponse.json({ error: 'Please enter a valid email address' }, { status: 400 });
  }

  let isRequesterAdmin = false;
  try {
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('role')
      .eq('email', cleanEmail)
      .single();

    if (profile?.role === 'admin') {
      isRequesterAdmin = true;
    }
  } catch {
    // fallback or continue
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
      .select('id, status, expires_at, access_code, used_at, termination_reason')
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
        const isCompleted = interview.status === 'completed';
        return NextResponse.json({
          error: 'This interview has already ended',
          note: 'Note: This interview link has already been used and is expired.',
          status: 'expired',
          expired: true,
          used: true,
          expirationReason: isCompleted ? 'completed' : 'violation',
          reasonTitle: isCompleted ? 'Interview Completed' : 'Interview Terminated',
          reasonDetail: isCompleted
            ? 'This link is expired it is one time use , your interview is completed we will get back to you soon'
            : 'This link is expired it is one time use',
          violationReason: isCompleted ? undefined : (interview.termination_reason || undefined),
        }, { status: 410 });
      }

      if (!isRequesterAdmin) {
        // Only terminate actively if the interview is 'in_progress'. 
        // If it's pending but used_at is true, allow the same candidate to continue setting up.
        if (interview.status === 'in_progress') {
          if (lockAcquired) releaseJoinLock(interviewId, deviceId);
          await supabaseAdmin.from('ai_interviews').update({ status: 'terminated' }).eq('id', interview.id);
          await broadcastTermination(interviewId);
          return NextResponse.json({
            error: 'This interview link has already been used and is expired',
            note: 'Note: This interview link has already been used and is expired.',
            status: 'expired',
            expired: true,
            used: true,
            expirationReason: 'already_used',
            reasonTitle: 'Link is expired',
            reasonDetail: 'For security and assessment integrity, each interview link is strictly single-use. Because this link has already been accessed, it cannot be opened again.',
          }, { status: 410 });
        }
        
        // If it's used_at but NOT in_progress, we check if they have the right deviceId or cookie lock
        // The lockAcquired handles concurrent protection for now.
        if (interview.used_at && interview.status !== 'in_progress') {
           // We will let them through because lockAcquired passed, meaning no other active device is holding the lock.
        }

        if (!accessCode) {
          return NextResponse.json({ requiresAccessCode: true, isAdmin: false }, { status: 200 });
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

    if (invite.status === 'revoked' || invite.status === 'completed' || invite.status === 'expired') {
      if (lockAcquired) releaseJoinLock(interviewId, deviceId);
      let isCompleted = invite.status === 'completed';
      let isRevoked = invite.status === 'revoked';
      let violationReason: string | undefined;
      let warningCount: number | undefined;

      if (invite.session_id) {
        try {
          const { data: linkedSession } = await supabaseAdmin
            .from('interview_sessions')
            .select('status, voice_warning_count, face_warning_count, object_warning_count')
            .eq('id', invite.session_id)
            .maybeSingle();

          if (linkedSession) {
            if (linkedSession.status === 'cancelled' || linkedSession.status === 'terminated') {
              isRevoked = true;
            } else if (linkedSession.status === 'completed') {
              isCompleted = true;
            }
            const total = (linkedSession.face_warning_count || 0) + (linkedSession.object_warning_count || 0) + (linkedSession.voice_warning_count || 0);
            if (total > 0) warningCount = total;
          }
        } catch {}

        try {
          const { data: violationEvt } = await supabaseAdmin
            .from('interview_events')
            .select('meta, metadata')
            .eq('session_id', invite.session_id)
            .in('event_type', ['proctoring_violation', 'terminated'])
            .order('ts_ms', { ascending: false })
            .limit(1)
            .maybeSingle();

          const meta = (violationEvt?.meta || violationEvt?.metadata) as Record<string, any> | undefined;
          if (meta?.reason) {
            violationReason = String(meta.reason);
            isRevoked = true;
          }
        } catch {}
      }

      return NextResponse.json({
        error: 'This interview link has already been used and is expired',
        note: 'Note: This interview link has already been used and is expired.',
        status: isCompleted ? 'completed' : 'expired',
        expired: true,
        used: true,
        expirationReason: isCompleted ? 'completed' : (isRevoked ? 'violation' : 'already_used'),
        reasonTitle: isCompleted ? 'Interview Completed' : (isRevoked ? 'Interview Terminated' : 'Link is expired'),
        reasonDetail: isCompleted
          ? 'This link is expired it is one time use , your interview is completed we will get back to you soon'
          : 'This link is expired it is one time use',
        violationReason: isRevoked ? (violationReason || 'The interview session was terminated due to a proctoring violation.') : undefined,
        warningCount,
      }, { status: 410 });
    }

    if (!isRequesterAdmin) {
      // Only terminate actively if the interview is 'in_progress'.
      if (invite.status === 'in_progress') {
        if (lockAcquired) releaseJoinLock(interviewId, deviceId);
        await supabaseAdmin.from('interview_invites').update({ status: 'revoked' }).eq('id', invite.id);
        if (invite.session_id) {
          await supabaseAdmin.from('interview_sessions').update({ status: 'terminated' }).eq('id', invite.session_id);
        }
        await broadcastTermination(interviewId);
        const refreshReason = 'The candidate refreshed or closed the page during the live interview.';
        return NextResponse.json({
          error: 'This interview link has already been used and is expired',
          note: 'Note: This interview link has already been used and is expired.',
          status: 'expired',
          expired: true,
          used: true,
          expirationReason: 'violation',
          reasonTitle: 'Interview Terminated',
          reasonDetail: 'This link is expired it is one time use',
          violationReason: refreshReason,
        }, { status: 410 });
      }

      // If consumed_at is set but not in_progress, let them re-enter (setup phase).
      if (invite.consumed_at && (invite.status as string) !== 'in_progress') {
         // Proceed.
      }

      if (!accessCode) {
        return NextResponse.json({ requiresAccessCode: true, isAdmin: false }, { status: 200 });
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

      registerActiveSession(interviewId, deviceId);
      if (invite.session_id) {
        registerActiveSession(invite.session_id, deviceId);
      }
    }

    const sessionId = invite.session_id;

    const { data: session } = await supabaseAdmin
      .from('interview_sessions')
      .select('status')
      .eq('id', sessionId)
      .maybeSingle();

    if (session && (session.status === 'cancelled' || session.status === 'terminated' || session.status === 'completed')) {
      if (lockAcquired) releaseJoinLock(interviewId, deviceId);
      const isCompleted = session.status === 'completed';
      return NextResponse.json({
        error: 'This interview has already ended',
        note: 'Note: This interview link has already been used and is expired.',
        status: 'expired',
        expired: true,
        used: true,
        expirationReason: isCompleted ? 'completed' : 'violation',
        reasonTitle: isCompleted ? 'Interview Completed' : 'Interview Terminated',
        reasonDetail: isCompleted
          ? 'This link is expired it is one time use , your interview is completed we will get back to you soon'
          : 'This link is expired it is one time use',
      }, { status: 410 });
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
      if (session.status === 'cancelled' || session.status === 'terminated' || session.status === 'completed') {
        const isCompleted = session.status === 'completed';
        return NextResponse.json({
          error: 'This interview link has already been used and is expired',
          note: 'Note: This interview link has already been used and is expired.',
          status: 'expired',
          expired: true,
          used: true,
          expirationReason: isCompleted ? 'completed' : 'violation',
          reasonTitle: isCompleted ? 'Interview Completed' : 'Interview Terminated',
          reasonDetail: isCompleted
            ? 'This link is expired it is one time use , your interview is completed we will get back to you soon'
            : 'This link is expired it is one time use',
        }, { status: 410 });
      }
      if (!isRequesterAdmin && session.status === 'in_progress') {
        await supabaseAdmin.from('interview_sessions').update({ status: 'cancelled' }).eq('id', session.id);
        await broadcastTermination(interviewId);
        return NextResponse.json({
          error: 'This interview link has already been used and is expired',
          note: 'Note: This interview link has already been used and is expired.',
          status: 'expired',
          expired: true,
          used: true,
          expirationReason: 'already_used',
          reasonTitle: 'Link is expired',
          reasonDetail: 'For security and assessment integrity, each interview link is strictly single-use. Because this link has already been accessed, it cannot be opened again.',
        }, { status: 410 });
      }

      if (!isRequesterAdmin && !accessCode) {
        return NextResponse.json({ requiresAccessCode: true, isAdmin: false }, { status: 200 });
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
