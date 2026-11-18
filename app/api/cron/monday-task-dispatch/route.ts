import { NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/supabase/admin';
import { syncQueuedPlannedTasks } from '@/lib/zoho/planned-task-sync';
import { formatDateYYYYMMDD } from '@/lib/zoho/service';

export const runtime = 'nodejs';

const CRON_SECRET = process.env.CRON_SECRET || 'creole-cron-secret-123';

/**
 * Validates request authorization against CRON_SECRET or an active Admin session
 */
async function isAuthorized(req: Request): Promise<boolean> {
  const authHeader = req.headers.get('authorization');
  if (authHeader === `Bearer ${CRON_SECRET}`) {
    return true;
  }

  // Allow active logged-in Admin session or local development override
  if (process.env.NODE_ENV === 'development') {
    return true;
  }

  const adminCheck = await requireAdminUser();
  return Boolean(adminCheck);
}

/**
 * Handles the Weekly Monday 9:00 AM IST Cron Trigger
 * Schedule: 09:00 AM IST (03:30 UTC -> "30 3 * * 1")
 *
 * GET /api/cron/monday-task-dispatch
 * POST /api/cron/monday-task-dispatch
 *
 * What it does:
 * 1. Identifies the Admin-created weekly parent task ('W{WeekNumber}-...') in Zoho Projects.
 * 2. Fetches developer tasks planned on Friday for Monday from public.zoho_tasks.
 * 3. Ingests them as Level 3 work tasks in Zoho under the matching Level 2 user bucket ('srushti 10' or fallback 'others 20').
 * 4. Updates public.zoho_tasks with zoho_task_id, link, and sync_status = 'synced'.
 */
async function handleMondayDispatch(req: Request) {
  try {
    const authorized = await isAuthorized(req);
    if (!authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get('date') || formatDateYYYYMMDD(new Date());
    const dryRunParam = searchParams.get('dryRun');
    const dryRun = dryRunParam === 'true' || dryRunParam === '1';

    console.log(`[cron/monday-task-dispatch] Executing Monday 9:00 AM dispatch for target date ${dateParam} (dryRun: ${dryRun})`);

    const result = await syncQueuedPlannedTasks(dateParam, { dryRun });

    return NextResponse.json({
      success: true,
      message: `Monday task dispatch completed for ${dateParam}. Total queued: ${result.totalQueued}, Synced: ${result.syncedCount}, Failed: ${result.failedCount}`,
      date: dateParam,
      dryRun,
      totalQueued: result.totalQueued,
      syncedCount: result.syncedCount,
      failedCount: result.failedCount,
      details: result.details,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cron/monday-task-dispatch] Error executing Monday dispatch:', err);
    return NextResponse.json(
      { error: 'Failed to execute Monday task dispatch cron', details: message },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  return handleMondayDispatch(req);
}

export async function POST(req: Request) {
  return handleMondayDispatch(req);
}

