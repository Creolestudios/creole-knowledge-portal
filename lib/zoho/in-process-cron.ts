/**
 * In-Process Background Cron Scheduler for Creole Knowledge Portal
 * Runs inside the Node.js standalone server on production (e.g. DigitalOcean Droplet / Docker / Any Server).
 *
 * Schedules:
 * 1. Daily Zoho Evaluation & Email Digest:
 *    - Monday to Friday morning at 08:30 IST (08:30 AM IST)
 *    - Friday night at 22:00 IST (10:00 PM IST onwards)
 * 2. Daily Zoho Task Addition / Dispatch:
 *    - Monday to Friday at 08:45 IST (08:45 AM IST)
 */

import { runDailyZohoEvaluationCron } from './cron';
import { syncQueuedPlannedTasks } from './planned-task-sync';

let isSchedulerRunning = false;
let lastEvaluationRunDate = '';
let lastMondayRunDate = '';

export interface ISTDateParts {
  hours: number;
  minutes: number;
  dayOfWeek: number;
  dateStr: string;
}

/**
 * Computes current date & time specifically in Indian Standard Time (IST / UTC+5:30)
 */
export function getISTDateParts(referenceDate = new Date()): ISTDateParts {
  const utc = referenceDate.getTime() + referenceDate.getTimezoneOffset() * 60000;
  const ist = new Date(utc + 5.5 * 3600000);
  const yyyy = ist.getFullYear();
  const mm = String(ist.getMonth() + 1).padStart(2, '0');
  const dd = String(ist.getDate()).padStart(2, '0');
  return {
    hours: ist.getHours(),
    minutes: ist.getMinutes(),
    dayOfWeek: ist.getDay(), // 0 = Sun, 1 = Mon, ..., 5 = Fri, 6 = Sat
    dateStr: `${yyyy}-${mm}-${dd}`,
  };
}

/**
 * Computes the previous workday (Monday to Friday) date string in YYYY-MM-DD
 * - If reference day is Monday, previous workday is Friday (-3 days)
 * - If reference day is Sunday, previous workday is Friday (-2 days)
 * - If reference day is Saturday, previous workday is Friday (-1 day)
 * - If reference day is Tuesday through Friday, previous workday is yesterday (-1 day)
 */
export function getPreviousWorkdayDateStr(referenceDate = new Date()): string {
  const parts = getISTDateParts(referenceDate);
  const [y, m, d] = parts.dateStr.split('-').map(Number);
  const dateObj = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const dayOfWeek = dateObj.getUTCDay();

  let daysToSubtract = 1;
  if (dayOfWeek === 1) {
    daysToSubtract = 3;
  } else if (dayOfWeek === 0) {
    daysToSubtract = 2;
  }

  const prevObj = new Date(dateObj.getTime() - daysToSubtract * 86400000);
  const py = prevObj.getUTCFullYear();
  const pm = String(prevObj.getUTCMonth() + 1).padStart(2, '0');
  const pd = String(prevObj.getUTCDate()).padStart(2, '0');
  return `${py}-${pm}-${pd}`;
}

/**
 * Checks schedule triggers and executes the appropriate cron job
 */
export async function checkAndExecuteSchedules(
  mockDateParts?: ISTDateParts
): Promise<{ ranEvaluation: boolean; ranMondayDispatch: boolean }> {
  const parts = mockDateParts || getISTDateParts();
  const { hours, minutes, dayOfWeek, dateStr } = parts;
  let ranEvaluation = false;
  let ranMondayDispatch = false;

  // 1. Morning Evaluation (Tue - Fri at 08:30 AM IST) & Friday Night Evaluation (Friday at 10:00 PM IST onwards)
  // Monday morning evaluation is skipped because Friday work is explicitly evaluated on Friday at 10:00 PM IST.
  const isMorningEvaluation = hours === 8 && minutes >= 30 && minutes <= 35 && dayOfWeek >= 2 && dayOfWeek <= 5;
  const isFridayNightEvaluation = dayOfWeek === 5 && hours === 22 && minutes >= 0 && minutes <= 5;

  if (isMorningEvaluation || isFridayNightEvaluation) {
    const runKey = isFridayNightEvaluation ? `${dateStr}_friday_10pm` : dateStr;
    if (lastEvaluationRunDate !== runKey) {
      lastEvaluationRunDate = runKey;
      ranEvaluation = true;
      const evalType = isFridayNightEvaluation ? 'Friday 10:00 PM IST' : 'daily 08:30 AM IST';
      // In the morning, evaluate the previous workday. On Friday night, evaluate today (Friday).
      const evalTargetDate = isFridayNightEvaluation
        ? dateStr
        : getPreviousWorkdayDateStr(mockDateParts ? new Date(dateStr) : new Date());
      console.log(`[InProcessCron] Triggering ${evalType} Zoho Evaluation for ${evalTargetDate}...`);
      try {
        const res = await runDailyZohoEvaluationCron({ targetDate: evalTargetDate, dryRun: false, skipNextDaySync: true });
        console.log('[InProcessCron] Daily evaluation completed successfully:', res.success);
      } catch (err) {
        console.error('[InProcessCron] Daily evaluation failed:', err);
      }
    }
  }

  // 2. Daily 8:45 AM IST Task Addition / Dispatch Cron:
  // Production schedule: Monday to Friday at 08:45 AM IST (08:45 to 08:50)
  const isMorningTaskAdditionSchedule = hours === 8 && minutes >= 45 && minutes <= 50 && dayOfWeek >= 1 && dayOfWeek <= 5;

  if (isMorningTaskAdditionSchedule) {
    if (lastMondayRunDate !== dateStr) {
      lastMondayRunDate = dateStr;
      ranMondayDispatch = true;
      console.log(`[InProcessCron] Triggering Task Addition / Dispatch for ${dateStr} (IST: ${hours}:${String(minutes).padStart(2, '0')})...`);
      try {
        const res = await syncQueuedPlannedTasks(dateStr, { dryRun: false });
        console.log('[InProcessCron] Task addition / dispatch completed successfully. Synced:', res.syncedCount);
      } catch (err) {
        console.error('[InProcessCron] Task addition / dispatch failed:', err);
      }
    }
  }

  return { ranEvaluation, ranMondayDispatch };
}

/**
 * Starts the internal 30-second checking loop in Node.js (Production only)
 */
export function startInProcessCron(): void {
  if (isSchedulerRunning) return;
  // Guard against starting in local development or unit test runs
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
    return;
  }
  isSchedulerRunning = true;

  console.log('[InProcessCron] Internal background cron scheduler started (checks every 30s in IST).');

  const timer = setInterval(() => {
    void checkAndExecuteSchedules();
  }, 30000);

  if (timer.unref) {
    timer.unref();
  }
}

/**
 * Test helper to reset internal execution trackers
 */
export function resetSchedulerState(): void {
  isSchedulerRunning = false;
  lastEvaluationRunDate = '';
  lastMondayRunDate = '';
}
