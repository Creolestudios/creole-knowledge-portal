/**
 * Single source of truth for quiz timing.
 *
 * Previously `finish` clamped the recorded time to 600s while the actual quiz
 * budget is 900s, so every attempt longer than 10 minutes was reported as
 * exactly "10:00", and `status` hard-coded a different value again (600) than
 * the one it wrote to the database (900).
 */

/** Idle window: the runner shows the "still there?" modal at this point. */
export const QUIZ_TIME_LIMIT_SECONDS = 15 * 60;

/** Countdown the user gets on the idle modal before we auto-submit. */
export const QUIZ_IDLE_GRACE_SECONDS = 60;

/** Longest time an attempt can legitimately take (limit + grace). */
export const MAX_QUIZ_TIME_SECONDS =
  QUIZ_TIME_LIMIT_SECONDS + QUIZ_IDLE_GRACE_SECONDS;

/**
 * Wall-clock seconds between `startedAt` and `now`, or null if unusable.
 */
export function elapsedSecondsSince(
  startedAt: string | Date | null | undefined,
  now: number = Date.now(),
): number | null {
  if (!startedAt) return null;
  const startedMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startedMs)) return null;
  return Math.floor((now - startedMs) / 1000);
}

/**
 * Time to record for a finished attempt.
 *
 * The server clock is authoritative so a client cannot under-report to game the
 * leaderboard. A client-measured value is only allowed to *lower* the result,
 * which is what makes a resumed attempt correct: `started_at` is not reset on
 * resume, so server elapsed can span hours of the tab merely being open, while
 * the client measured the actual sitting.
 */
export function resolveTimeTakenSeconds(
  startedAt: string | Date | null | undefined,
  clientElapsedSeconds?: unknown,
  now: number = Date.now(),
): number {
  const serverElapsed = elapsedSecondsSince(startedAt, now);

  const clientElapsed =
    typeof clientElapsedSeconds === 'number' &&
    Number.isFinite(clientElapsedSeconds) &&
    clientElapsedSeconds >= 0
      ? Math.floor(clientElapsedSeconds)
      : null;

  let resolved: number;
  if (serverElapsed === null) {
    resolved = clientElapsed ?? 0;
  } else if (clientElapsed === null) {
    resolved = serverElapsed;
  } else {
    resolved = Math.min(serverElapsed, clientElapsed);
  }

  return Math.min(MAX_QUIZ_TIME_SECONDS, Math.max(0, resolved));
}

/** mm:ss for display. */
export function formatDuration(totalSeconds: number | null | undefined): string {
  const safe =
    typeof totalSeconds === 'number' && Number.isFinite(totalSeconds) && totalSeconds > 0
      ? Math.floor(totalSeconds)
      : 0;
  return `${Math.floor(safe / 60)}:${(safe % 60).toString().padStart(2, '0')}`;
}
