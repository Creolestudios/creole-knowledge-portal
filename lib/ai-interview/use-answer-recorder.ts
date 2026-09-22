import { useCallback, useRef, useState } from 'react';

const PREFERRED_MIME_TYPES = ['audio/webm', 'audio/mp4', 'audio/ogg'];

export type AnswerRecorderStatus = 'idle' | 'recording' | 'saving' | 'unsupported';

function pickSupportedMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

/**
 * Records the candidate's spoken answer for one question at a time and uploads it when the
 * interview moves on. It taps the audio tracks of the stream the interview already holds —
 * it never calls getUserMedia, so the candidate is not prompted for permission again and the
 * live video call is unaffected.
 *
 * A browser without MediaRecorder support reports `unsupported` and records nothing; that is
 * surfaced to the candidate as a notice but never blocks the interview.
 */
export function useAnswerRecorder(interviewId: string, stream: MediaStream | null) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const questionIdRef = useRef<string | null>(null);
  const startedAtRef = useRef(0);
  const [status, setStatus] = useState<AnswerRecorderStatus>('idle');

  const startRecording = useCallback(
    (questionId: string) => {
      if (recorderRef.current) return;

      const audioTracks = stream?.getAudioTracks() ?? [];
      if (!audioTracks.length) return;

      const mimeType = pickSupportedMimeType();
      if (!mimeType) {
        setStatus('unsupported');
        return;
      }

      const recorder = new MediaRecorder(new MediaStream(audioTracks), { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.start();

      recorderRef.current = recorder;
      questionIdRef.current = questionId;
      startedAtRef.current = Date.now();
      setStatus('recording');
    },
    [stream]
  );

  const stopAndUpload = useCallback(async () => {
    const recorder = recorderRef.current;
    const questionId = questionIdRef.current;
    recorderRef.current = null;
    questionIdRef.current = null;

    if (!recorder || !questionId) return;

    const startedAtMs = startedAtRef.current;
    const endedAtMs = Date.now();

    if (recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });
    }

    const chunks = chunksRef.current;
    chunksRef.current = [];

    const blob = new Blob(chunks, { type: recorder.mimeType });
    if (blob.size === 0) {
      setStatus('idle');
      return;
    }

    setStatus('saving');
    try {
      const formData = new FormData();
      formData.append('questionId', questionId);
      formData.append('startedAtMs', String(startedAtMs));
      formData.append('endedAtMs', String(endedAtMs));
      formData.append('file', blob, 'answer');

      await fetch(`/api/interview/${interviewId}/answers`, { method: 'POST', body: formData });
    } catch (err) {
      console.error('[answer-recorder] answer upload failed:', err);
    } finally {
      setStatus('idle');
    }
  }, [interviewId]);

  const cancelRecording = useCallback(() => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    questionIdRef.current = null;
    chunksRef.current = [];

    if (recorder && recorder.state !== 'inactive') {
      recorder.ondataavailable = null;
      recorder.stop();
    }

    setStatus((current) => (current === 'unsupported' ? current : 'idle'));
  }, []);

  return { status, startRecording, stopAndUpload, cancelRecording };
}
