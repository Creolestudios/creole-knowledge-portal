import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser, supabaseAdmin } from '@/lib/supabase/admin';
import { transcribeAnswer } from '@/lib/ai-interview/transcribe';
import { resolveInterviewSessionId } from '@/lib/ai-interview/invite-token';

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
    const targetSessionId = (await resolveInterviewSessionId(id)) || id;
    const verifiedId = req.cookies.get('interview_verified_id')?.value;
    const verifiedToken = req.cookies.get('interview_verified_token')?.value;

    if (verifiedId !== targetSessionId && verifiedId !== id && verifiedToken !== id) {
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
    let clientTranscript: string | null = null;

    if (contentType.includes('application/json')) {
      const body = await req.json().catch(() => null);
      questionId = (body?.questionId || body?.question_id) as string | undefined;
      transcript = typeof body?.transcript === 'string' ? body.transcript : '';
      durationSec = Number(body?.total_time_taken_sec) || 0;
    } else {
      const formData = await req.formData();
      questionId = formData.get('questionId') as string | undefined;
      clientTranscript = (formData.get('transcript') as string) || null;
      const file = formData.get('file');
      if (file instanceof Blob && file.size > 0) {
        audioFile = file;
      } else if (!clientTranscript) {
        return NextResponse.json({ error: 'questionId and an audio file are required.' }, { status: 400 });
      } else {
        transcript = clientTranscript;
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
      .eq('session_id', targetSessionId)
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

      if (clientTranscript && clientTranscript.trim()) {
        transcript = clientTranscript.trim();
      } else {
        try {
          // Transcribe the buffer IN-MEMORY first
          transcript = await transcribeAnswer(buffer, mimeType);
        } catch (err) {
          console.error('[interview-answers] transcription failed:', err);
        }
      }

      // DATA MINIMIZATION: Only save audio to storage if we failed to get a transcript
      // If transcript is successful, we don't upload the audio, saving ~90%+ storage space.
      if (!transcript) {
        const { error: uploadError } = await supabaseAdmin.storage
          .from('interview-answer-audio')
          .upload(storagePath, buffer, { contentType: mimeType, upsert: true });

        if (uploadError) {
          console.error('[interview-answers] audio upload failed:', uploadError.message);
          return NextResponse.json({ error: 'Could not save the recorded answer.' }, { status: 500 });
        }
      } else {
        // Since we didn't upload it, we set storagePath to null to avoid saving a broken path in DB
        storagePath = null;
      }
    }

    // Re-answering or updating a question replaces/updates the previous take.
    // Matched on targetSessionId and questionId.
    const { data: existing } = await supabaseAdmin
      .from('interview_answers')
      .select('id, transcript, audio_storage_path, total_time_taken_sec')
      .eq('session_id', targetSessionId)
      .eq('question_id', questionId)
      .maybeSingle();

    let saveError;
    if (existing) {
      const updateData: Record<string, unknown> = {
        session_id: targetSessionId,
        question_id: questionId,
        total_time_taken_sec: durationSec || existing.total_time_taken_sec || 0,
      };
      // Only overwrite transcript if incoming is non-empty, or existing has no transcript
      if (transcript !== null) {
        updateData.transcript = typeof transcript === 'string' ? transcript.trim() : transcript;
      }
      if (storagePath) {
        updateData.audio_storage_path = storagePath;
      }
      const res = await supabaseAdmin.from('interview_answers').update(updateData).eq('id', existing.id);
      saveError = res.error;
    } else {
      const insertData = {
        session_id: targetSessionId,
        question_id: questionId,
        transcript: transcript !== null ? (typeof transcript === 'string' ? transcript.trim() : transcript) : null,
        audio_storage_path: storagePath || null,
        total_time_taken_sec: durationSec,
      };
      const res = await supabaseAdmin.from('interview_answers').insert(insertData);
      saveError = res.error;
    }

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
