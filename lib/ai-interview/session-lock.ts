/**
 * Session Lock & Concurrency Manager for AI Interviews
 *
 * Prevents race conditions and duplicate concurrent logins when multiple users
 * attempt to join the same interview link at the same time (even milliseconds apart).
 */

export const CONCURRENT_SESSION_ERROR =
  'An active interview session is already in progress on another device. Simultaneous access to the same interview link is prohibited.';

interface LockEntry {
  holderId: string;
  acquiredAt: number;
  expiresAt: number;
}

interface ActiveSessionEntry {
  deviceId: string;
  startedAt: number;
  lastHeartbeat: number;
}

// In-memory locks keyed by interviewId or invite token
const inFlightLocks = new Map<string, LockEntry>();
const activeSessions = new Map<string, ActiveSessionEntry>();

// Clean up expired locks periodically
const LOCK_TTL_MS = 10_000; // 10 seconds for initial join negotiation
const SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours maximum session lifetime

/**
 * Attempts to acquire an atomic join lock for an interview link.
 * If two requests arrive within milliseconds, only the first caller acquires the lock.
 * The second caller is immediately rejected with a concurrency conflict.
 */
export function acquireJoinLock(
  key: string,
  holderId: string,
  ttlMs: number = LOCK_TTL_MS
): { acquired: boolean; reason?: string } {
  const now = Date.now();
  const normalizedKey = key.trim().toLowerCase();

  // 1. Check if an active session is already registered to a different device
  const existingSession = activeSessions.get(normalizedKey);
  if (existingSession) {
    if (now - existingSession.lastHeartbeat < SESSION_TTL_MS) {
      if (existingSession.deviceId && existingSession.deviceId !== holderId) {
        return {
          acquired: false,
          reason: CONCURRENT_SESSION_ERROR,
        };
      }
    } else {
      activeSessions.delete(normalizedKey);
    }
  }

  // 2. Check if another request is currently in the middle of verifying/joining
  const existingLock = inFlightLocks.get(normalizedKey);
  if (existingLock) {
    if (now < existingLock.expiresAt) {
      if (existingLock.holderId !== holderId) {
        return {
          acquired: false,
          reason: CONCURRENT_SESSION_ERROR,
        };
      }
    } else {
      inFlightLocks.delete(normalizedKey);
    }
  }

  // 3. Atomically acquire lock
  inFlightLocks.set(normalizedKey, {
    holderId,
    acquiredAt: now,
    expiresAt: now + ttlMs,
  });

  return { acquired: true };
}

/**
 * Releases the in-flight lock (e.g. if passcode verification failed)
 */
export function releaseJoinLock(key: string, holderId: string): void {
  const normalizedKey = key.trim().toLowerCase();
  const existingLock = inFlightLocks.get(normalizedKey);
  if (existingLock && existingLock.holderId === holderId) {
    inFlightLocks.delete(normalizedKey);
  }
}

/**
 * Registers an active session once verification succeeds.
 */
export function registerActiveSession(key: string, deviceId: string): void {
  const normalizedKey = key.trim().toLowerCase();
  const now = Date.now();
  activeSessions.set(normalizedKey, {
    deviceId,
    startedAt: now,
    lastHeartbeat: now,
  });
  // Clear the in-flight lock once session is active
  inFlightLocks.delete(normalizedKey);
}

/**
 * Checks if a session is currently active on another device.
 */
export function isSessionActiveOnOtherDevice(key: string, deviceId?: string): boolean {
  const normalizedKey = key.trim().toLowerCase();
  const now = Date.now();
  const session = activeSessions.get(normalizedKey);
  if (!session) return false;

  if (now - session.lastHeartbeat >= SESSION_TTL_MS) {
    activeSessions.delete(normalizedKey);
    return false;
  }

  if (deviceId && session.deviceId === deviceId) {
    return false;
  }

  return true;
}

/**
 * Updates the session heartbeat from an active device.
 */
export function updateSessionHeartbeat(key: string, deviceId: string): boolean {
  const normalizedKey = key.trim().toLowerCase();
  const session = activeSessions.get(normalizedKey);
  if (!session) return false;

  if (session.deviceId === deviceId) {
    session.lastHeartbeat = Date.now();
    return true;
  }
  return false;
}

/**
 * Clears the active session and locks (on completion or termination).
 */
export function clearActiveSession(key: string): void {
  const normalizedKey = key.trim().toLowerCase();
  activeSessions.delete(normalizedKey);
  inFlightLocks.delete(normalizedKey);
}

/**
 * Resets all locks and sessions (primarily for unit tests).
 */
export function resetSessionLocks(): void {
  inFlightLocks.clear();
  activeSessions.clear();
}
