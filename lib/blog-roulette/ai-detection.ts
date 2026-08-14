import { geminiGenerate } from './gemini-client';

const GEMINI_KEY = process.env.GEMINI_API_KEY;

export interface AiScoreResult {
  score: number; // 0–100 — estimated % chance the text is AI-generated
  signals: string[];
}

/**
 * Strip HTML tags and normalise whitespace for analysis.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<[^>]{1,10000}>/g, ' ')
    .replace(/&#?\w+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Uses Gemini 2.5 Flash to estimate how likely the text was AI-generated.
 * Returns a score 0–100 where 100 = almost certainly AI-generated.
 *
 * Falls back to a heuristic perplexity estimate if Gemini is unavailable,
 * so the editor always gets a score even when the API is down.
 */
export async function detectAiScore(
  bodyHtml: string,
): Promise<AiScoreResult> {
  const text = stripHtml(bodyHtml);

  // Minimum viable content
  if (text.length < 150) {
    return { score: 0, signals: ['Content too short for reliable detection'] };
  }

  // Try Gemini for semantic detection
  if (GEMINI_KEY) {
    try {
      return await geminiDetection(text);
    } catch (err) {
      console.warn('[ai-detection] Gemini failed, falling back to heuristic', err);
    }
  }

  // Fallback: heuristic perplexity-style scoring (no API key needed)
  return heuristicDetection(text);
}

/**
 * Gemini-based detection — asks the model to analyse writing patterns
 * and return a structured score. Zero-cost on Gemini free tier (1M TPD).
 */
async function geminiDetection(text: string): Promise<AiScoreResult> {
  const prompt = `You are an AI-generated-text detector for a technical blog platform.

IMPORTANT: This is a developer writing a technical blog post. Technical writing
naturally has structured sections, consistent formatting, domain-specific
terminology, and few personal anecdotes. That is NORMAL, not AI-generated.

**Signals that strongly suggest HUMAN authorship (LOWER score):**
- Personal opinions, war stories, or experience ("I spent a weekend debugging…")
- Specific code examples with unusual edge cases or mistakes
- Irregular phrasing, contractions, conversational tone
- References to specific version numbers, real-world constraints
- Non-obvious opinions or takes that an AI would avoid
- Mentions of specific tools, libraries, or APIs with genuine context

**Signals that suggest AI generation (HIGHER score):**
- Generic, template-like structure with zero personal voice
- Content that could apply to any project — no specifics
- "Firstly", "Secondly", "In conclusion" — rigid academic framing
- Perfect formatting with no quirks, typos, or conversational moments
- Generic praise or recommendations without real experience
- Sentences that are all exactly the same length / rhythmic pattern
- Content that "sounds correct" but lacks any unique insight

**Your task:**
- Score 0–100 where 0 = obviously human-written and 100 = obviously AI-generated.
- MOST legitimate human-written blog posts should score 0–30.
- MOST AI-generated content should score 60–100.
- Use the FULL range — don't cluster scores in the middle.
- If the text has personal voice, specific details, or any signs of actual experience → score LOW (0–30).
- If the text is generic, polished, and has no personal touch → score MODERATE (40–70).
- If the text reads like ChatGPT output (no substance, perfectly balanced, buzzwords) → score HIGH (70–100).

Return ONLY a JSON object with this shape:
{"score": <number 0-100>, "signals": ["<brief reason 1>", "<brief reason 2>", ...]}

BLOG CONTENT (first 8000 chars):
${text.slice(0, 8000)}`;

  const raw = await geminiGenerate(prompt, { maxRetries: 1 });
  const jsonMatch = raw.match(/\{[\s\S]{0,50000}\}/);
  if (!jsonMatch) {
    throw new Error('Gemini returned non-JSON for AI detection');
  }

  const parsed = JSON.parse(jsonMatch[0]) as { score: number; signals: string[] };
  return {
    score: Math.max(0, Math.min(100, Math.round(parsed.score))),
    signals: (parsed.signals ?? []).slice(0, 4),
  };
}

