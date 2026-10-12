import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

// To prevent unauthorized triggers, require a cron secret
const CRON_SECRET = process.env.CRON_SECRET || 'creole-cron-secret-123';

const RETENTION_DAYS = 30;

/**
 * GET /api/cron/cleanup-storage
 * 
 * Auto-deletes interview media (snapshots and audio) that is older than the retention period.
 * This ensures we stay within the 1GB Supabase Free Tier limit.
 * 
 * Can be triggered via a Vercel Cron Job or any external scheduler.
 * Requires Header: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      // In local dev, we might allow it without token, but let's be strict
      if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
    const cutoffIso = cutoffDate.toISOString();

    // 1. Find all interview sessions created before the cutoff date
    const { data: oldSessions, error: sessionError } = await supabaseAdmin
      .from('interview_sessions')
      .select('id, created_at')
      .lt('created_at', cutoffIso);

    if (sessionError) {
      throw new Error(`Failed to fetch old sessions: ${sessionError.message}`);
    }

    if (!oldSessions || oldSessions.length === 0) {
      return NextResponse.json({ message: 'No old sessions to clean up.', deletedSessionsCount: 0 });
    }

    let totalDeletedSnapshots = 0;
    let totalDeletedAudio = 0;

    // 2. For each old session, list their files in both buckets and delete them
    // Supabase storage groups files by session_id/
    for (const session of oldSessions) {
      const sessionId = session.id;

      // Clean up Snapshots
      const { data: snapshotFiles } = await supabaseAdmin.storage
        .from('interview-snapshots')
        .list(sessionId, { limit: 100 });

      if (snapshotFiles && snapshotFiles.length > 0) {
        const pathsToDelete = snapshotFiles.map(file => `${sessionId}/${file.name}`);
        const { data: deleted } = await supabaseAdmin.storage
          .from('interview-snapshots')
          .remove(pathsToDelete);
        
        if (deleted) totalDeletedSnapshots += deleted.length;
      }

      // Clean up Audio
      const { data: audioFiles } = await supabaseAdmin.storage
        .from('interview-answer-audio')
        .list(sessionId, { limit: 100 });

      if (audioFiles && audioFiles.length > 0) {
        const pathsToDelete = audioFiles.map(file => `${sessionId}/${file.name}`);
        const { data: deleted } = await supabaseAdmin.storage
          .from('interview-answer-audio')
          .remove(pathsToDelete);
          
        if (deleted) totalDeletedAudio += deleted.length;
        
        // Also nullify the storage path in the DB so it doesn't show broken links
        await supabaseAdmin
          .from('interview_answers')
          .update({ audio_storage_path: null })
          .eq('session_id', sessionId)
          .not('audio_storage_path', 'is', null);
      }
    }

    return NextResponse.json({
      message: 'Cleanup successful',
      retentionDays: RETENTION_DAYS,
      cutoffDate: cutoffIso,
      sessionsProcessed: oldSessions.length,
      totalDeletedSnapshots,
      totalDeletedAudio,
    });

  } catch (error) {
    console.error('[cron/cleanup-storage] error:', error);
    return NextResponse.json({ error: 'Failed to clean up storage' }, { status: 500 });
  }
}
