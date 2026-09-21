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
  const token_hash = hashToken(rawToken);
  const { data, error } = await supabaseAdmin
    .from('interview_invites')
    .select('*')
    .eq('token_hash', token_hash)
    .single();

  if (error || !data) return null;
  return data as ResolvedInvite;
}

export function isInviteExpired(invite: ResolvedInvite): boolean {
  if (!invite.expires_at) return false;
  return new Date(invite.expires_at) < new Date();
}
