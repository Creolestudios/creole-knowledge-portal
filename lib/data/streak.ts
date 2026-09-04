/**
 * Reading-streak helpers. Pure functions (no DOM) so they can be unit-tested,
 * and the single source of truth for streak rules across the API and the UI.
 */
import type { ActivityRecord } from '@/types/contracts';

/** Hard bound on the walk-back so a bad clock can never spin forever. */
const MAX_STREAK_DAYS = 3660;

/** `YYYY-MM-DD` in the local timezone. */
export function localDateKey(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parse a `YYYY-MM-DD` key as local midnight.
 *
 * `new Date('2026-06-30')` is parsed as *UTC* midnight, which lands on the
 * previous day in any negative UTC offset. That off-by-one used to break the
 * streak outright for those users.
 */
export function parseDateKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(key);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * Briefings are generated Monday-Friday only, so a quiet Saturday or Sunday is
 * not a missed day -- there was nothing to read. Weekends are skipped over when
 * walking the streak back rather than breaking it.
 */
export function isBriefingDay(d: Date): boolean {
  const day = d.getDay();
  return day !== 0 && day !== 6;
}

/**
 * A day counts towards the streak when the user engaged with that day's
 * briefing: time spent reading, or a quiz they started (finishing it is not
 * required -- starting one means they were here and working through it).
 */
export function isActiveDay(
  record: Pick<ActivityRecord, 'readSeconds' | 'quizTaken' | 'quizStarted'>,
): boolean {
  return record.readSeconds > 0 || record.quizTaken === true || record.quizStarted === true;
}

/**
 * Consecutive engaged days ending today, or yesterday so a not-yet-read today
 * doesn't prematurely break the streak. Weekends never break it; a weekend the
 * user *did* engage on still counts as a day.
 */
export function computeStreak(
  records: ActivityRecord[],
  referenceDate: Date = new Date(),
): number {
  const activeDays = new Set(
    records.filter(isActiveDay).map((r) => r.date.slice(0, 10)),
  );

  const cursor = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  );

  // Today may simply not have happened yet, so it is never counted as a miss.
  if (!activeDays.has(localDateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }

  let streak = 0;
  for (let guard = 0; guard < MAX_STREAK_DAYS; guard += 1) {
    if (activeDays.has(localDateKey(cursor))) {
      streak += 1;
    } else if (isBriefingDay(cursor)) {
      // A weekday with no engagement is a genuine miss.
      break;
    }
    // Weekend with no engagement: skip it, leaving the streak intact.
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}
