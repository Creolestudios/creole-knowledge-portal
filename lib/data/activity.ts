/**
 * Activity data-access layer.
 *
 * Reads seed data from a mock fixture and persists the user's live
 * reading-time / quiz results to `localStorage` (client-only) so the timer and
 * quiz outcomes survive reloads during this frontend-only phase.
 *
 * To go live, swap the localStorage reads/writes for backend calls:
 *   getActivity()    -> GET  /api/activity/{user_id}
 *   logActivity(rec) -> POST /api/activity/{user_id}
 * The pure aggregation (`computeWeeklyStats`) stays unchanged.
 */
import type { ActivityRecord, WeeklyStats } from '@/types/contracts';
import { isBriefingDay, localDateKey } from '@/lib/data/streak';
import seed from '@/lib/mock/activity.json';

const STORAGE_KEY = 'ckp.activity.v1';
const SEED = seed as ActivityRecord[];

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function readStore(): ActivityRecord[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ActivityRecord[]) : [];
  } catch {
    return [];
  }
}

function writeStore(records: ActivityRecord[]): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // localStorage may be unavailable (private mode / SSR) — fail silently.
  }
}

/**
 * Merge the seed fixture with any locally-stored records. Stored records for a
 * given date win over the seed for that date.
 */
function mergeByDate(base: ActivityRecord[], overrides: ActivityRecord[]): ActivityRecord[] {
  const map = new Map<string, ActivityRecord>();
  for (const r of base) map.set(r.date, r);
  for (const r of overrides) map.set(r.date, r);
  return Array.from(map.values()).sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** All activity records, newest first (seed + locally-stored). */
export async function getActivity(): Promise<ActivityRecord[]> {
  return mergeByDate(SEED, readStore());
}

/**
 * Engagement status for a single learning day, used to colour the calendar:
 *  - `completed` — read the blog AND passed the quiz (≥ 60%)            → green
 *  - `partial`   — engaged but incomplete (read only, skipped or failed quiz) → orange
 *  - `missed`    — nothing attempted (no read, no quiz)                 → red
 *
 * Pure function (no DOM) so it can be unit-tested directly.
 */
export type DayStatus = 'completed' | 'partial' | 'missed';

export function getDayStatus(record?: ActivityRecord): DayStatus {
  if (!record || (record.readSeconds === 0 && !record.quizTaken)) return 'missed';
  const passedQuiz =
    record.quizTaken && record.quizTotal > 0 && record.quizScore / record.quizTotal >= 0.6;
  if (record.readSeconds > 0 && passedQuiz) return 'completed';
  return 'partial';
}

/** Map of date → engagement status, for the Past Blogs calendar. */
export async function getDayStatuses(): Promise<Record<string, DayStatus>> {
  const records = await getActivity();
  const map: Record<string, DayStatus> = {};
  for (const r of records) map[r.date] = getDayStatus(r);
  return map;
}

/**
 * Upsert a record for a date. Read seconds accumulate; quiz fields overwrite
 * once a quiz is taken. Used by the reading timer and the quiz modal.
 */
export async function logActivity(
  update: Partial<ActivityRecord> & { date: string }
): Promise<void> {
  const stored = readStore();
  const existing =
    stored.find((r) => r.date === update.date) ?? SEED.find((r) => r.date === update.date);

  const merged: ActivityRecord = {
    date: update.date,
    readSeconds: (existing?.readSeconds ?? 0) + (update.readSeconds ?? 0),
    quizTaken: update.quizTaken ?? existing?.quizTaken ?? false,
    quizScore: update.quizTaken ? (update.quizScore ?? 0) : (existing?.quizScore ?? 0),
    quizTotal: update.quizTaken ? (update.quizTotal ?? 0) : (existing?.quizTotal ?? 0),
  };

  const next = stored.filter((r) => r.date !== update.date);
  next.push(merged);
  writeStore(next);
}

/**
 * Pure aggregation over the trailing 7 days from `referenceDate` (inclusive),
 * counting **briefing days only**. Nothing is generated at the weekend, so
 * Saturday and Sunday are excluded from both the numerator and the denominator
 * -- otherwise a perfect week could never score better than 5/7.
 *
 * Exported separately so it can be unit-tested without the DOM.
 */
export function computeWeeklyStats(
  records: ActivityRecord[],
  referenceDate: Date = new Date()
): WeeklyStats {
  // Local date keys: this runs in the browser, so the window must line up with
  // the user's own calendar rather than UTC's.
  const windowKeys = new Set<string>();
  const cursor = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate()
  );
  for (let i = 0; i < 7; i += 1) {
    if (isBriefingDay(cursor)) windowKeys.add(localDateKey(cursor));
    cursor.setDate(cursor.getDate() - 1);
  }

  const briefingDays = windowKeys.size;
  const week = records.filter((r) => windowKeys.has(r.date.slice(0, 10)));

  const daysRead = week.filter((r) => r.readSeconds > 0).length;
  const quizzes = week.filter((r) => r.quizTaken);
  const quizzesSubmitted = quizzes.length;

  const totalQuestions = quizzes.reduce((sum, r) => sum + r.quizTotal, 0);
  const totalCorrect = quizzes.reduce((sum, r) => sum + r.quizScore, 0);

  const correctPct = totalQuestions === 0 ? 0 : Math.round((totalCorrect / totalQuestions) * 100);
  const wrongPct = totalQuestions === 0 ? 0 : 100 - correctPct;

  return { daysRead, briefingDays, quizzesSubmitted, correctPct, wrongPct };
}

/** Weekly stats over all current activity. */
export async function getWeeklyStats(referenceDate?: Date): Promise<WeeklyStats> {
  const records = await getActivity();
  return computeWeeklyStats(records, referenceDate);
}
