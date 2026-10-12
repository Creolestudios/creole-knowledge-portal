import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolveInterviewSessionId } from '@/lib/ai-interview/invite-token';
import {
  uploadDriveResumableChunk,
  createDriveResumableUploadSession,
  finalizeDriveFile,
  getDriveCredentials,
} from '@/lib/ai-interview/google-drive-recorder';

export const runtime = 'nodejs';

/**
 * POST /api/interview/recording/stream-chunk
 *
 * Streams live video recording slices directly into a Google Drive Resumable Upload session.
 * - During the interview: Receives ~256KiB-512KiB slices every few seconds and appends them to Google Drive (HTTP 308).
 * - On interview completion / termination: Receives the final slice, marks isFinal: true,
 *   seals the file in Google Drive, applies permissions, and writes metadata to interview_events.
 *
 * This enables near-instant (< 1s) video persistence at interview finish.
 */
export async function POST(req: Request) {
  try {
    const creds = getDriveCredentials();
    if (!creds) {
      return NextResponse.json(
        { ok: false, notConfigured: true, message: 'Google Drive credentials not configured' },
        { status: 200 }
      );
    }

    const contentType = req.headers.get('content-type') || '';
    let interviewId = req.headers.get('x-interview-id') || '';
    let uploadUrl = req.headers.get('x-upload-url') || '';
    let startByte = Number(req.headers.get('x-start-byte') || '0');
    let isFinal = req.headers.get('x-is-final') === 'true';
    let mimeType = req.headers.get('x-mime-type') || 'video/webm';
    let durationSeconds = req.headers.get('x-duration-seconds') ? Number(req.headers.get('x-duration-seconds')) : undefined;
    let recordingStartTime = req.headers.get('x-recording-start-time') ? Number(req.headers.get('x-recording-start-time')) : undefined;
    let buffer: Buffer | null = null;

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      interviewId = (formData.get('interviewId') as string) || interviewId;
      uploadUrl = (formData.get('uploadUrl') as string) || uploadUrl;
      const rawStart = formData.get('startByte');
      if (rawStart) startByte = Number(rawStart);
      const rawFinal = formData.get('isFinal');
      if (rawFinal !== null) isFinal = rawFinal === 'true' || rawFinal === '1';
      const rawMime = formData.get('mimeType');
      if (rawMime) mimeType = String(rawMime);
      const rawDur = formData.get('durationSeconds');
      if (rawDur) durationSeconds = Number(rawDur);
      const rawStartTs = formData.get('recordingStartTime');
      if (rawStartTs) recordingStartTime = Number(rawStartTs);

      const chunkFile = formData.get('chunk') as File | null;
      if (chunkFile) {
        const ab = await chunkFile.arrayBuffer();
        buffer = Buffer.from(ab);
      }
    } else {
      const arrayBuffer = await req.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    }

    if (!interviewId) {
      return NextResponse.json({ error: 'x-interview-id or interviewId is required' }, { status: 400 });
    }

    buffer = buffer || Buffer.alloc(0);

    const targetSessionId = (await resolveInterviewSessionId(interviewId)) || interviewId;

    // If an uploadUrl was not provided or active, initiate a Google Drive Resumable Upload session
    if (!uploadUrl) {
      const { data: session } = await supabaseAdmin
        .from('interview_sessions')
        .select('id, candidate_name')
        .eq('id', targetSessionId)
        .maybeSingle();

      const candidateName = session?.candidate_name || 'candidate';
      const created = await createDriveResumableUploadSession({
        interviewId: targetSessionId,
        candidateName,
        mimeType,
      });
      uploadUrl = created.uploadUrl;
    }

    // Append chunk to Google Drive
    const driveRes = await uploadDriveResumableChunk({
      uploadUrl,
      buffer,
      startByte: Number.isFinite(startByte) ? startByte : 0,
      isFinal,
      mimeType,
    });

    if (driveRes.isComplete && driveRes.fileId) {
      let webViewLink = `https://drive.google.com/file/d/${driveRes.fileId}/view`;
      let previewUrl = `https://drive.google.com/file/d/${driveRes.fileId}/preview`;
      let webContentLink: string | undefined;

      try {
        const driveData = await finalizeDriveFile(driveRes.fileId);
        webViewLink = driveData.webViewLink;
        previewUrl = driveData.previewUrl;
        webContentLink = driveData.webContentLink;
      } catch (finalizeErr) {
        console.warn(`[stream-chunk] finalizeDriveFile warning for ${driveRes.fileId}:`, finalizeErr);
      }

      const nowIso = new Date().toISOString();
      const metaPayload = {
        fileId: driveRes.fileId,
        fileName: `interview_recording_${targetSessionId}.webm`,
        webViewLink,
        previewUrl,
        webContentLink,
        durationSeconds,
        recordingStartTime,
        uploadedAt: nowIso,
        method: 'resumable_streaming',
      };

      // Store recording in interview_events
      await supabaseAdmin.from('interview_events').insert({
        session_id: targetSessionId,
        event_type: 'full_recording',
        category: 'full_recording',
        severity: 'info',
        ts_ms: Date.now(),
        meta: metaPayload,
        metadata: metaPayload,
      });

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
      } catch (broadcastErr) {
        console.warn('[stream-chunk] Realtime broadcast error:', broadcastErr);
      }

      return NextResponse.json({
        ok: true,
        isComplete: true,
        fileId: driveRes.fileId,
        webViewLink,
        previewUrl,
        uploadUrl,
      });
    }

    if (driveRes.status === 308) {
      return NextResponse.json({
        ok: true,
        isComplete: false,
        uploadUrl,
        nextByte: startByte + buffer.length,
        range: driveRes.range,
      });
    }

    return NextResponse.json(
      {
        ok: false,
        error: driveRes.error || `Drive returned HTTP ${driveRes.status}`,
        status: driveRes.status,
      },
      { status: 502 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[stream-chunk] Handler error:', message);
    return NextResponse.json(
      { error: 'Failed to process stream chunk', details: message },
      { status: 500 }
    );
  }
}
