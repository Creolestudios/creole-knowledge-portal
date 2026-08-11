import { describe, it, expect } from 'vitest';
import { computeWeeklyStats, getDayStatus } from './activity';
import type { ActivityRecord } from '@/types/contracts';

const ref = new Date('2026-06-30T12:00:00Z');

describe('getDayStatus', () => {
  const base: ActivityRecord = {
    date: '2026-06-30',
    readSeconds: 600,
    quizTaken: true,
    quizScore: 2,
    quizTotal: 2,
  };

  it('is completed when read and quiz passed (>= 60%)', () => {
    expect(getDayStatus(base)).toBe('completed');
    expect(getDayStatus({ ...base, quizScore: 3, quizTotal: 5 })).toBe('completed'); // 60%
  });

  it('is partial when read but quiz failed or skipped', () => {
    expect(getDayStatus({ ...base, quizScore: 2, quizTotal: 5 })).toBe('partial'); // 40%
    expect(getDayStatus({ ...base, quizTaken: false, quizScore: 0, quizTotal: 0 })).toBe('partial');
  });

  it('is missed when nothing was attempted or no record', () => {
    expect(getDayStatus(undefined)).toBe('missed');
    expect(
      getDayStatus({ ...base, readSeconds: 0, quizTaken: false, quizScore: 0, quizTotal: 0 })
    ).toBe('missed');
  });
});

describe('computeWeeklyStats', () => {
  it('counts only the trailing 7 days', () => {
    const records: ActivityRecord[] = [
      { date: '2026-06-30', readSeconds: 600, quizTaken: true, quizScore: 2, quizTotal: 2 },
      { date: '2026-06-24', readSeconds: 300, quizTaken: false, quizScore: 0, quizTotal: 0 },
      // Outside the window (older than 7 days) — must be ignored.
      { date: '2026-06-20', readSeconds: 900, quizTaken: true, quizScore: 5, quizTotal: 5 },
    ];
    const stats = computeWeeklyStats(records, ref);
    expect(stats.daysRead).toBe(2);
    expect(stats.quizzesSubmitted).toBe(1);
  });

  it('computes correct/wrong percentages from submitted quizzes', () => {
    const records: ActivityRecord[] = [
      { date: '2026-06-29', readSeconds: 600, quizTaken: true, quizScore: 3, quizTotal: 4 },
      { date: '2026-06-28', readSeconds: 600, quizTaken: true, quizScore: 1, quizTotal: 4 },
    ];
    const stats = computeWeeklyStats(records, ref);
    expect(stats.correctPct).toBe(50); // 4 correct of 8
    expect(stats.wrongPct).toBe(50);
  });

  it('ignores days with zero read time for daysRead', () => {
    const records: ActivityRecord[] = [
      { date: '2026-06-30', readSeconds: 0, quizTaken: false, quizScore: 0, quizTotal: 0 },
      { date: '2026-06-29', readSeconds: 120, quizTaken: false, quizScore: 0, quizTotal: 0 },
    ];
    expect(computeWeeklyStats(records, ref).daysRead).toBe(1);
  });

  it('returns zeros when there are no quizzes', () => {
    const stats = computeWeeklyStats([], ref);
    expect(stats).toEqual({ daysRead: 0, quizzesSubmitted: 0, correctPct: 0, wrongPct: 0 });
  });
});
