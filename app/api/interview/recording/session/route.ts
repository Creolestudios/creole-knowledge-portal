import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolveInterviewSessionId } from '@/lib/ai-interview/invite-token';
import {
  createDriveResumableUploadSession,
  getDriveCredentials,
} from '@/lib/ai-interview/google-drive-recorder';

export const runtime = 'nodejs';

/**
 * POST /api/interview/recording/session
 *
 * Initiates a Google Drive Resumable Upload session for the candidate's interview video.
 * Returns the direct Google Drive uploadUrl so the candidate's browser can stream/upload
 * the whole video directly to Google Drive, completely bypassing serverless payload limits.
 *
 * Body: { interviewId: string, fileSize?: number, mimeType?: string }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const interviewId = body?.interviewId as string | undefined;
    const fileSize = typeof body?.fileSize === 'number' ? body.fileSize : undefined;
    const mimeType = (body?.mimeType as string) || 'video/webm';

    if (!interviewId) {
      return NextResponse.json({ error: 'interviewId is required' }, { status: 400 });
    }

    const creds = getDriveCredentials();
    if (!creds) {
      return NextResponse.json(
        {
          ok: false,
          notConfigured: true,
          message: 'Google Drive credentials are not configured in environment variables.',
        },
        { status: 200 }
      );
    }

    const targetSessionId = (await resolveInterviewSessionId(interviewId)) || interviewId;

    // Fetch candidate name for clean file naming
    const { data: session } = await supabaseAdmin
      .from('interview_sessions')
      .select('id, candidate_name')
      .eq('id', targetSessionId)
      .maybeSingle();

    const candidateName = session?.candidate_name || 'candidate';

    const origin = req.headers.get('origin') || (body?.origin as string | undefined) || undefined;

    const { uploadUrl, fileName } = await createDriveResumableUploadSession({
      interviewId: targetSessionId,
      candidateName,
      fileSize,
      mimeType,
      origin,
    });

    return NextResponse.json({
      ok: true,
      uploadUrl,
      fileName,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[interview-recording-session] Failed to create session:', message);
    return NextResponse.json(
      { error: 'Failed to initiate Google Drive recording session', details: message },
      { status: 500 }
    );
  }
}
