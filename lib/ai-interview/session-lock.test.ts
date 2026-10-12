import { describe, it, expect, beforeEach } from 'vitest';
import {
  acquireJoinLock,
  releaseJoinLock,
  registerActiveSession,
  isSessionActiveOnOtherDevice,
  clearActiveSession,
  resetSessionLocks,
  CONCURRENT_SESSION_ERROR,
} from './session-lock';

describe('lib/ai-interview/session-lock', () => {
  beforeEach(() => {
    resetSessionLocks();
  });

  it('allows the first user to acquire join lock', () => {
    const res = acquireJoinLock('interview-1', 'device-A');
    expect(res.acquired).toBe(true);
    expect(res.reason).toBeUndefined();
  });

  it('rejects a second user joining milliseconds later for the same interview', () => {
    const user1 = acquireJoinLock('interview-1', 'device-A');
    expect(user1.acquired).toBe(true);

    // User 2 joins 1ms later from laptop B
    const user2 = acquireJoinLock('interview-1', 'device-B');
    expect(user2.acquired).toBe(false);
    expect(user2.reason).toBe(CONCURRENT_SESSION_ERROR);
  });

  it('allows same device to re-acquire its own lock', () => {
    const user1 = acquireJoinLock('interview-1', 'device-A');
    expect(user1.acquired).toBe(true);

    const sameUser = acquireJoinLock('interview-1', 'device-A');
    expect(sameUser.acquired).toBe(true);
  });

  it('allows second user to acquire lock after first user releases it (e.g. wrong passcode)', () => {
    const user1 = acquireJoinLock('interview-1', 'device-A');
    expect(user1.acquired).toBe(true);

    releaseJoinLock('interview-1', 'device-A');

    const user2 = acquireJoinLock('interview-1', 'device-B');
    expect(user2.acquired).toBe(true);
  });

  it('prevents second user once active session is registered to device A', () => {
    acquireJoinLock('interview-1', 'device-A');
    registerActiveSession('interview-1', 'device-A');

    // Device B tries to join
    const user2 = acquireJoinLock('interview-1', 'device-B');
    expect(user2.acquired).toBe(false);
    expect(user2.reason).toBe(CONCURRENT_SESSION_ERROR);

    expect(isSessionActiveOnOtherDevice('interview-1', 'device-B')).toBe(true);
    expect(isSessionActiveOnOtherDevice('interview-1', 'device-A')).toBe(false);
  });

  it('allows new session after clearing active session (e.g. on complete/terminate)', () => {
    registerActiveSession('interview-1', 'device-A');
    clearActiveSession('interview-1');

    const user2 = acquireJoinLock('interview-1', 'device-B');
    expect(user2.acquired).toBe(true);
  });
});
