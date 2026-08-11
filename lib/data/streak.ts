/**
 * Reading-streak helpers. Pure functions (no DOM) so they can be unit-tested.
 */
import type { ActivityRecord } from '@/types/contracts';

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Count consecutive days with reading activity ending today (or yesterday, so a
 * not-yet-read "today" doesn't break the streak). A day counts if its
 * `readSeconds > 0`.
 */
export function computeStreak(records: ActivityRecord[], referenceDate: Date = new Date()): number {
  const readDays = new Set(records.filter((r) => r.readSeconds > 0).map((r) => r.date));

  const cursor = new Date(referenceDate);
  // If today isn't read yet, start counting from yesterday so the streak holds.
  if (!readDays.has(iso(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }

  let streak = 0;
  while (readDays.has(iso(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