/**
 * Heuristic fallback — estimates AI-likelihood based on:
 * - Lexical diversity (type-token ratio)
 * - Sentence-length variance
 * - Filler / transition-word density
 * - Personal-pronoun presence
 *
 * NOTE: Technical writing has structural patterns that overlap with AI
 * generation. This heuristic is deliberately conservative — it starts
 * with a *low* baseline and *only* adds points on strong signals, so
 * normal human-written dev blogs score low unless they genuinely read
 * like machine-generated text.
 */
function heuristicDetection(text: string): AiScoreResult {
  const words = text.split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 10);
  const totalWords = words.length;

  if (totalWords < 20) {
    return { score: 0, signals: ['Too few words to analyse'] };
  }

  // 1. Lexical diversity (type-token ratio) — lower = more repetitive.
  //    Tech writing is inherently repetitive (API names, domain terms),
  //    so only flag extreme uniformity.
  const unique = new Set(words.map((w) => w.toLowerCase()));
  const ttr = unique.size / totalWords;

  // 2. Sentence-length variance — AI tends toward uniform length.
  //    Again, technical blogs have naturally uniform sentences, so
  //    only flag very extreme uniformity.
  const sentLens = sentences.map((s) => s.trim().split(/\s+/).length);
  const meanLen =
    sentLens.reduce((a, b) => a + b, 0) / sentLens.length;
  const variance =
    sentLens.reduce((a, b) => a + (b - meanLen) ** 2, 0) / sentLens.length;
  const stdDev = Math.sqrt(variance);

  // 3. Filler / transition-word density — classic AI tell
  const fillerWords = new Set([
    'furthermore',
    'moreover',
    'additionally',
    'consequently',
    'in addition',
    'thus',
    'therefore',
    'notably',
  ]);
  const fillerCount = words.filter((w) => fillerWords.has(w.toLowerCase())).length;
  const fillerDensity = fillerCount / totalWords;

  // 4. Personal-pronoun density — human writers use them more
  const pronouns = new Set(['i', 'we', 'my', 'our', 'me', 'us', 'you']);
  const pronounCount = words.filter((w) => pronouns.has(w.toLowerCase())).length;
  const pronounDensity = pronounCount / totalWords;

  // Combine signals into a 0-100 score
  let score = 15; // start LOW — assume human-written

  // Extreme low lexical diversity → AI-like (ttr < 0.35 is very unusual
  // even for tech writing over 200+ words)
  if (ttr < 0.35) score += 25;
  else if (ttr < 0.40) score += 15;
  else if (ttr < 0.45) score += 5;
  // High diversity → strongly human-like
  if (ttr > 0.65) score -= 5;
  if (ttr > 0.75) score -= 10;

  // Extremely uniform sentence length → may be AI
  if (stdDev < 3 && sentLens.length > 5) score += 20;
  else if (stdDev < 4 && sentLens.length > 5) score += 10;
  // High variance → human-like
  if (stdDev > 12) score -= 10;

  // Heavy filler / transition-word use → AI-like (rare in genuine writing)
  if (fillerDensity > 0.06) score += 20;
  else if (fillerDensity > 0.04) score += 10;
  // Very low filler use → human-like
  if (fillerDensity < 0.01) score -= 5;

  // Very few personal pronouns → suspicious if content is long
  if (pronounDensity < 0.005 && totalWords > 100) score += 15;
  else if (pronounDensity < 0.01 && totalWords > 100) score += 5;
  // Healthy pronoun use → human-like
  if (pronounDensity > 0.03) score -= 10;
  if (pronounDensity > 0.05) score -= 5;

  const clamped = Math.max(0, Math.min(100, score));

  const signals: string[] = [];
  if (ttr < 0.4) signals.push('Very low lexical diversity');
  if (stdDev < 3.5 && sentLens.length > 5) signals.push('Extremely uniform sentence structure');
  if (fillerDensity > 0.05) signals.push('Heavy transition-word use');
  if (pronounDensity < 0.005 && totalWords > 100) signals.push('No personal references');

  return {
    score: clamped,
    signals: signals.length > 0 ? signals : ['No strong AI signals detected'],
  };
}
