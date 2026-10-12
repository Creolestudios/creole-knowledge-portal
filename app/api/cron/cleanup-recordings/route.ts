import { NextResponse } from 'next/server';
import { dispatchRecordingRetentionCleanup } from '@/lib/ai-interview/recording-retention-dispatcher';

export const runtime = 'nodejs';

const CRON_SECRET = process.env.CRON_SECRET || 'creole-cron-secret-123';

/**
 * GET /api/cron/cleanup-recordings
 *
 * Automated dispatcher endpoint to purge Google Drive interview video recordings
 * older than the retention policy (default: 90 days).
 *
 * Query Parameters:
 * - days: retention window in days (default: 90)
 * - dryRun: if 'true', previews files to delete without modifying Drive or DB
 *
 * Authentication:
 * - Requires Header: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const { searchParams } = new URL(req.url);
    const daysParam = searchParams.get('days');
    const dryRunParam = searchParams.get('dryRun');

    const retentionDays = daysParam ? parseInt(daysParam, 10) : 90;
    const dryRun = dryRunParam === 'true' || dryRunParam === '1';

    const result = await dispatchRecordingRetentionCleanup({
      retentionDays: Number.isNaN(retentionDays) ? 90 : retentionDays,
      dryRun,
    });

    return NextResponse.json({
      success: true,
      message: dryRun
        ? `Dry run complete. Found ${result.totalFound} recording(s) eligible for 90-day purge.`
        : `Retention dispatcher completed. Purged ${result.deletedCount} recording(s) from Google Drive.`,
      data: result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[cron/cleanup-recordings] Error executing video retention dispatcher:', err);
    return NextResponse.json(
      { error: 'Failed to execute video retention dispatcher', details: message },
      { status: 500 }
    );
  }
}
