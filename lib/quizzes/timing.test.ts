import { describe, it, expect } from 'vitest';
import {
  MAX_QUIZ_TIME_SECONDS,
  QUIZ_TIME_LIMIT_SECONDS,
  elapsedSecondsSince,
  resolveTimeTakenSeconds,
  formatDuration,
} from './timing';

const START = '2026-08-31T10:00:00.000Z';
const at = (seconds: number) => new Date(START).getTime() + seconds * 1000;

describe('resolveTimeTakenSeconds', () => {
  it('reports the real duration for an attempt longer than 10 minutes', () => {
    // Regression: this used to be clamped to 600 and always displayed as 10:00.
    expect(resolveTimeTakenSeconds(START, undefined, at(905))).toBe(905);
  });

  it('never records more than the quiz limit plus the idle grace period', () => {
    expect(resolveTimeTakenSeconds(START, undefined, at(99_999))).toBe(MAX_QUIZ_TIME_SECONDS);
    expect(MAX_QUIZ_TIME_SECONDS).toBeGreaterThan(QUIZ_TIME_LIMIT_SECONDS);
  });

  it('lets a resumed attempt correct an inflated server elapsed time', () => {
    // started_at is not reset on resume, so wall-clock spans the whole gap.
    expect(resolveTimeTakenSeconds(START, 240, at(86_400))).toBe(240);
  });

  it('ignores a client value that would under-report the duration', () => {
    expect(resolveTimeTakenSeconds(START, 5, at(300))).toBe(5);
    expect(resolveTimeTakenSeconds(START, 900, at(300))).toBe(300);
  });

  it('rejects malformed client values instead of recording NaN', () => {
    expect(resolveTimeTakenSeconds(START, 'abc', at(120))).toBe(120);
    expect(resolveTimeTakenSeconds(START, -50, at(120))).toBe(120);
    expect(resolveTimeTakenSeconds(START, null, at(120))).toBe(120);
  });

  it('never returns a negative value when clocks disagree', () => {
    expect(resolveTimeTakenSeconds(START, undefined, at(-30))).toBe(0);
  });

  it('falls back to the client value when started_at is missing or invalid', () => {
    expect(resolveTimeTakenSeconds(null, 180)).toBe(180);
    expect(resolveTimeTakenSeconds('not-a-date', 180)).toBe(180);
    expect(resolveTimeTakenSeconds(null, undefined)).toBe(0);
  });
});

describe('elapsedSecondsSince', () => {
  it('returns null for unusable input', () => {
    expect(elapsedSecondsSince(null)).toBeNull();
    expect(elapsedSecondsSince('nonsense')).toBeNull();
  });

  it('measures whole seconds from the start instant', () => {
    expect(elapsedSecondsSince(START, at(61))).toBe(61);
  });
});

describe('formatDuration', () => {
  it('pads seconds and handles the zero and invalid cases', () => {
    expect(formatDuration(905)).toBe('15:05');
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(null)).toBe('0:00');
    expect(formatDuration(NaN)).toBe('0:00');
  });
});
