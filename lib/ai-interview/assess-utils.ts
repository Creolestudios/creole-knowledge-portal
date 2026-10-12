import { NextResponse } from 'next/server';
import { resolveInviteByToken } from '@/lib/ai-interview/invite-token';

export async function validateActiveAssessToken(token: string | undefined, requireInProgress: boolean = true) {
  if (!token) {
    return { errorResponse: NextResponse.json({ error: 'Token is required' }, { status: 400 }) };
  }

  const invite = await resolveInviteByToken(token);
  if (!invite) {
    return { errorResponse: NextResponse.json({ error: 'Invalid or unknown interview link' }, { status: 404 }) };
  }

  if (requireInProgress && invite.status !== 'in_progress') {
    return { errorResponse: NextResponse.json({ error: 'This interview session is not active' }, { status: 409 }) };
  }

  return { invite };
}
