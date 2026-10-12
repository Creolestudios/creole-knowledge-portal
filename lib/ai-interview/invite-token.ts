import crypto from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Shared helpers for resolving a candidate-facing invite token (from the
 * `/assess/[token]` URL) back to its `interview_invites` row. The raw token
 * is never stored — only its SHA-256 hash — so lookups always hash first.
 */

export interface ResolvedInvite {
  id: string;
  session_id: string;
  token_hash: string;
  passcode_hash: string | null;
  passcode_salt: string | null;
  status: 'active' | 'in_progress' | 'completed' | 'expired' | 'revoked';
  max_warnings: number;
  max_alerts: number;
  expires_at: string | null;
  consumed_at: string | null;
  completed_at: string | null;
}

export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function hashPasscode(passcode: string, salt: string): string {
  return crypto.scryptSync(passcode + salt, salt, 64).toString('hex');
}

export async function resolveInviteByToken(rawToken: string): Promise<ResolvedInvite | null> {
  try {
    const token_hash = hashToken(rawToken);
    const { data, error } = await supabaseAdmin
      .from('interview_invites')
      .select('*')
      .eq('token_hash', token_hash)
      .single();

    if (error || !data || !data.session_id) return null;
    return data as ResolvedInvite;
  } catch {
    return null;
  }
}

export function isInviteExpired(invite: ResolvedInvite): boolean {
  if (!invite.expires_at) return false;
  return new Date(invite.expires_at) < new Date();
}

/**
 * Resolves an interview identifier (which can be a raw invite token, invite ID,
 * session ID, or legacy ai_interviews ID) to the target session ID.
 */
export async function resolveInterviewSessionId(idOrToken: string): Promise<string | null> {
  if (!idOrToken) return null;

  try {
    // 1. Try resolving via invite token hash
    const inviteByToken = await resolveInviteByToken(idOrToken);
    if (inviteByToken?.session_id) return inviteByToken.session_id;

    // 2. Try resolving via interview_invites by ID
    const { data: inviteData } = await supabaseAdmin
      .from('interview_invites')
      .select('session_id')
      .eq('id', idOrToken)
      .single();

    if (inviteData?.session_id) return inviteData.session_id;

    // 3. Try resolving via interview_sessions by ID
    const { data: sessionData } = await supabaseAdmin
      .from('interview_sessions')
      .select('id')
      .eq('id', idOrToken)
      .single();

    if (sessionData?.id) return sessionData.id;

    // 4. Try resolving via ai_interviews table
    const { data: aiData } = await supabaseAdmin
      .from('ai_interviews')
      .select('id')
      .eq('id', idOrToken)
      .single();

    if (aiData?.id) return aiData.id;
  } catch {
    // Return null on lookup failure
  }

  return null;
}
