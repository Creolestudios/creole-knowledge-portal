import { GoogleGenAI } from '@google/genai';

const TRANSCRIPTION_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
const TRANSCRIPTION_TIMEOUT_MS = 45_000;

const TRANSCRIPTION_PROMPT = `
Write down exactly what the primary interview candidate says in this audio recording.

Rules:
- Return ONLY the spoken words of the primary candidate as plain text. No labels, no timestamps, no commentary.
- Transcribe STRICTLY VERBATIM what the candidate uttered. Do NOT smooth, edit, or polish the candidate's speech.
- Focus exclusively on the primary speaker (foreground candidate closest to the microphone). Ignore background noise, secondary background voices, TV/media chatter, or background music.
- Capture and transcribe all candidate filler words, vocal hesitations, and disfluencies exactly as spoken (e.g., "umm", "uh", "uhh", "er", "ah", "like", "you know", "sort of", "kind of").
- Include false starts, self-corrections, and repeated words exactly as uttered by the candidate.
- Do not summarise or rephrase. Transcribe what the candidate actually said.
- If the audio contains no intelligible candidate speech, return an empty response.
`.trim();

/**
 * Converts a recorded interview answer to text using Gemini (already this project's LLM —
 * it accepts audio directly, so no separate speech-to-text vendor is needed).
 *
 * Returns `null` when there is nothing usable to store: no API key configured, or the
 * recording held no intelligible speech. Transport/model errors propagate to the caller,
 * which decides whether a failed transcription should fail the request.
 */
export async function transcribeAnswer(audio: Buffer, mimeType: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;

  if (!apiKey) {
    console.warn('[interview-transcribe] GEMINI_API_KEY missing — answer stored without a transcript.');
    return null;
  }

  const ai = new GoogleGenAI({ apiKey });

  let lastError: unknown;
  for (let i = 0; i < TRANSCRIPTION_MODELS.length; i++) {
    const model = TRANSCRIPTION_MODELS[i];
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      const response = await Promise.race([
        ai.models.generateContent({
          model,
          contents: [
            { inlineData: { mimeType, data: audio.toString('base64') } },
            TRANSCRIPTION_PROMPT,
          ],
          config: { temperature: 0 },
        }),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error(`Transcription timed out after ${TRANSCRIPTION_TIMEOUT_MS}ms`)),
            TRANSCRIPTION_TIMEOUT_MS
          );
        }),
      ]).finally(() => clearTimeout(timeoutHandle));

      const transcript = (response?.text || '').trim();
      return transcript.length > 0 ? transcript : null;
    } catch (err: any) {
      lastError = err;
      const isTransient =
        err?.status === 503 ||
        err?.code === 503 ||
        err?.message?.includes('503') ||
        err?.message?.includes('high demand') ||
        err?.message?.includes('UNAVAILABLE');

      // Only attempt fallback model if transient overload error and more models remain
      if (isTransient && i < TRANSCRIPTION_MODELS.length - 1) {
        console.warn(`[interview-transcribe] Model ${model} unavailable, trying fallback ${TRANSCRIPTION_MODELS[i + 1]}`);
        continue;
      }
      throw err;
    }
  }

  if (lastError) throw lastError;
  return null;
}

const CHUNK_TRANSCRIPTION_PROMPT = `
Write down verbatim what the candidate says in this audio clip.
Rules:
- Return ONLY the exact spoken words as plain text. No timestamps, no labels, no quotes, no markdown.
- Transcribe EVERY single word uttered, including isolated single-word responses (e.g., "Yes", "No", "React", "Sure", "OK", "Next", "Fine", "Hello").
- Transcribe technical and programming terms accurately (e.g. React, Next.js, TypeScript, SQL, Node, API, Docker).
- Preserve all filler words (e.g. um, uh, ah) exactly as spoken.
- Capture soft, slow, and quiet speech accurately.
- If the clip contains absolutely no discernible candidate speech, return an empty string.
`.trim();

/**
 * Transcribes a short live audio snippet in real time using Gemini Flash.
 * Returns text or empty string if no speech was detected.
 */
export async function transcribeAudioChunk(audio: Buffer, mimeType: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;

  if (!apiKey) {
    return null;
  }

  const ai = new GoogleGenAI({ apiKey });

  for (let i = 0; i < TRANSCRIPTION_MODELS.length; i++) {
    const model = TRANSCRIPTION_MODELS[i];
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      const response = await Promise.race([
        ai.models.generateContent({
          model,
          contents: [
            { inlineData: { mimeType, data: audio.toString('base64') } },
            CHUNK_TRANSCRIPTION_PROMPT,
          ],
          config: { temperature: 0 },
        }),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error('Chunk transcription timed out')),
            12_000
          );
        }),
      ]).finally(() => clearTimeout(timeoutHandle));

      const transcript = (response?.text || '').trim();
      return transcript.length > 0 ? transcript : null;
    } catch {
      if (i < TRANSCRIPTION_MODELS.length - 1) {
        continue;
      }
      return null;
    }
  }

  return null;
}
