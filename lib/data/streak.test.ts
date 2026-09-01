import { describe, it, expect } from 'vitest';
import { computeStreak, isBriefingDay, parseDateKey } from './streak';
import type { ActivityRecord } from '@/types/contracts';

const ref = new Date('2026-06-30T12:00:00Z');

function rec(date: string, readSeconds: number): ActivityRecord {
  return { date, readSeconds, quizTaken: false, quizScore: 0, quizTotal: 0 };
}

function quizRec(
  date: string,
  opts: { started?: boolean; taken?: boolean } = {},
): ActivityRecord {
  return {
    date,
    readSeconds: 0,
    quizTaken: opts.taken ?? false,
    quizStarted: opts.started ?? false,
    quizScore: 0,
    quizTotal: 0,
  };
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

  describe('weekends', () => {
    // No briefing is generated Sat/Sun, so a quiet weekend is not a missed day.
    const monday = new Date(2026, 8, 7); // 7 Sep 2026

    it('carries a Friday streak through to Monday', () => {
      const records = [
        rec('2026-09-07', 100), // Mon
        rec('2026-09-04', 100), // Fri
        rec('2026-09-03', 100), // Thu
      ];
      expect(computeStreak(records, monday)).toBe(3);
    });

    it('holds over the weekend even when Monday has not been read yet', () => {
      const records = [rec('2026-09-04', 100), rec('2026-09-03', 100)];
      expect(computeStreak(records, monday)).toBe(2);
    });

    it('still breaks on a missed weekday', () => {
      const records = [
        rec('2026-09-07', 100), // Mon
        rec('2026-09-03', 100), // Thu -- Friday the 4th was missed
      ];
      expect(computeStreak(records, monday)).toBe(1);
    });

    it('counts a weekend the user did engage with as a day', () => {
      const records = [
        rec('2026-09-07', 100), // Mon
        rec('2026-09-06', 100), // Sun
        rec('2026-09-04', 100), // Fri (Sat quiet)
      ];
      expect(computeStreak(records, monday)).toBe(3);
    });

    it('does not run away on an empty history', () => {
      expect(computeStreak([], monday)).toBe(0);
    });
  });

  describe('quiz engagement', () => {
    const thursday = new Date(2026, 8, 3); // 3 Sep 2026

    it('counts a day where the quiz was only started', () => {
      const records = [quizRec('2026-09-03', { started: true })];
      expect(computeStreak(records, thursday)).toBe(1);
    });

    it('counts a completed quiz with no reading time', () => {
      const records = [quizRec('2026-09-03', { started: true, taken: true })];
      expect(computeStreak(records, thursday)).toBe(1);
    });

    it('ignores a day with neither reading nor a quiz', () => {
      const records = [quizRec('2026-09-03')];
      expect(computeStreak(records, thursday)).toBe(0);
    });
  });
});

describe('isBriefingDay', () => {
  it('is true Monday to Friday and false at the weekend', () => {
    expect(isBriefingDay(new Date(2026, 8, 4))).toBe(true); // Fri
    expect(isBriefingDay(new Date(2026, 8, 5))).toBe(false); // Sat
    expect(isBriefingDay(new Date(2026, 8, 6))).toBe(false); // Sun
    expect(isBriefingDay(new Date(2026, 8, 7))).toBe(true); // Mon
  });
});

describe('parseDateKey', () => {
  it('parses a key as local midnight, not UTC', () => {
    const parsed = parseDateKey('2026-09-03');
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(8);
    expect(parsed?.getDate()).toBe(3);
  });

  it('returns null for a malformed key', () => {
    expect(parseDateKey('nonsense')).toBeNull();
  });
});
