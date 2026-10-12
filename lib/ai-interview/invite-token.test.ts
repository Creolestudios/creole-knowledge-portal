import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashToken, hashPasscode, isInviteExpired, resolveInviteByToken } from './invite-token';

const { state, mockFrom } = vi.hoisted(() => {
  const state = {
    data: null as any,
    error: null as any,
  };
  const mockFrom = vi.fn(() => ({
    select: () => ({
      eq: () => ({
        single: async () => ({ data: state.data, error: state.error }),
      }),
    }),
  }));
  return { state, mockFrom };
});

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: mockFrom },
}));

describe('invite-token helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.data = null;
    state.error = null;
  });

  it('hashToken is deterministic and hex-encoded', () => {
    const a = hashToken('raw-token');
    const b = hashToken('raw-token');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashToken produces different hashes for different tokens', () => {
    expect(hashToken('token-a')).not.toBe(hashToken('token-b'));
  });

  it('hashPasscode mixes in the salt', () => {
    const withSaltA = hashPasscode('123456', 'salt-a');
    const withSaltB = hashPasscode('123456', 'salt-b');
    expect(withSaltA).not.toBe(withSaltB);
  });

  it('isInviteExpired is false when there is no expiry', () => {
    expect(isInviteExpired({ expires_at: null } as any)).toBe(false);
  });

  it('isInviteExpired is true for a past expiry', () => {
    expect(
      isInviteExpired({ expires_at: new Date(Date.now() - 1000).toISOString() } as any),
    ).toBe(true);
  });

  it('isInviteExpired is false for a future expiry', () => {
    expect(
      isInviteExpired({ expires_at: new Date(Date.now() + 100000).toISOString() } as any),
    ).toBe(false);
  });

  it('resolveInviteByToken returns null on error', async () => {
    state.error = { message: 'not found' };
    const result = await resolveInviteByToken('raw-token');
    expect(result).toBeNull();
  });

  it('resolveInviteByToken returns null when no data', async () => {
    state.data = null;
    state.error = null;
    const result = await resolveInviteByToken('raw-token');
    expect(result).toBeNull();
  });

  it('resolveInviteByToken returns the row hashed by token', async () => {
    state.data = { id: 'inv1', session_id: 's1', status: 'active' };
    const result = await resolveInviteByToken('raw-token');
    expect(result).toEqual(state.data);
    expect(mockFrom).toHaveBeenCalledWith('interview_invites');
  });
});
