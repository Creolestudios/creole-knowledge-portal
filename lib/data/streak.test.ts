import { describe, it, expect } from 'vitest';
import { computeStreak } from './streak';
import type { ActivityRecord } from '@/types/contracts';

const ref = new Date('2026-06-30T12:00:00Z');

function rec(date: string, readSeconds: number): ActivityRecord {
  return { date, readSeconds, quizTaken: false, quizScore: 0, quizTotal: 0 };
}

describe('computeStreak', () => {
  it('counts consecutive read days ending today', () => {
    const records = [rec('2026-06-30', 100), rec('2026-06-29', 100), rec('2026-06-28', 100)];
    expect(computeStreak(records, ref)).toBe(3);
  });

  it('holds the streak when today is not read yet (counts from yesterday)', () => {
    const records = [rec('2026-06-29', 100), rec('2026-06-28', 100)];
    expect(computeStreak(records, ref)).toBe(2);
  });

  it('stops at the first gap', () => {
    const records = [rec('2026-06-30', 100), rec('2026-06-28', 100)]; // 29th missing
    expect(computeStreak(records, ref)).toBe(1);
  });

  it('ignores days with zero read time', () => {
    const records = [rec('2026-06-30', 0), rec('2026-06-29', 0)];
    expect(computeStreak(records, ref)).toBe(0);
  });

  it('returns 0 for no records', () => {
    expect(computeStreak([], ref)).toBe(0);
  });
});
