import { NextRequest, NextResponse } from 'next/server';
import { getDriveClient, getDriveCredentials } from '@/lib/ai-interview/google-drive-recorder';
import { Readable } from 'stream';

export const runtime = 'nodejs';

/**
 * GET /api/interview/recording/[fileId]/stream
 *
 * Streams interview recording video from Google Drive with HTTP 206 range requests.
 * Allows native HTML5 <video> seeking and scrub to exact timestamps.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const { fileId } = await params;
  if (!fileId || fileId === 'drive_file' || fileId === 'pending_drive_file') {
    return new NextResponse('Invalid or missing fileId', { status: 400 });
  }

  const creds = getDriveCredentials();
  if (!creds) {
    return new NextResponse('Google Drive credentials not configured', { status: 503 });
  }

  try {
    const drive = getDriveClient();
    const rangeHeader = req.headers.get('range');

    const meta = await drive.files.get({
      fileId,
      fields: 'id, name, size, mimeType',
      supportsAllDrives: true,
    });

    const totalSize = Number(meta.data.size) || 0;
    const mimeType = meta.data.mimeType || 'video/webm';

    if (rangeHeader && totalSize > 0) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;
        const chunkSize = Math.max(0, end - start + 1);

        const driveRes = await drive.files.get(
          { fileId, alt: 'media', supportsAllDrives: true },
          {
            responseType: 'stream',
            headers: { Range: `bytes=${start}-${end}` },
          }
        );

        const nodeStream = driveRes.data as unknown as Readable;
        const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

        return new NextResponse(webStream, {
          status: 206,
          headers: {
            'Content-Type': mimeType,
            'Content-Range': `bytes ${start}-${end}/${totalSize}`,
            'Content-Length': String(chunkSize),
            'Accept-Ranges': 'bytes',
          },
        });
      }
    }

    const driveRes = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream' }
    );

    const nodeStream = driveRes.data as unknown as Readable;
    const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

    const headers: Record<string, string> = {
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
    };
    if (totalSize > 0) {
      headers['Content-Length'] = String(totalSize);
    }

    return new NextResponse(webStream, {
      status: 200,
      headers,
    });
  } catch (err: unknown) {
    console.error(`[drive-stream] Error streaming file ${fileId}:`, err);
    return new NextResponse('Failed to stream video', { status: 500 });
  }
}
