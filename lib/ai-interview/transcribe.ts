import { GoogleGenAI } from '@google/genai';

const TRANSCRIPTION_MODEL = 'gemini-3.6-flash';

// The candidate's UI waits on this upload, and a hung Gemini call has been seen to sit for
// 5 minutes before the socket gives up. Past this point the answer is saved without a
// transcript instead, and can be re-transcribed later from the stored audio.
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

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const response = await Promise.race([
    ai.models.generateContent({
      model: TRANSCRIPTION_MODEL,
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
}
