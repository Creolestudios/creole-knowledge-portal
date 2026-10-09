import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolveInterviewSessionId } from '@/lib/ai-interview/invite-token';
import { finalizeDriveFile, getDriveCredentials } from '@/lib/ai-interview/google-drive-recorder';

export const runtime = 'nodejs';

/**
 * POST /api/interview/recording/complete
 *
 * Called once the browser has successfully uploaded the whole video directly to Google Drive.
 * 1. Sets Google Drive permissions (viewable with link) and retrieves preview/view links.
 * 2. Saves recording metadata into the existing `interview_events` table (no schema migration needed).
 * 3. Broadcasts realtime notification to HR monitoring channel.
 *
 * Body: { interviewId: string, fileId: string, fileName?: string }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const interviewId = body?.interviewId as string | undefined;
    const fileId = body?.fileId as string | undefined;
    const fileName = body?.fileName as string | undefined;
    const durationSeconds = typeof body?.durationSeconds === 'number' ? body.durationSeconds : undefined;
    const recordingStartTime = typeof body?.recordingStartTime === 'number' ? body.recordingStartTime : undefined;

    if (!interviewId || !fileId) {
      return NextResponse.json({ error: 'interviewId and fileId are required' }, { status: 400 });
    }

    const targetSessionId = (await resolveInterviewSessionId(interviewId)) || interviewId;

    let webViewLink = `https://drive.google.com/file/d/${fileId}/view`;
    let previewUrl = `https://drive.google.com/file/d/${fileId}/preview`;
    let webContentLink: string | undefined;

    const creds = getDriveCredentials();
    if (creds) {
      try {
        const driveData = await finalizeDriveFile(fileId);
        webViewLink = driveData.webViewLink;
        previewUrl = driveData.previewUrl;
        webContentLink = driveData.webContentLink;
      } catch (err) {
        console.warn(`[interview-recording-complete] finalizeDriveFile error for ${fileId}:`, err);
      }
    }

    const nowIso = new Date().toISOString();
    const metaPayload = {
      fileId,
      fileName: fileName || `interview_recording_${targetSessionId}.webm`,
      webViewLink,
      previewUrl,
      webContentLink,
      durationSeconds,
      recordingStartTime,
      uploadedAt: nowIso,
    };

    // Store in interview_events without modifying Supabase schema
    const { error: insertError } = await supabaseAdmin.from('interview_events').insert({
      session_id: targetSessionId,
      event_type: 'full_recording',
      category: 'full_recording',
      severity: 'info',
      ts_ms: Date.now(),
      meta: metaPayload,
      metadata: metaPayload,
    });

    if (insertError) {
      console.error('[interview-recording-complete] Failed to record event in DB:', insertError);
    }

    // Broadcast to HR real-time channel
    try {
      const channel = supabaseAdmin.channel(`interview-monitor:${targetSessionId}`);
      await channel.subscribe();
      await channel.send({
        type: 'broadcast',
        event: 'proctoring_event',
        payload: {
          category: 'full_recording',
          severity: 'info',
          meta: metaPayload,
          ts_ms: Date.now(),
        },
      });
      await channel.unsubscribe();
    } catch (realtimeErr) {
      console.warn('[interview-recording-complete] Realtime broadcast error:', realtimeErr);
    }

    return NextResponse.json({
      ok: true,
      fileId,
      webViewLink,
      previewUrl,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[interview-recording-complete] Handler error:', message);
    return NextResponse.json(
      { error: 'Failed to complete recording processing', details: message },
      { status: 500 }
    );
  }
}
