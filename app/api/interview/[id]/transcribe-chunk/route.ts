import { NextRequest, NextResponse } from 'next/server';
import { transcribeAudioChunk } from '@/lib/ai-interview/transcribe';
import { resolveInterviewSessionId } from '@/lib/ai-interview/invite-token';

export const runtime = 'nodejs';

const ALLOWED_MIME_PREFIXES = [
  'audio/webm',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/x-m4a',
  'audio/aac',
];

/**
 * POST /api/interview/[id]/transcribe-chunk
 *
 * Receives a short live microphone audio chunk (recorded from whichever mic/Bluetooth
 * device the candidate is using) and transcribes it in real time using Gemini Flash.
 *
 * This provides 100% cross-platform real-time transcription across Windows, macOS,
 * Linux, Chrome, Safari, and Bluetooth/AirPods devices without relying on browser speech APIs.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Interview ID is required.' }, { status: 400 });
    }

    const targetSessionId = (await resolveInterviewSessionId(id)) || id;
    if (!targetSessionId) {
      return NextResponse.json({ error: 'Interview session ID is required.' }, { status: 400 });
    }

    const formData = await req.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json({ error: 'Form data expected.' }, { status: 400 });
    }

    const file = formData.get('file');
    if (!(file instanceof Blob) || file.size === 0) {
      return NextResponse.json({ ok: true, text: '' });
    }

    const mimeType = (file.type || 'audio/webm').split(';')[0].trim();
    const isAllowed = ALLOWED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix));
    if (!isAllowed) {
      return NextResponse.json({ error: `Unsupported audio format: ${mimeType}` }, { status: 415 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const text = await transcribeAudioChunk(buffer, mimeType);

    return NextResponse.json({
      ok: true,
      text: (text || '').trim(),
    });
  } catch (error) {
    console.warn('[transcribe-chunk] Real-time audio chunk processing warning:', error);
    return NextResponse.json({ ok: false, text: '' }, { status: 200 });
  }
}
