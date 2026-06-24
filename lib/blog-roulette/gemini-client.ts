import { GoogleGenAI } from '@google/genai';

const GEMINI_KEY = process.env.GEMINI_API_KEY;

// ── Rate-limit state (in-memory, resets on server restart) ──

interface RateLimitState {
  /** Timestamps of recent requests (rolling window). */
  recentRequestTs: number[];
  /** When we're currently rate-limited until (0 = not limited). */
  limitedUntil: number;
}

const state: RateLimitState = {
  recentRequestTs: [],
  limitedUntil: 0,
};

const MAX_REQUESTS_PER_WINDOW = 15; // leave headroom under the 20/day free tier
const WINDOW_MS = 60_000; // 1 minute rolling window

/**
 * Parse `retryDelay` from a Gemini 429 error response.
 * Returns milliseconds or undefined if it can't be parsed.
 */
function parseRetryDelay(err: unknown): number | undefined {
  try {
    const body = (err as any)?.message ?? '';
    const match = body.match(/retryDelay["\s:]+(\d+(?:\.\d+)?)s/);
    if (match) return Math.min(Number(match[1]) * 1000 + 500, 30_000);
  } catch {
    // ignore parse failures
  }
  return undefined;
}

/**
 * Check whether we're still within the free-tier rate limit.
 * Throws immediately if we know we'd be blocked.
 */
function checkRateLimit(): void {
  const now = Date.now();

  // Still cooling down from a previous 429?
  if (state.limitedUntil > now) {
    const remaining = Math.ceil((state.limitedUntil - now) / 1000);
    throw Object.assign(new Error(`Rate limited — retry in ${remaining}s`), {
      _rateLimited: true,
      retryAfterMs: state.limitedUntil - now,
    });
  }

  // Prune old timestamps outside the rolling window
  state.recentRequestTs = state.recentRequestTs.filter((t) => now - t < WINDOW_MS);

  if (state.recentRequestTs.length >= MAX_REQUESTS_PER_WINDOW) {
    throw Object.assign(new Error(`Rate limited — max ${MAX_REQUESTS_PER_WINDOW} req/min`), {
      _rateLimited: true,
      retryAfterMs: WINDOW_MS,
    });
  }
}

function markRequest(): void {
  state.recentRequestTs.push(Date.now());
}

function markRateLimited(delayMs: number): void {
  state.limitedUntil = Date.now() + delayMs;
}

// ── Retry wrapper ──

interface RetryOpts {
  model?: string;
  maxRetries?: number;
}

/**
 * Call Gemini with automatic 429 retry + rate-limit bookkeeping.
 * Throws with `_rateLimited: true` if we exhaust retries.
 */
export async function geminiGenerate(
  prompt: string,
  opts: RetryOpts = {},
): Promise<string> {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY not set');

  const model = opts.model ?? 'gemini-2.5-flash';
  const maxRetries = opts.maxRetries ?? 2;
  const ai = new GoogleGenAI({ apiKey: GEMINI_KEY });

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // Backoff between retries
      const backoff = 1000 * attempt;
      await new Promise((r) => setTimeout(r, backoff));
    }

    try {
      checkRateLimit();
      markRequest();
      const result = await ai.models.generateContent({ model, contents: prompt });
      return result.text ?? '';
    } catch (err: any) {
      lastError = err;

      // Handle 429 specifically
      if (err?.status === 429 || err?.code === 429 || err?.message?.includes('429')) {
        const delayMs = parseRetryDelay(err) ?? 5_000;
        markRateLimited(delayMs);

        if (attempt < maxRetries) {
          console.warn(`[gemini] 429 hit, retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
      }

      // Non-retryable error
      throw err;
    }
  }

  throw lastError;
}

// ── Fallback: rule-based quiz generation ──

/**
 * When Gemini is unavailable, generate simple comprehension questions
 * from the blog text itself. These are basic but functional — they
 * test whether the author can recall specific details from their post.
 */
export function fallbackQuizQuestions(text: string): Array<{ q: string; expected_topic: string }> {
  const sentences = text
    .split(/[.!?]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40);

  // Extract code-related terms
  const codeTerms: string[] = [];
  const techWords = text.match(/\b(JavaScript|TypeScript|React|Next\.?js|Node|Python|API|SQL|CSS|HTML|Docker|Git|async|useEffect|useState|middleware|Supabase|PostgreSQL|Redis|OAuth|JWT|REST|GraphQL|function|class|component|hook|mutation|query)\b/gi) ?? [];
  const uniqueTerms = [...new Set(techWords.map((w) => w.toLowerCase()))].slice(0, 6);

  const questions: Array<{ q: string; expected_topic: string }> = [];

  // Q1: Ask about a main concept/tech mentioned in the blog
  if (uniqueTerms.length > 0) {
    const term = uniqueTerms[0];
    const mentionSentence = sentences.find((s) => s.toLowerCase().includes(term)) ?? `The blog discusses ${term}.`;
    questions.push({
      q: `In the context of your blog post, what is the significance of "${term}" and how did you apply it?`,
      expected_topic: `Usage and relevance of ${term} in the post: "${mentionSentence.slice(0, 120)}"`,
    });
  } else {
    questions.push({
      q: `Summarise the core technical challenge or problem your blog post addresses.`,
      expected_topic: `Core topic described in the post: "${sentences[0]?.slice(0, 120) ?? 'Not found'}"`,
    });
  }

  // Q2: Ask about a specific technical decision
  const howSentence = sentences.find((s) => s.length > 60 && s.length < 200);
  if (howSentence) {
    questions.push({
      q: `Describe a specific implementation detail or decision you made while working on this topic.`,
      expected_topic: `Specific detail from the post: "${howSentence.slice(0, 150)}"`,
    });
  } else {
    questions.push({
      q: `What problem were you trying to solve, and what trade-offs did you consider?`,
      expected_topic: `Problem statement: "${(sentences[1] ?? sentences[0])?.slice(0, 150) ?? 'General topic context'}"`,
    });
  }

  // Q3: Ask about a code-related insight
  if (uniqueTerms.length > 1) {
    questions.push({
      q: `How does "${uniqueTerms[1]}" relate to the main topic of your blog, and what was your experience using it?`,
      expected_topic: `Connection between ${uniqueTerms[1]} and the blog's main topic`,
    });
  } else {
    questions.push({
      q: `What is the most important takeaway or lesson from your experience writing this blog?`,
      expected_topic: `Key conclusion: "${sentences[sentences.length - 1]?.slice(0, 150) ?? 'General reflection'}"`,
    });
  }

  return questions;
}

// ── Fallback: heuristic grading ──

/**
 * When Gemini is unavailable, do a simple string-similarity check
 * between the answer and both the question + expected topic.
 * Not great, but better than a hard failure — it at least catches
 * empty or off-topic answers.
 */
export function fallbackGradeAnswers(
  questions: Array<{ q: string; expected_topic: string }>,
  answers: string[],
): { correct: number; per: boolean[] } {
  const per: boolean[] = answers.map((answer, i) => {
    const a = answer.trim().toLowerCase();
    if (a.length < 8) return false; // too short = empty

    const q = questions[i];
    const topic = q.expected_topic.toLowerCase();
    const questionText = q.q.toLowerCase();
    const combined = topic + ' ' + questionText;

    // Simple keyword overlap check (allow 3+ letter words like api, aws, git, sql)
    const answerWords = new Set(a.split(/\s+/).filter((w) => w.length > 2));
    const referenceWords = new Set(combined.split(/\s+/).filter((w) => w.length > 3));
    let overlap = 0;
    for (const w of answerWords) {
      if (referenceWords.has(w)) overlap++;
    }

    // If at least 1 key term matches and length is reasonable, count as correct
    return overlap >= 1;
  });

  return { correct: per.filter(Boolean).length, per };
}
