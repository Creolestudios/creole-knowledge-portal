import { NextResponse } from 'next/server';
import { runDailyZohoEvaluationCron } from '@/lib/zoho/cron';
import { requireAdminUser } from '@/lib/supabase/admin';

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
 * Handles the daily 10:00 PM IST Zoho Evaluation Cron Trigger
 *
 * GET /api/cron/zoho-evaluation
 * POST /api/cron/zoho-evaluation
 *
 * Query Parameters:
 * - date: Optional target date in YYYY-MM-DD format (defaults to current date in IST/UTC)
 * - dryRun: Optional 'true' to execute scan and evaluation without DB modifications
 *
 * Headers:
 * - Authorization: Bearer <CRON_SECRET>
 */
async function handleCronExecution(req: Request) {
  try {
    const authorized = await isAuthorized(req);
    if (!authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get('date') || undefined;
    const dryRunParam = searchParams.get('dryRun');
    const dryRun = dryRunParam === 'true' || dryRunParam === '1';
    const allowWeekendParam = searchParams.get('allowWeekend');
    const allowWeekend = allowWeekendParam === 'true' || allowWeekendParam === '1';

    const result = await runDailyZohoEvaluationCron({
      targetDate: dateParam,
      dryRun,
      allowWeekend,
    });

    if (result.skipped) {
      return NextResponse.json({
        success: true,
        skipped: true,
        message: result.skipReason || 'Skipped: evaluations and emails run Monday to Friday only.',
        date: result.date,
        dryRun: result.dryRun,
      });
    }

    if (!result.success && result.error) {
      return NextResponse.json(
        {
          error: result.error,
          date: result.date,
          dryRun: result.dryRun,
          durationMs: result.durationMs,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Daily Zoho evaluation completed successfully for ${result.date}. Evaluated ${result.tasksEvaluated} tasks across ${result.usersEvaluated} users. Sent ${result.emailsSent} evaluation emails.`,
      date: result.date,
      dryRun: result.dryRun,
      usersEvaluated: result.usersEvaluated,
      tasksEvaluated: result.tasksEvaluated,
      commentsIngested: result.commentsIngested,
      evaluationsCreated: result.evaluationsCreated,
      emailsSent: result.emailsSent,
      emailsFailed: result.emailsFailed,
      durationMs: result.durationMs,
      details: result.details,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cron/zoho-evaluation] Error executing daily evaluation cron:', err);
    return NextResponse.json(
      { error: 'Failed to execute daily Zoho evaluation cron', details: message },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  return handleCronExecution(req);
}

export async function POST(req: Request) {
  return handleCronExecution(req);
}
