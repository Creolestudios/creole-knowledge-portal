import { supabaseAdmin } from '@/lib/supabase/admin';
import { deleteDriveFile } from './google-drive-recorder';

export interface DispatcherOptions {
  retentionDays?: number;
  dryRun?: boolean;
}

export interface PurgedItemResult {
  eventId: string;
  sessionId: string;
  fileId: string;
  status: 'purged' | 'already_purged' | 'failed' | 'would_purge';
  error?: string;
}

export interface DispatcherResult {
  retentionDays: number;
  cutoffDate: string;
  totalFound: number;
  deletedCount: number;
  alreadyDeletedCount: number;
  failedCount: number;
  dryRun: boolean;
  items: PurgedItemResult[];
}

/**
 * 90-Day Video Retention Dispatcher
 *
 * Scans for interview video recordings older than the retention threshold (default 90 days),
 * deletes the files from Google Drive, and updates the database records to 'purged'.
 */
export async function dispatchRecordingRetentionCleanup(
  options: DispatcherOptions = {}
): Promise<DispatcherResult> {
  const retentionDays = Number.isFinite(options.retentionDays) && (options.retentionDays as number) > 0
    ? (options.retentionDays as number)
    : 90;
  const dryRun = Boolean(options.dryRun);

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  const cutoffTs = cutoffDate.getTime();
  const cutoffIso = cutoffDate.toISOString();

  // Query all recording events in the database created before the cutoff
  const { data: events, error } = await supabaseAdmin
    .from('interview_events')
    .select('id, session_id, ts_ms, meta, metadata, created_at')
    .eq('event_type', 'full_recording')
    .lt('ts_ms', cutoffTs);

  if (error) {
    throw new Error(`[retention-dispatcher] Failed to query expired recordings: ${error.message}`);
  }

  const recordingEvents = events || [];
  const results: PurgedItemResult[] = [];
  let deletedCount = 0;
  let alreadyDeletedCount = 0;
  let failedCount = 0;

  for (const event of recordingEvents) {
    const meta = ((event.meta || event.metadata || {}) as Record<string, unknown>);
    const fileId = (meta.fileId as string) || '';
    const currentStatus = meta.status as string | undefined;

    // Skip if already marked purged
    if (currentStatus === 'purged') {
      continue;
    }

    if (!fileId) {
      continue;
    }

    if (dryRun) {
      results.push({
        eventId: event.id,
        sessionId: event.session_id,
        fileId,
        status: 'would_purge',
      });
      deletedCount++;
      continue;
    }

    // Call Google Drive to delete the file
    const deleteResult = await deleteDriveFile(fileId);

    if (deleteResult.success) {
      if (deleteResult.alreadyDeleted) {
        alreadyDeletedCount++;
      } else {
        deletedCount++;
      }

      // Update database audit record
      const nowIso = new Date().toISOString();
      const updatedMeta = {
        ...meta,
        status: 'purged',
        purged_at: nowIso,
        retention_days: retentionDays,
        retention_cutoff: cutoffIso,
      };

      await supabaseAdmin
        .from('interview_events')
        .update({
          meta: updatedMeta,
          metadata: updatedMeta,
        })
        .eq('id', event.id);

      results.push({
        eventId: event.id,
        sessionId: event.session_id,
        fileId,
        status: deleteResult.alreadyDeleted ? 'already_purged' : 'purged',
      });
    } else {
      failedCount++;
      results.push({
        eventId: event.id,
        sessionId: event.session_id,
        fileId,
        status: 'failed',
        error: deleteResult.error,
      });
    }
  }

  return {
    retentionDays,
    cutoffDate: cutoffIso,
    totalFound: results.length,
    deletedCount,
    alreadyDeletedCount,
    failedCount,
    dryRun,
    items: results,
  };
}
