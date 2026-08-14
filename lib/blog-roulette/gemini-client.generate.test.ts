import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: mockGenerateContent };
  },
}));

// geminiGenerate reads GEMINI_API_KEY once at module load, so each test that
// needs a different key state must reset modules and re-import dynamically.
async function importFreshModule() {
  vi.resetModules();
  return import('./gemini-client');
}

describe('geminiGenerate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('throws immediately when no API key is configured', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    const { geminiGenerate } = await importFreshModule();

    await expect(geminiGenerate('hello')).rejects.toThrow('GEMINI_API_KEY not set');
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('returns the generated text on a successful call', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    mockGenerateContent.mockResolvedValue({ text: 'Hello from Gemini' });
    const { geminiGenerate } = await importFreshModule();

    const result = await geminiGenerate('hello');
    expect(result).toBe('Hello from Gemini');
    expect(mockGenerateContent).toHaveBeenCalledWith({
      model: 'gemini-2.5-flash',
      contents: 'hello',
    });
  });

  it('returns an empty string when Gemini returns no text', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    mockGenerateContent.mockResolvedValue({ text: undefined });
    const { geminiGenerate } = await importFreshModule();

    const result = await geminiGenerate('hello');
    expect(result).toBe('');
  });

  it('retries on a 429 and succeeds on the next attempt', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const rateLimitErr = Object.assign(new Error('Too many requests'), { status: 429 });
    mockGenerateContent.mockRejectedValueOnce(rateLimitErr).mockResolvedValueOnce({ text: 'ok now' });
    const { geminiGenerate } = await importFreshModule();

    const promise = geminiGenerate('hello', { maxRetries: 2 });
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe('ok now');
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it('parses retryDelay from the 429 error message when present', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const rateLimitErr = Object.assign(
      new Error('Rate limited. Please retry with retryDelay: "2s"'),
      { status: 429 },
    );
    mockGenerateContent.mockRejectedValueOnce(rateLimitErr).mockResolvedValueOnce({ text: 'ok' });
    const { geminiGenerate } = await importFreshModule();

    const promise = geminiGenerate('hello', { maxRetries: 1 });
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe('ok');
  });

  it('throws the last error once retries are exhausted', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const rateLimitErr = Object.assign(new Error('429 Too Many Requests'), { status: 429 });
    mockGenerateContent.mockRejectedValue(rateLimitErr);
    const { geminiGenerate } = await importFreshModule();

    const promise = geminiGenerate('hello', { maxRetries: 1 });
    promise.catch(() => {}); // avoid unhandled rejection warning while timers advance
    await vi.runAllTimersAsync();

    await expect(promise).rejects.toBe(rateLimitErr);
  });

  it('throws immediately on a non-429 error without retrying', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    const err = new Error('Some other failure');
    mockGenerateContent.mockRejectedValue(err);
    const { geminiGenerate } = await importFreshModule();

    await expect(geminiGenerate('hello')).rejects.toBe(err);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('short-circuits with a rate-limited error once the in-window request cap is hit', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'test-key');
    mockGenerateContent.mockResolvedValue({ text: 'ok' });
    const { geminiGenerate } = await importFreshModule();

    // MAX_REQUESTS_PER_WINDOW is 15 — fire enough successful calls to hit it.
    for (let i = 0; i < 15; i++) {
      await geminiGenerate(`prompt ${i}`, { maxRetries: 0 });
    }

    await expect(geminiGenerate('one too many', { maxRetries: 0 })).rejects.toMatchObject({
      _rateLimited: true,
    });
  });
});
