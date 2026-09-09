/**
 * Wall-clock reading time for the daily briefing (activity logging only).
 *
 * Stored in localStorage so elapsed time continues across dashboard tabs,
 * other app pages, browser tab switches, and full navigations in this origin.
 * `stoppedAt` is set when the quiz opens — never on hide.
 * There is no reading-time limit / auto-open quiz.
 */

export const ACTIVE_BLOG_STORAGE_KEY = 'active_blog_id';

const OPENING_QUIZ_KEY = 'reading_timer_opening_quiz';

export type ReadingTimerState = {
  startedAt: number;
  stoppedAt: number | null;
};

export function readingTimerKey(blogId: string): string {
  return `reading_timer:${blogId}`;
}

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getActiveBlogId(): string | null {
  const store = storage();
  if (!store) return null;
  return store.getItem(ACTIVE_BLOG_STORAGE_KEY);
}

export function setActiveBlogId(blogId: string): void {
  const store = storage();
  if (!store) return;
  store.setItem(ACTIVE_BLOG_STORAGE_KEY, blogId);
  // Keep session copy for older callers that still read sessionStorage.
  try {
    sessionStorage.setItem(ACTIVE_BLOG_STORAGE_KEY, blogId);
  } catch {
    /* ignore */
  }
}

export function readTimerState(blogId: string): ReadingTimerState | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw =
      store.getItem(readingTimerKey(blogId)) ||
      (typeof sessionStorage !== 'undefined'
        ? sessionStorage.getItem(readingTimerKey(blogId))
        : null);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { startedAt?: number; stoppedAt?: number | null };
    const startedAt = Number(parsed?.startedAt);
    if (!startedAt) return null;
    const stoppedRaw = parsed?.stoppedAt;
    const state: ReadingTimerState = {
      startedAt,
      stoppedAt: stoppedRaw ? Number(stoppedRaw) : null,
    };
    // Migrate session → local so other pages see the same clock.
    writeTimerState(blogId, state);
    return state;
  } catch {
    return null;
  }
}

export function writeTimerState(blogId: string, state: ReadingTimerState): void {
  const store = storage();
  if (!store) return;
  const payload = JSON.stringify(state);
  store.setItem(readingTimerKey(blogId), payload);
  try {
    sessionStorage.setItem(readingTimerKey(blogId), payload);
  } catch {
    /* ignore */
  }
}

export function elapsedSeconds(state: ReadingTimerState): number {
  const end = state.stoppedAt ?? Date.now();
  return Math.max(0, Math.floor((end - state.startedAt) / 1000));
}

export function cappedReadSeconds(seconds: number): number {
  return Math.max(0, seconds);
}

export function isReadingTimerRunning(state: ReadingTimerState | null): boolean {
  return Boolean(state && !state.stoppedAt);
}

/** Claim auto-open once so DailyBlogTab + layout watchdog do not double-navigate. */
export function claimQuizAutoOpen(blogId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (sessionStorage.getItem(OPENING_QUIZ_KEY) === blogId) return false;
    sessionStorage.setItem(OPENING_QUIZ_KEY, blogId);
    return true;
  } catch {
    return true;
  }
}

export function clearQuizAutoOpenClaim(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(OPENING_QUIZ_KEY);
  } catch {
    /* ignore */
  }
}
