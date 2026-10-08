import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolveInterviewSessionId } from '@/lib/ai-interview/invite-token';
import {
  uploadDriveFileDirectly,
  getDriveCredentials,
} from '@/lib/ai-interview/google-drive-recorder';

export const runtime = 'nodejs';

/**
 * POST /api/interview/recording/upload
 *
 * Reliable server-side fallback upload endpoint.
 * When a browser on a secondary device encounters CORS or network errors
 * with direct Google Drive PUT, it posts the video file here.
 * This endpoint streams the file to Google Drive using the backend service account.
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
    let interviewId = '';
    let buffer: Buffer | null = null;
    let mimeType = 'video/webm';
    let requestedFileName: string | undefined;

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      interviewId = (formData.get('interviewId') as string) || '';
      const file = formData.get('file') as File | null;
      if (!file) {
        return NextResponse.json({ error: 'file is required in formData' }, { status: 400 });
      }
      mimeType = file.type || 'video/webm';
      requestedFileName = file.name;
      const arrayBuffer = await file.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } else {
      const url = new URL(req.url);
      interviewId = url.searchParams.get('interviewId') || '';
      mimeType = req.headers.get('x-mime-type') || 'video/webm';
      const arrayBuffer = await req.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    }

    if (!interviewId) {
      return NextResponse.json({ error: 'interviewId is required' }, { status: 400 });
    }

    if (!buffer || buffer.length === 0) {
      return NextResponse.json({ error: 'empty video buffer' }, { status: 400 });
    }

    const targetSessionId = (await resolveInterviewSessionId(interviewId)) || interviewId;

    const { data: session } = await supabaseAdmin
      .from('interview_sessions')
      .select('id, candidate_name')
      .eq('id', targetSessionId)
      .maybeSingle();

    const candidateName = session?.candidate_name || 'candidate';

    const uploadResult = await uploadDriveFileDirectly({
      interviewId: targetSessionId,
      candidateName,
      mimeType,
      buffer,
    });

    const nowIso = new Date().toISOString();
    const metaPayload = {
      fileId: uploadResult.fileId,
      fileName: requestedFileName || uploadResult.fileName,
      webViewLink: uploadResult.webViewLink,
      previewUrl: uploadResult.previewUrl,
      uploadedAt: nowIso,
    };

    // Store in interview_events
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
    } catch {
      // Realtime broadcast is non-critical
    }

    return NextResponse.json({
      ok: true,
      fileId: uploadResult.fileId,
      webViewLink: uploadResult.webViewLink,
      previewUrl: uploadResult.previewUrl,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[recording-fallback-upload] Error:', message);
    return NextResponse.json(
      { error: 'Failed to upload video to Google Drive', details: message },
      { status: 500 }
    );
  }
}
