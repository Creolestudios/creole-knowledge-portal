import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getISTDateParts,
  checkAndExecuteSchedules,
  resetSchedulerState,
} from './in-process-cron';

// Mock cron functions
vi.mock('./cron', () => ({
  runDailyZohoEvaluationCron: vi.fn().mockResolvedValue({
    success: true,
    date: '2026-11-18',
    usersEvaluated: 1,
  }),
}));

vi.mock('./planned-task-sync', () => ({
  syncQueuedPlannedTasks: vi.fn().mockResolvedValue({
    totalQueued: 1,
    syncedCount: 1,
    failedCount: 0,
    skippedCount: 0,
    details: [],
  }),
}));

describe('In-Process Zoho Cron Scheduler (Internal Node.js Engine)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSchedulerState();
  });

  it('correctly computes IST date parts with 5.5 hour offset', () => {
    // 2026-11-18 16:30 UTC -> 2026-11-18 22:00 IST
    const utcDate = new Date('2026-11-18T16:30:00.000Z');
    const ist = getISTDateParts(utcDate);

    expect(ist.hours).toBe(22);
    expect(ist.minutes).toBe(0);
    expect(ist.dateStr).toBe('2026-11-18');
  });

  it('triggers 8:30 AM IST daily evaluation on weekdays (Monday - Friday)', async () => {
    const { runDailyZohoEvaluationCron } = await import('./cron');

    // Wednesday (dayOfWeek 3) at 08:32 IST -> evaluates previous workday Tuesday (2026-11-17)
    const wednesdayIST = {
      hours: 8,
      minutes: 32,
      dayOfWeek: 3,
      dateStr: '2026-11-18',
    };

    const res = await checkAndExecuteSchedules(wednesdayIST);
    expect(res.ranEvaluation).toBe(true);
    expect(runDailyZohoEvaluationCron).toHaveBeenCalledWith({
      targetDate: '2026-11-17',
      dryRun: false,
      skipNextDaySync: true,
    });
  });

  it('prevents duplicate evaluation runs on the same date', async () => {
    const { runDailyZohoEvaluationCron } = await import('./cron');

    const wednesdayIST = {
      hours: 8,
      minutes: 32,
      dayOfWeek: 3,
      dateStr: '2026-11-18',
    };

    // First trigger
    await checkAndExecuteSchedules(wednesdayIST);
    expect(runDailyZohoEvaluationCron).toHaveBeenCalledTimes(1);

    // Second trigger 30s later (at 08:32:30)
    const secondCall = await checkAndExecuteSchedules(wednesdayIST);
    expect(secondCall.ranEvaluation).toBe(false);
    expect(runDailyZohoEvaluationCron).toHaveBeenCalledTimes(1);
  });

  it('triggers Friday night evaluation at 10:00 PM IST (22:00) for Friday tasks', async () => {
    const { runDailyZohoEvaluationCron } = await import('./cron');

    // Friday (dayOfWeek 5) at 22:01 IST
    const fridayNightIST = {
      hours: 22,
      minutes: 1,
      dayOfWeek: 5,
      dateStr: '2026-11-20',
    };

    const res = await checkAndExecuteSchedules(fridayNightIST);
    expect(res.ranEvaluation).toBe(true);
    expect(runDailyZohoEvaluationCron).toHaveBeenCalledWith({
      targetDate: '2026-11-20',
      dryRun: false,
      skipNextDaySync: true,
    });
  });

  it('does NOT trigger morning evaluation on Monday at 8:30 AM (Friday was already evaluated on Friday night)', async () => {
    const { runDailyZohoEvaluationCron } = await import('./cron');

    // Monday (dayOfWeek 1) at 08:32 IST
    const mondayMorningIST = {
      hours: 8,
      minutes: 32,
      dayOfWeek: 1,
      dateStr: '2026-11-23',
    };

    const res = await checkAndExecuteSchedules(mondayMorningIST);
    expect(res.ranEvaluation).toBe(false);
    expect(runDailyZohoEvaluationCron).not.toHaveBeenCalled();
  });

  it('triggers 8:45 AM IST task dispatch on weekdays', async () => {
    const { syncQueuedPlannedTasks } = await import('./planned-task-sync');

    // Monday (dayOfWeek 1) at 08:46 IST
    const mondayIST = {
      hours: 8,
      minutes: 46,
      dayOfWeek: 1,
      dateStr: '2026-11-23',
    };

    const res = await checkAndExecuteSchedules(mondayIST);
    expect(res.ranMondayDispatch).toBe(true);
    expect(syncQueuedPlannedTasks).toHaveBeenCalledWith('2026-11-23', { dryRun: false });
  });

  it('does NOT trigger task dispatch at old testing times like 6:30 PM IST in production', async () => {
    const { syncQueuedPlannedTasks } = await import('./planned-task-sync');

    // Wednesday at 18:30 IST
    const testIST = {
      hours: 18,
      minutes: 30,
      dayOfWeek: 3,
      dateStr: '2026-11-18',
    };

    const res = await checkAndExecuteSchedules(testIST);
    expect(res.ranMondayDispatch).toBe(false);
    expect(syncQueuedPlannedTasks).not.toHaveBeenCalled();
  });

  it('does NOT trigger when outside the scheduled time windows', async () => {
    const { runDailyZohoEvaluationCron } = await import('./cron');
    const { syncQueuedPlannedTasks } = await import('./planned-task-sync');

    // 14:30 IST on Wednesday (normal workday afternoon)
    const afternoonIST = {
      hours: 14,
      minutes: 30,
      dayOfWeek: 3,
      dateStr: '2026-11-18',
    };

    const res = await checkAndExecuteSchedules(afternoonIST);
    expect(res.ranEvaluation).toBe(false);
    expect(res.ranMondayDispatch).toBe(false);
    expect(runDailyZohoEvaluationCron).not.toHaveBeenCalled();
    expect(syncQueuedPlannedTasks).not.toHaveBeenCalled();
  });
});
