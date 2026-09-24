/**
 * Pure deterministic functions for calculating speech fluency and cognitive composite metrics.
 * Follows SonarQube rules: Number.isFinite, safe non-backtracking regexes, no side-effects.
 */

// Common English filler words & discourse markers
const FILLER_WORDS = new Set([
  'um',
  'uh',
  'er',
  'ah',
  'like',
  'you know',
  'sort of',
  'kind of',
  'basically',
  'actually',
  'literally',
  'i mean',
]);

export interface FillerCountResult {
  count: number;
  totalWords: number;
  ratio: number;
  breakdown: Record<string, number>;
}

export interface LocalFluencyInput {
  wordCount: number;
  speechMs: number;
  pauseMsTotal: number;
  pauseCount: number;
  fillerCount: number;
  responseLatencyMs: number;
}

export interface LocalFluencyResult {
  wpm: number;
  fillerRatio: number;
  longPauseRate: number; // pauses > 800ms per minute
  responseLatencyMs: number;
  localFluencyScore: number; // 0 - 100
}

/**
 * Normalizes text and counts filler words safely without exponential backtracking.
 */
export function countFillerWords(text: string): FillerCountResult {
  if (!text || typeof text !== 'string') {
    return { count: 0, totalWords: 0, ratio: 0, breakdown: {} };
  }

  // Tokenize cleanly on whitespace and punctuation
  const cleanText = text.toLowerCase().replace(/[^a-z0-9'\s]/g, ' ');
  const tokens = cleanText.split(/\s+/).filter((t) => t.length > 0);
  const totalWords = tokens.length;

  if (totalWords === 0) {
    return { count: 0, totalWords: 0, ratio: 0, breakdown: {} };
  }

  const breakdown: Record<string, number> = {};
  let count = 0;

  // Check 1-word fillers
  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i];
    if (FILLER_WORDS.has(word)) {
      breakdown[word] = (breakdown[word] || 0) + 1;
      count++;
    }

    // Check 2-word fillers (e.g. "you know", "sort of", "kind of", "i mean")
    if (i < tokens.length - 1) {
      const phrase = `${word} ${tokens[i + 1]}`;
      if (FILLER_WORDS.has(phrase)) {
        breakdown[phrase] = (breakdown[phrase] || 0) + 1;
        count++;
        i++; // skip next token to avoid double counting
      }
    }
  }

  const ratio = totalWords > 0 ? count / totalWords : 0;
  return { count, totalWords, ratio, breakdown };
}

/**
 * Calculates Words Per Minute (WPM) based on voiced speech milliseconds.
 */
export function calculateWPM(wordCount: number, speechMs: number): number {
  if (!Number.isFinite(wordCount) || !Number.isFinite(speechMs) || speechMs <= 0) {
    return 0;
  }
  const minutes = speechMs / 60000;
  return Math.round(wordCount / minutes);
}

/**
 * Maps a single metric value to a 0-100 score using piecewise linear interpolation.
 */
function piecewiseScore(val: number, minBad: number, optLow: number, optHigh: number, maxBad: number): number {
  if (!Number.isFinite(val)) return 50;

  if (val >= optLow && val <= optHigh) {
    return 100;
  }

  if (val < optLow) {
    if (val <= minBad) return 0;
    return Math.round(((val - minBad) / (optLow - minBad)) * 100);
  }

  // val > optHigh
  if (val >= maxBad) return 0;
  return Math.round(((maxBad - val) / (maxBad - optHigh)) * 100);
}

/**
 * Computes deterministic local fluency score (0 - 100) from objective speech characteristics.
 */
export function calculateLocalFluency(input: LocalFluencyInput): LocalFluencyResult {
  const { wordCount, speechMs, pauseCount, fillerCount, responseLatencyMs } = input;

  const wpm = calculateWPM(wordCount, speechMs);
  const fillerRatio = wordCount > 0 ? fillerCount / wordCount : 0;
  const minutes = speechMs > 0 ? speechMs / 60000 : 1;
  const longPauseRate = Math.round((pauseCount / minutes) * 10) / 10;

  // 1. WPM Score: Target 110 - 170. Penalized if < 70 or > 220.
  const wpmScore = piecewiseScore(wpm, 60, 110, 170, 230);

  // 2. Filler Score: Target < 3%. Penalized if > 12%.
  let fillerScore = 100;
  if (fillerRatio > 0.03) {
    fillerScore = Math.max(0, Math.round(100 - ((fillerRatio - 0.03) / (0.12 - 0.03)) * 100));
  }

  // 3. Pause Score: Target < 4 long pauses/min. Penalized if > 15/min.
  let pauseScore = 100;
  if (longPauseRate > 4) {
    pauseScore = Math.max(0, Math.round(100 - ((longPauseRate - 4) / (15 - 4)) * 100));
  }

  // 4. Response Latency Score: Target 300ms - 1800ms. Penalized if > 4500ms.
  let latencyScore = 100;
  if (responseLatencyMs > 1800) {
    latencyScore = Math.max(0, Math.round(100 - ((responseLatencyMs - 1800) / (4500 - 1800)) * 100));
  }

  // Weighted average: WPM (30%), Fillers (30%), Pauses (25%), Latency (15%)
  const localFluencyScore = Math.round(
    0.30 * wpmScore +
    0.30 * fillerScore +
    0.25 * pauseScore +
    0.15 * latencyScore
  );

  return {
    wpm,
    fillerRatio: Math.round(fillerRatio * 1000) / 1000,
    longPauseRate,
    responseLatencyMs,
    localFluencyScore: Math.min(100, Math.max(0, localFluencyScore)),
  };
}

/**
 * Maps CEFR level to nominal point scale (A2=35, B1=55, B2=72, C1=86, C2=95).
 */
export function mapCefrToScore(cefr: string): number {
  switch (cefr?.toUpperCase()) {
    case 'C2': return 95;
    case 'C1': return 86;
    case 'B2': return 72;
    case 'B1': return 55;
    case 'A2': return 35;
    default: return 50;
  }
}

/**
 * Combines objective local metrics with Gemini Flash CEFR rubric.
 * Standard weights: 45% Local, 55% Model.
 * In degraded mode (browser TTS): 70% Local, 30% Model.
 */
export function combineFluencyScores(localScore: number, modelScore: number, isDegraded = false): number {
  const localWeight = isDegraded ? 0.70 : 0.45;
  const modelWeight = 1.0 - localWeight;
  const combined = Math.round(localWeight * localScore + modelWeight * modelScore);
  return Math.min(100, Math.max(0, combined));
}

/**
 * Computes Cognitive Composite (0 - 100) from competency averages, reasoning, and clarity.
 */
export function calculateCognitiveComposite(
  competencyAvg1to5: number,
  reasoningSubscore100: number,
  claritySubscore100: number
): number {
  const safeAvg = Number.isFinite(competencyAvg1to5) ? Math.min(5, Math.max(1, competencyAvg1to5)) : 3;
  const competencyPts = ((safeAvg - 1) / 4) * 100;

  const safeReasoning = Number.isFinite(reasoningSubscore100) ? Math.min(100, Math.max(0, reasoningSubscore100)) : 50;
  const safeClarity = Number.isFinite(claritySubscore100) ? Math.min(100, Math.max(0, claritySubscore100)) : 50;

  const composite = Math.round(
    0.60 * competencyPts +
    0.30 * safeReasoning +
    0.10 * safeClarity
  );

  return Math.min(100, Math.max(0, composite));
}
