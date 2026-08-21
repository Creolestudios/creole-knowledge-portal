import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./gemini-client', () => ({
  geminiGenerate: vi.fn(),
}));

import { detectAiScore } from './ai-detection';
import { geminiGenerate } from './gemini-client';

const HUMAN_LIKE_TEXT = `
I spent a whole weekend debugging a race condition in our checkout flow, and honestly
it made me question my life choices. I ended up rewriting the useEffect that fetched
the cart totals, because I kept seeing stale values whenever a user double-clicked
"Add to cart". My fix was to add an AbortController and cancel the previous fetch --
not elegant, but it works. I tried three other approaches before this one, and each
had its own quirks. If you hit something similar with React 18 and Next.js 14,
check whether your effect cleanup is actually firing.
`.repeat(3);

describe('detectAiScore', () => {
  const originalKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalKey;
  });

  it('returns a zero score with a short-content signal for very short text', async () => {
    const result = await detectAiScore('<p>Too short</p>');
    expect(result.score).toBe(0);
    expect(result.signals).toContain('Content too short for reliable detection');
  });

  it('falls back to heuristic detection when no Gemini key is configured', async () => {
    delete process.env.GEMINI_API_KEY;

    const result = await detectAiScore(`<p>${HUMAN_LIKE_TEXT}</p>`);

    expect(geminiGenerate).not.toHaveBeenCalled();
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(Array.isArray(result.signals)).toBe(true);
  });

  it('scores personal, high-diversity human writing lower than generic filler-heavy text', async () => {
    delete process.env.GEMINI_API_KEY;

    const genericAiLike = `
      Furthermore, this topic is important. Moreover, it has many benefits.
      Additionally, developers should consider it. Consequently, adoption is growing.
      Therefore, it is recommended. Notably, the results are consistent. Thus, we conclude
      that this approach works well. Furthermore, more research is needed. Moreover,
      the community agrees. Additionally, the tooling supports it. Consequently, teams adopt it.
    `.repeat(3);

    const humanResult = await detectAiScore(`<p>${HUMAN_LIKE_TEXT}</p>`);
    const genericResult = await detectAiScore(`<p>${genericAiLike}</p>`);

    expect(humanResult.score).toBeLessThan(genericResult.score);
  });

  it('strips style, script, tags and entities before scoring', async () => {
    delete process.env.GEMINI_API_KEY;
    const html = `
      <style>.x{color:red}</style>
      <script>alert(1)</script>
      <h1>Title&nbsp;&amp; notes</h1>
      <p>${HUMAN_LIKE_TEXT}</p>
    `;
    const result = await detectAiScore(html);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(geminiGenerate).not.toHaveBeenCalled();
  });

  it('uses Gemini when a key is present and parses the JSON score', async () => {
    vi.resetModules();
    process.env.GEMINI_API_KEY = 'test-key';
    vi.doMock('./gemini-client', () => ({
      geminiGenerate: vi.fn().mockResolvedValue('{"score": 22, "signals": ["personal voice"]}'),
    }));
    const { detectAiScore: detectWithKey } = await import('./ai-detection');
    const { geminiGenerate: generate } = await import('./gemini-client');

    const result = await detectWithKey(`<p>${HUMAN_LIKE_TEXT}</p>`);
    expect(generate).toHaveBeenCalled();
    expect(result.score).toBe(22);
    expect(result.signals).toEqual(['personal voice']);
  });

  it('falls back to heuristic when Gemini throws', async () => {
    vi.resetModules();
    process.env.GEMINI_API_KEY = 'test-key';
    vi.doMock('./gemini-client', () => ({
      geminiGenerate: vi.fn().mockRejectedValue(new Error('quota')),
    }));
    const { detectAiScore: detectWithKey } = await import('./ai-detection');

    const result = await detectWithKey(`<p>${HUMAN_LIKE_TEXT}</p>`);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(Array.isArray(result.signals)).toBe(true);
  });
});
