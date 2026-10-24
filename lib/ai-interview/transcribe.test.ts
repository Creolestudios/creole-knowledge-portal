import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGenerateContent = vi.hoisted(() => vi.fn());

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: mockGenerateContent };
  },
}));

import { transcribeAnswer } from './transcribe';

describe('transcribeAnswer', () => {
  const originalKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test-key';
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalKey;
  });

  it('sends the audio to Gemini as base64 inline data and returns the spoken words', async () => {
    mockGenerateContent.mockResolvedValue({ text: '  I led the migration to Next.js.  ' });

    const audio = Buffer.from('fake-audio-bytes');
    const result = await transcribeAnswer(audio, 'audio/webm');

    expect(result).toBe('I led the migration to Next.js.');

    const call = mockGenerateContent.mock.calls[0][0];
    expect(call.contents[0]).toEqual({
      inlineData: { mimeType: 'audio/webm', data: audio.toString('base64') },
    });
    expect(call.config.temperature).toBe(0);
  });

  it('returns null when the recording held no intelligible speech', async () => {
    mockGenerateContent.mockResolvedValue({ text: '   ' });

    expect(await transcribeAnswer(Buffer.from('x'), 'audio/webm')).toBeNull();
  });

  it('returns null without calling Gemini when no API key is configured', async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_GENAI_API_KEY;

    expect(await transcribeAnswer(Buffer.from('x'), 'audio/webm')).toBeNull();
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('propagates model errors so the caller can decide how to handle them', async () => {
    mockGenerateContent.mockRejectedValue(new Error('quota exceeded'));

    await expect(transcribeAnswer(Buffer.from('x'), 'audio/webm')).rejects.toThrow('quota exceeded');
  });
});

describe('transcribeAnswer timeout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test-key';
  });

  it('gives up rather than hanging the candidate when Gemini never responds', async () => {
    vi.useFakeTimers();
    mockGenerateContent.mockReturnValue(new Promise(() => {})); // never settles

    const pending = transcribeAnswer(Buffer.from('x'), 'audio/webm');
    const assertion = expect(pending).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(46_000);
    await assertion;

    vi.useRealTimers();
  });
});
