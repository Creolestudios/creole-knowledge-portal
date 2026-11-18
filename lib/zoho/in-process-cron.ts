/**
 * In-Process Background Cron Scheduler for Creole Knowledge Portal
 * Runs inside the Node.js standalone server on production (e.g. DigitalOcean Droplet / Docker / Any Server).
 *
 * Schedules:
 * 1. Daily Zoho Evaluation & Next-Day Task Creation:
 *    - Monday to Friday at 22:00 IST (10:00 PM IST)
 * 2. Weekly Monday Task Dispatch:
 *    - Monday at 09:00 IST (09:00 AM IST)
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
 * Checks schedule triggers and executes the appropriate cron job
 */
export async function checkAndExecuteSchedules(
  mockDateParts?: ISTDateParts
): Promise<{ ranEvaluation: boolean; ranMondayDispatch: boolean }> {
  const parts = mockDateParts || getISTDateParts();
  const { hours, minutes, dayOfWeek, dateStr } = parts;
  let ranEvaluation = false;
  let ranMondayDispatch = false;

  // 1. Daily 10:00 PM IST (22:00) Cron: Mon - Fri (dayOfWeek 1 to 5)
  // Window: 22:00 to 22:05 to ensure execution even if thread was momentarily busy
  if (hours === 22 && minutes >= 0 && minutes <= 5 && dayOfWeek >= 1 && dayOfWeek <= 5) {
    if (lastEvaluationRunDate !== dateStr) {
      lastEvaluationRunDate = dateStr;
      ranEvaluation = true;
      console.log(`[InProcessCron] Triggering daily 10:00 PM IST Zoho Evaluation & Task Sync for ${dateStr}...`);
      try {
        const res = await runDailyZohoEvaluationCron({ targetDate: dateStr, dryRun: false });
        console.log('[InProcessCron] Daily evaluation completed successfully:', res.success);
      } catch (err) {
        console.error('[InProcessCron] Daily evaluation failed:', err);
      }
    }
  }

  // 2. Task Dispatch Cron:
  // Real production schedule: Monday at 09:00 AM IST (09:00 to 09:05)
  // Testing schedule: 6:30 PM IST (18:30 to 18:45)
  const isMondayRealSchedule = hours === 9 && minutes >= 0 && minutes <= 5 && dayOfWeek === 1;
  const isTestingSchedule = hours === 18 && minutes >= 30 && minutes <= 45;

  if (isMondayRealSchedule || isTestingSchedule) {
    if (lastMondayRunDate !== dateStr) {
      lastMondayRunDate = dateStr;
      ranMondayDispatch = true;
      console.log(`[InProcessCron] Triggering Task Dispatch for ${dateStr} (IST: ${hours}:${String(minutes).padStart(2, '0')})...`);
      try {
        const res = await syncQueuedPlannedTasks(dateStr, { dryRun: false });
        console.log('[InProcessCron] Task dispatch completed successfully. Synced:', res.syncedCount);
      } catch (err) {
        console.error('[InProcessCron] Task dispatch failed:', err);
      }
    }
  }

  return { ranEvaluation, ranMondayDispatch };
}

/**
 * Starts the internal 30-second checking loop in Node.js
 */
export function startInProcessCron(): void {
  if (isSchedulerRunning) return;
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
