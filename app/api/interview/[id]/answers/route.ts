import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser, supabaseAdmin } from '@/lib/supabase/admin';
import { transcribeAnswer } from '@/lib/ai-interview/transcribe';

export const runtime = 'nodejs';

const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
};

/**
 * POST /api/interview/[id]/answers
 *
 * Receives one recorded spoken answer from the candidate, stores the audio in the private
 * `interview-answer-audio` bucket, converts it to text, and saves both against the question
 * in `interview_answers`. Scoring runs later as its own pass — this route only collects.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (req.cookies.get('interview_verified_id')?.value !== id) {
      const adminUser = await requireAdminUser().catch(() => null);
      if (!adminUser) {
        return NextResponse.json({ error: 'Interview verification is required.' }, { status: 401 });
      }
    }

    const contentType = req.headers.get('content-type') || '';
    let questionId: string | undefined;
    let transcript: string | null = null;
    let storagePath: string | null = null;
    let durationSec = 0;
    let audioFile: Blob | null = null;

    if (contentType.includes('application/json')) {
      const body = await req.json().catch(() => null);
      questionId = (body?.questionId || body?.question_id) as string | undefined;
      transcript = typeof body?.transcript === 'string' ? body.transcript : '';
      durationSec = Number(body?.total_time_taken_sec) || 0;
    } else {
      const formData = await req.formData();
      questionId = formData.get('questionId') as string | undefined;
      const file = formData.get('file');
      if (file instanceof Blob && file.size > 0) {
        audioFile = file;
      } else if (!formData.has('transcript')) {
        return NextResponse.json({ error: 'questionId and an audio file are required.' }, { status: 400 });
      } else {
        transcript = (formData.get('transcript') as string) || '';
      }

      const startedAtMs = Number(formData.get('startedAtMs'));
      const endedAtMs = Number(formData.get('endedAtMs'));
      durationSec =
        Number.isFinite(startedAtMs) && Number.isFinite(endedAtMs) && endedAtMs > startedAtMs
          ? (endedAtMs - startedAtMs) / 1000
          : 0;
    }

    if (typeof questionId !== 'string' || !questionId) {
      return NextResponse.json({ error: 'questionId and an audio file are required.' }, { status: 400 });
    }

    const { data: question, error: questionError } = await supabaseAdmin
      .from('interview_questions')
      .select('id')
      .eq('id', questionId)
      .eq('session_id', id)
      .single();

    if (questionError || !question) {
      return NextResponse.json({ error: 'Question does not belong to this interview.' }, { status: 404 });
    }

    if (audioFile) {
      // MediaRecorder reports types like "audio/webm;codecs=opus" — the bucket allows the base type.
      const mimeType = audioFile.type.split(';')[0].trim();
      const extension = AUDIO_EXTENSIONS[mimeType];
      if (!extension) {
        return NextResponse.json({ error: `Unsupported audio format: ${mimeType || 'unknown'}` }, { status: 415 });
      }

      const buffer = Buffer.from(await audioFile.arrayBuffer());
      storagePath = `${id}/${questionId}.${extension}`;

      const { error: uploadError } = await supabaseAdmin.storage
        .from('interview-answer-audio')
        .upload(storagePath, buffer, { contentType: mimeType, upsert: true });

      if (uploadError) {
        console.error('[interview-answers] audio upload failed:', uploadError.message);
        return NextResponse.json({ error: 'Could not save the recorded answer.' }, { status: 500 });
      }

      try {
        transcript = await transcribeAnswer(buffer, mimeType);
      } catch (err) {
        console.error('[interview-answers] transcription failed:', err);
      }
    }

    const answer = {
      session_id: id,
      question_id: questionId,
      transcript,
      audio_storage_path: storagePath,
      total_time_taken_sec: durationSec,
    };

    // Re-answering a question (the candidate navigates Previous → Next) replaces the
    // previous take. Matched on the existing row rather than an ON CONFLICT upsert so the
    // write does not depend on the unique index having been migrated yet.
    const { data: existing } = await supabaseAdmin
      .from('interview_answers')
      .select('id')
      .eq('session_id', id)
      .eq('question_id', questionId)
      .maybeSingle();

    const { error: saveError } = existing
      ? await supabaseAdmin.from('interview_answers').update(answer).eq('id', existing.id)
      : await supabaseAdmin.from('interview_answers').insert(answer);

    if (saveError) {
      console.error('[interview-answers] save failed:', saveError.message);
      return NextResponse.json({ error: 'Could not save the recorded answer.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, transcribed: transcript !== null });
  } catch (error) {
    console.error('[interview-answers] server error:', error);
    return NextResponse.json({ error: 'Failed to process the recorded answer.' }, { status: 500 });
  }
}
