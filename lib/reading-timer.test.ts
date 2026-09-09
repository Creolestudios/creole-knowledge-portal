// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  cappedReadSeconds,
  claimQuizAutoOpen,
  clearQuizAutoOpenClaim,
  elapsedSeconds,
  getActiveBlogId,
  isReadingTimerRunning,
  readTimerState,
  setActiveBlogId,
  writeTimerState,
} from './reading-timer';

describe('reading-timer', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('persists active blog and timer state in localStorage', () => {
    setActiveBlogId('blog-1');
    writeTimerState('blog-1', { startedAt: 1_000, stoppedAt: null });
    expect(getActiveBlogId()).toBe('blog-1');
    expect(readTimerState('blog-1')).toEqual({ startedAt: 1_000, stoppedAt: null });
    expect(isReadingTimerRunning(readTimerState('blog-1'))).toBe(true);
  });

  it('migrates a sessionStorage timer into localStorage', () => {
    sessionStorage.setItem(
      'reading_timer:blog-2',
      JSON.stringify({ startedAt: 5_000, stoppedAt: null }),
    );
    const state = readTimerState('blog-2');
    expect(state?.startedAt).toBe(5_000);
    expect(localStorage.getItem('reading_timer:blog-2')).toContain('5000');
  });

  it('floors negative read seconds at zero without an upper cap', () => {
    expect(cappedReadSeconds(-10)).toBe(0);
    expect(cappedReadSeconds(40 * 60 + 99)).toBe(40 * 60 + 99);
  });

  it('uses wall-clock elapsed while the timer is running', () => {
    const startedAt = Date.now() - 90_000;
    expect(elapsedSeconds({ startedAt, stoppedAt: null })).toBeGreaterThanOrEqual(89);
  });

  it('claims quiz auto-open only once per blog', () => {
    clearQuizAutoOpenClaim();
    expect(claimQuizAutoOpen('blog-1')).toBe(true);
    expect(claimQuizAutoOpen('blog-1')).toBe(false);
    clearQuizAutoOpenClaim();
    expect(claimQuizAutoOpen('blog-1')).toBe(true);
  });
});
