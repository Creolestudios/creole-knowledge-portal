/**
 * Zoho Task Evaluation Heuristics Engine
 *
 * Implements:
 * 1. Time tolerance rules (+5m overtime buffer, 15m early completion gap).
 * 2. Repetitive task detection in the same project using tokenized Jaccard similarity.
 * 3. Daily & till-date rollup statistics aggregation.
 */

export interface TimeAdherenceResult {
  timeScore: number; // 0 - 100
  timeVarianceMinutes: number; // actual - planned
  assessmentLabel: 'ON_TIME' | 'SLIGHT_OVERRUN_TOLERATED' | 'UNEXPECTED_EARLY' | 'OVERDUE';
  explanation: string;
}

export interface HistoricalTask {
  id: string;
  name: string;
  description?: string | null;
}

export interface RepetitionCheckResult {
  isRepetitive: boolean;
  similarityPct: number;
  matchedTaskId: string | null;
  repetitionScore: number; // 0 - 100
  explanation: string;
}

/**
 * Calculates time adherence score based on strict CKP rules:
 * - 4 hours planned, 4:05 spent (+5 min overrun) => Zero penalty (100 score).
 * - 4 hours planned, completed in 3:30 (30 mins early) => 15 mins gap allowed, remaining 15 mins early affects score.
 */
export function calculateTimeAdherence(
  plannedMinutes: number,
  actualMinutes: number
): TimeAdherenceResult {
  const safePlanned = Number.isFinite(plannedMinutes) && plannedMinutes > 0 ? plannedMinutes : 60;
  const safeActual = Number.isFinite(actualMinutes) && actualMinutes >= 0 ? actualMinutes : 0;
  const variance = safeActual - safePlanned;

  // Case 1: Overtime with <= 5 minutes buffer
  if (variance > 0 && variance <= 5) {
    return {
      timeScore: 100,
      timeVarianceMinutes: variance,
      assessmentLabel: 'SLIGHT_OVERRUN_TOLERATED',
      explanation: `Task took ${variance}m over planned time, which is within the 5-minute permitted tolerance buffer. Full score awarded.`
    };
  }

  // Case 2: Exact on-time or completed within 15 min early buffer
  if (variance <= 0 && variance >= -15) {
    return {
      timeScore: 100,
      timeVarianceMinutes: variance,
      assessmentLabel: 'ON_TIME',
      explanation: variance === 0
        ? 'Task completed exactly on planned time.'
        : `Task completed ${Math.abs(variance)}m early, within the allowed 15-minute window.`
    };
  }

  // Case 3: Completed too early (> 15 min gap, e.g. 4h planned done in 3h 30m => 30m early)
  if (variance < -15) {
    const earlyGapMinutes = Math.abs(variance) - 15;
    // Penalty scales with excess early completion vs planned duration (max penalty 40 pts)
    const earlyRatio = earlyGapMinutes / safePlanned;
    const penalty = Math.min(40, Math.round(earlyRatio * 100 * 0.7));
    const score = Math.max(50, 100 - penalty);

    return {
      timeScore: score,
      timeVarianceMinutes: variance,
      assessmentLabel: 'UNEXPECTED_EARLY',
      explanation: `Task finished ${Math.abs(variance)}m earlier than estimated (${earlyGapMinutes}m beyond the 15m allowance). Indicates potential estimation padding or rushed execution.`
    };
  }

  // Case 4: Overdue (> 5 minutes overtime)
  const excessOvertime = variance - 5;
  const lateRatio = excessOvertime / safePlanned;
  const penalty = Math.min(60, Math.round(lateRatio * 100 * 0.6));
  const score = Math.max(20, 100 - penalty);

  return {
    timeScore: score,
    timeVarianceMinutes: variance,
    assessmentLabel: 'OVERDUE',
    explanation: `Task exceeded planned time by ${variance}m (${excessOvertime}m beyond 5m buffer). Delayed delivery impacted time score.`
  };
}

/**
 * Normalizes text to tokens without vulnerable greedy regexes
 */
function tokenizeText(text: string): Set<string> {
  if (!text) return new Set();
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(' ')
    .map(token => token.trim())
    .filter(token => token.length > 2);

  return new Set(normalized);
}

/**
 * Calculates Jaccard similarity between two token sets
 */
function computeJaccardSimilarity(tokensA: Set<string>, tokensB: Set<string>): number {
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersectionCount = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      intersectionCount++;
    }
  }
  const unionCount = tokensA.size + tokensB.size - intersectionCount;
  return unionCount === 0 ? 0 : intersectionCount / unionCount;
}

/**
 * Checks if user is repeatedly adding near-identical tasks in the same project
 */
export function detectRepetitiveTask(
  currentTaskName: string,
  currentTaskDescription: string | null | undefined,
  historicalTasks: HistoricalTask[]
): RepetitionCheckResult {
  if (!historicalTasks || historicalTasks.length === 0) {
    return {
      isRepetitive: false,
      similarityPct: 0,
      matchedTaskId: null,
      repetitionScore: 100,
      explanation: 'No historical tasks found in this project. First occurrence.'
    };
  }

  const currentTokens = tokenizeText(`${currentTaskName} ${currentTaskDescription || ''}`);
  let maxSimilarity = 0;
  let matchedTaskId: string | null = null;
  let matchedTaskName = '';

  for (const task of historicalTasks) {
    const historicalTokens = tokenizeText(`${task.name} ${task.description || ''}`);
    const similarity = computeJaccardSimilarity(currentTokens, historicalTokens);

    if (similarity > maxSimilarity) {
      maxSimilarity = similarity;
      matchedTaskId = task.id;
      matchedTaskName = task.name;
    }
  }

  const similarityPct = Math.round(maxSimilarity * 100);

  // Threshold: > 60% similarity flags repetitive task
  if (similarityPct >= 60) {
    const penalty = Math.min(70, Math.round(maxSimilarity * 80));
    const repetitionScore = Math.max(20, 100 - penalty);

    return {
      isRepetitive: true,
      similarityPct,
      matchedTaskId,
      repetitionScore,
      explanation: `Repetitive task detected with ${similarityPct}% similarity to previously logged task "${matchedTaskName}". Repeating identical task scopes in the same project lowers evaluation score.`
    };
  }

  return {
    isRepetitive: false,
    similarityPct,
    matchedTaskId: null,
    repetitionScore: 100,
    explanation: 'Task scope is sufficiently unique within this project.'
  };
}

/**
 * Calculates composite score combining all weighted parameters
 */
export function computeCompositeTaskScore(params: {
  timeScore: number;
  commentQualityScore: number;
  complexityScore: number;
  repetitionScore: number;
  isQAReview: boolean;
}): number {
  // Base weights:
  // Time Adherence: 35%
  // Comment & QA Handoff: 25%
  // Complexity / Technical execution: 20%
  // Repetition / Originality: 20%
  let weighted =
    params.timeScore * 0.35 +
    params.commentQualityScore * 0.25 +
    params.complexityScore * 0.20 +
    params.repetitionScore * 0.20;

  // Bonus for moving to QA Review with clear handoff
  if (params.isQAReview) {
    weighted = Math.min(100, weighted + 3);
  }

  return Math.max(10, Math.min(100, Math.round(weighted)));
}
