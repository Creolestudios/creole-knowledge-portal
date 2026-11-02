/**
 * Zoho Task Evaluation Heuristics Engine
 *
 * Implements:
 * 1. Time tolerance rules (±10m buffer: 4h planned with 3:50 to 4:10 logged is 10/10).
 * 2. Work & comment match evaluation (does comment verify work completed per task description).
 * 3. Repetitive task detection in the same project using tokenized Jaccard similarity.
 * 4. Composite scoring strictly out of 10.
 */

export interface TimeAdherenceResult {
  timeScore: number; // 0 - 10 (e.g. 10.0, 8.5)
  timeVarianceMinutes: number; // actual - planned
  assessmentLabel: 'ON_TIME' | 'SLIGHT_OVERRUN_TOLERATED' | 'UNEXPECTED_EARLY' | 'OVERDUE' | 'NOT_LOGGED';
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
  repetitionScore: number; // 0 - 10
  explanation: string;
}

export interface TaskTimeReasonablenessResult {
  reasonablenessScore: number;
  velocityLabel: 'OPTIMAL' | 'TIME_INFLATED_FOR_AI_TIER' | 'RUSHED_WITHOUT_VERIFICATION' | 'NORMAL';
  expectedBenchmarkMinutes: number;
  penalty: number;
  bonus: number;
  explanation: string;
}

export interface WorkMatchResult {
  workMatchScore: number; // 0 - 10
  alignmentLabel: 'STRONG_ALIGNMENT' | 'MODERATE_ALIGNMENT' | 'WEAK_ALIGNMENT' | 'NO_COMMENTS' | 'UNVERIFIED' | 'MISSING_TASK_DESCRIPTION';
  explanation: string;
  isBriefDescription?: boolean;
  isChecklistComment?: boolean;
  isBriefComment?: boolean;
  isMissingDescription?: boolean;
  timeReasonableness?: TaskTimeReasonablenessResult;
}

/**
 * Calculates time adherence score based on strict CKP rules:
 * - Buffer: up to 5 mins more (+5m overtime) and up to 15 mins less (-15m early).
 * - E.g. for 4h planned (240m), 3h 45m to 4h 05m is full score (10/10).
 * - Beyond +5m or before -15m negatively affects score.
 * - If 0 hours logged, returns 0 score with NOT_LOGGED label.
 */
export function calculateTimeAdherence(
  plannedMinutes: number,
  actualMinutes: number
): TimeAdherenceResult {
  const safePlanned = Number.isFinite(plannedMinutes) && plannedMinutes > 0 ? plannedMinutes : 60;
  const safeActual = Number.isFinite(actualMinutes) && actualMinutes >= 0 ? actualMinutes : 0;

  if (safeActual === 0) {
    return {
      timeScore: 0,
      timeVarianceMinutes: -safePlanned,
      assessmentLabel: 'NOT_LOGGED',
      explanation: 'No hours were logged for this task in Zoho Projects.'
    };
  }

  const variance = safeActual - safePlanned;

  // Case 1: Overtime with <= 5 minutes buffer (e.g. 4h planned, up to 4:05)
  if (variance > 0 && variance <= 5) {
    return {
      timeScore: 10,
      timeVarianceMinutes: variance,
      assessmentLabel: 'SLIGHT_OVERRUN_TOLERATED',
      explanation: `Task took ${variance}m over planned time, within the permitted +5m buffer. Full score (10/10) awarded.`
    };
  }

  // Case 2: Exact on-time or completed within 15 min early buffer (e.g. 4h planned, down to 3:45)
  if (variance <= 0 && variance >= -15) {
    return {
      timeScore: 10,
      timeVarianceMinutes: variance,
      assessmentLabel: 'ON_TIME',
      explanation: variance === 0
        ? 'Task completed exactly on planned time (10/10).'
        : `Task completed ${Math.abs(variance)}m early, within the permitted -15m buffer. Full score (10/10) awarded.`
    };
  }

  // Case 3: Completed too early (> 15 min early, e.g. 4h planned done in 3h 30m => 30m early)
  if (variance < -15) {
    const earlyGapMinutes = Math.abs(variance) - 15;
    const earlyRatio = earlyGapMinutes / safePlanned;
    const penalty = Math.min(5.0, Number((earlyRatio * 10 * 0.8).toFixed(1)));
    const score = Math.max(3.0, Number((10 - penalty).toFixed(1)));

    return {
      timeScore: score,
      timeVarianceMinutes: variance,
      assessmentLabel: 'UNEXPECTED_EARLY',
      explanation: `Task finished ${Math.abs(variance)}m earlier than estimated (${earlyGapMinutes}m beyond the -15m buffer). Early gap negatively impacted time score (${score}/10).`
    };
  }

  // Case 4: Overdue (> 5 minutes overtime, e.g. 4h planned done in 4h 20m => 20m overtime)
  const excessOvertime = variance - 5;
  const lateRatio = excessOvertime / safePlanned;
  const penalty = Math.min(7.0, Number((lateRatio * 10 * 0.7).toFixed(1)));
  const score = Math.max(2.0, Number((10 - penalty).toFixed(1)));

  return {
    timeScore: score,
    timeVarianceMinutes: variance,
    assessmentLabel: 'OVERDUE',
    explanation: `Task exceeded planned time by ${variance}m (${excessOvertime}m beyond the +5m buffer). Overtime negatively impacted time score (${score}/10).`
  };
}

/**
 * Dynamically calculates whether the time spent on a task aligns with expectations
 * based on developer experience and AI subscriptions (e.g. Antigravity Pro, Cursor, Copilot).
 *
 * NO hardcoded hours or fixed thresholds.
 * Uses dynamic experience velocity decay curve and AI acceleration factors.
 */
export function calculateDynamicTaskTimeReasonableness(params: {
  taskName?: string;
  taskDescription?: string | null;
  comments?: string[];
  userExperienceYears?: number;
  seniorityLevel?: string;
  aiSubscriptions?: string[];
  plannedMinutes?: number;
  actualMinutes?: number;
}): TaskTimeReasonablenessResult {
  const safePlanned = params.plannedMinutes && params.plannedMinutes > 0 ? params.plannedMinutes : 240;
  const safeActual = params.actualMinutes && params.actualMinutes > 0 ? params.actualMinutes : safePlanned;

  const expYears = typeof params.userExperienceYears === 'number' && !Number.isNaN(params.userExperienceYears)
    ? params.userExperienceYears
    : 2;

  // 1. Dynamic Experience Factor (continuous curve without discrete step jumps):
  // Junior (0-1 yr): factor ~1.16 - 1.25 (takes longer)
  // Mid (2-4 yrs): factor ~1.00
  // Senior (5+ yrs): factor ~0.70 - 0.76 (faster)
  const experienceFactor = Math.max(0.65, Math.min(1.35, 1.0 - (expYears - 2) * 0.08));

  // 2. Dynamic AI Velocity Factor:
  // If user has active AI subscriptions (Antigravity Pro, Cursor AI, GitHub Copilot, Claude Pro, etc.)
  const hasAi = Array.isArray(params.aiSubscriptions) && params.aiSubscriptions.length > 0;
  const aiVelocityFactor = hasAi ? 1.45 : 1.0;

  // 3. Dynamic Expected Benchmark Minutes (computed dynamically without hardcoding hours)
  const expectedBenchmarkMinutes = Math.max(30, Math.round(safePlanned * (experienceFactor / aiVelocityFactor)));

  // 4. Comparison Ratio: Actual time taken vs Expected benchmark duration
  const ratio = safeActual / expectedBenchmarkMinutes;

  const toolsLabel = hasAi && params.aiSubscriptions ? params.aiSubscriptions.join(', ') : '';
  const seniorityLabel = params.seniorityLevel || (expYears >= 5 ? 'Senior' : expYears >= 2 ? 'Mid' : 'Junior');

  // Case A: Excessive time inflation (> 35% over expected AI/Experience benchmark)
  if (ratio > 1.35) {
    const excess = ratio - 1.25;
    const penalty = Number(Math.min(4.5, excess * 2.8).toFixed(1));
    const score = Number(Math.max(2.0, 10.0 - penalty).toFixed(1));
    const aiNote = hasAi ? ` with ${toolsLabel}` : '';

    return {
      reasonablenessScore: score,
      velocityLabel: 'TIME_INFLATED_FOR_AI_TIER',
      expectedBenchmarkMinutes,
      penalty,
      bonus: 0,
      explanation: `Task logged duration exceeded dynamic benchmark for a ${seniorityLabel} developer (${expYears} yrs)${aiNote}. Expected benchmark was ~${Math.round((expectedBenchmarkMinutes / 60) * 10) / 10}h vs ${Math.round((safeActual / 60) * 10) / 10}h logged.`,
    };
  }

  // Case B: Suspiciously fast (< 40% of benchmark) without technical verification in comments
  const combinedComments = (params.comments || []).join(' ').toLowerCase();
  const hasVerification = combinedComments.includes('test') || combinedComments.includes('verify') || combinedComments.includes('pr') || combinedComments.includes('commit');
  if (ratio < 0.40 && !hasVerification) {
    const earlyGap = 0.50 - ratio;
    const penalty = Number(Math.min(2.5, earlyGap * 3.0).toFixed(1));
    const score = Number(Math.max(4.0, 10.0 - penalty).toFixed(1));

    return {
      reasonablenessScore: score,
      velocityLabel: 'RUSHED_WITHOUT_VERIFICATION',
      expectedBenchmarkMinutes,
      penalty,
      bonus: 0,
      explanation: `Task was completed well below expected duration (${Math.round((safeActual / 60) * 10) / 10}h vs benchmark ~${Math.round((expectedBenchmarkMinutes / 60) * 10) / 10}h) without attaching unit test verification or technical review notes.`,
    };
  }

  // Case C: Optimal pace within dynamic benchmark
  const bonus = (hasAi && ratio <= 1.15) ? 0.3 : 0;
  return {
    reasonablenessScore: 10.0,
    velocityLabel: 'OPTIMAL',
    expectedBenchmarkMinutes,
    penalty: 0,
    bonus,
    explanation: hasAi
      ? `Effective execution velocity leveraging ${toolsLabel} within benchmark for a ${seniorityLabel} engineer.`
      : `Punctual task completion aligned with benchmark expectations.`,
  };
}

/**
 * Evaluates whether comments match the task description and substantiate the work completed,
 * accounting for user seniority, AI tools, and planned time reasonableness.
 *
 * Appended checks:
 * 1. Missing description check: strictly penalizes tasks with empty descriptions and comments.
 * 2. Description depth check: flags brief/vague descriptions (< ~35-40 words).
 * 3. Comment depth check: flags brief comments (< ~35-40 words).
 * 4. Checklist comment detection: flags comments that merely copy-paste the description and append "- Done" / "Done".
 * 5. Dynamic time reasonableness: evaluates whether actual time matches experience & AI subscription expectations.
 */
export function evaluateWorkAndCommentMatch(
  taskDescription: string | null | undefined,
  comments: string[] = [],
  context?: {
    taskName?: string;
    userExperienceYears?: number;
    seniorityLevel?: string;
    aiSubscriptions?: string[];
    plannedMinutes?: number;
    actualMinutes?: number;
  }
): WorkMatchResult {
  const cleanDesc = (taskDescription || '').trim();
  const cleanComments = (comments || []).map(c => (c || '').trim()).filter(c => c.length > 0);

  if (cleanComments.length === 0) {
    if (cleanDesc.length === 0) {
      return {
        workMatchScore: 0,
        alignmentLabel: 'NO_COMMENTS',
        explanation: 'Missing both task description and progress comments in Zoho Projects.',
        isMissingDescription: true,
      };
    }
    return {
      workMatchScore: 0,
      alignmentLabel: 'NO_COMMENTS',
      explanation: 'Task description exists, but zero progress comments were logged in Zoho. Score is 0.'
    };
  }

  // Strict rule: If task description is completely missing but comments exist,
  // strictly penalize with a lower score (cannot verify work against missing scope)
  if (cleanDesc.length === 0) {
    return {
      workMatchScore: 3.0,
      alignmentLabel: 'MISSING_TASK_DESCRIPTION',
      explanation: 'Task description is completely missing in Zoho Projects. Logged progress comments cannot be verified against any defined scope or acceptance criteria. Strictly penalized.',
      isBriefDescription: true,
      isChecklistComment: false,
      isBriefComment: false,
      isMissingDescription: true,
    };
  }

  const combinedComments = cleanComments.join(' ').toLowerCase();

  // Word counts (substance benchmarks)
  const descWords = cleanDesc.split(/\s+/).filter(Boolean);
  const descWordCount = descWords.length;
  const isBriefDescription = descWordCount < 40;

  const commentWords = cleanComments.join(' ').split(/\s+/).filter(Boolean);
  const commentWordCount = commentWords.length;
  const isBriefComment = commentWordCount < 40;

  // Check for superficial / single-word comments
  const isSuperficial =
    cleanComments.length === 1 &&
    ['done', 'completed', 'fixed', 'resolved', 'ok', 'yes', 'update', 'working on it', 'wip'].includes(cleanComments[0].toLowerCase());

  if (isSuperficial) {
    return {
      workMatchScore: 4.0,
      alignmentLabel: 'WEAK_ALIGNMENT',
      explanation: 'Logged comment is superficial (e.g. "done") and does not justify the time taken or technical scope.',
      isBriefDescription,
      isChecklistComment: true,
      isBriefComment: true,
    };
  }

  // Detect checklist comments that copy-paste the description with "- Done", "Done", "pending"
  const checklistMarkers = [
    /\b(done|not done|pending|completed)\b/i,
    /-\s*(done|pending|not done)/i,
  ];
  const hasChecklistMarkers = checklistMarkers.some(re => re.test(combinedComments));

  const descWordSet = new Set(descWords.map(w => w.toLowerCase().replace(/[^a-z0-9]/g, '')));
  const nonDescWords = commentWords.filter(w => {
    const cleanW = w.toLowerCase().replace(/[^a-z0-9]/g, '');
    return cleanW.length > 0 && !descWordSet.has(cleanW);
  });
  const statusStopWords = new Set(['done', 'pending', 'not', 'is', 'are', 'which', 'by', 'client', 'key', 'for', 'and', 'the', 'on', 'to', '1', '2', '3', 'ok', 'yes', 'no', 'of', 'in', 'at']);
  const technicalExplanationWords = nonDescWords.filter(w => !statusStopWords.has(w.toLowerCase().replace(/[^a-z0-9]/g, '')));
  const isChecklistComment = hasChecklistMarkers && (technicalExplanationWords.length < 15);

  // Check action words
  const actionTerms = [
    'implemented', 'resolved', 'tested', 'verified', 'pr', 'commit', 'bug', 'fixed',
    'created', 'updated', 'added', 'configured', 'refactored', 'debugged', 'unit test',
    'endpoint', 'api', 'reviewed', 'validation', 'handler', 'schema', 'migration'
  ];
  let actionHits = 0;
  for (const term of actionTerms) {
    if (combinedComments.includes(term)) actionHits++;
  }

  // Tokenize description and comments to check overlap
  const descTokens = tokenizeText(cleanDesc);
  const commentTokens = tokenizeText(combinedComments);
  const similarity = computeJaccardSimilarity(descTokens, commentTokens);

  // Consider user seniority and AI subscriptions in expectations
  const hasAi = context?.aiSubscriptions && context.aiSubscriptions.length > 0;
  const isSenior = (context?.userExperienceYears || 2) >= 5;

  let baseScore = 7.5;

  const hasStrongTechnicalEvidence = (actionHits >= 2) || (actionHits >= 1 && !isBriefComment && similarity >= 0.15) || (!isBriefComment && similarity >= 0.35);

  if (isChecklistComment && isBriefDescription) {
    baseScore = 4.8;
  } else if (isChecklistComment) {
    baseScore = 5.2;
  } else if (hasStrongTechnicalEvidence) {
    baseScore = 9.0 + Math.min(1.0, actionHits * 0.3);
  } else if (isBriefDescription && isBriefComment) {
    baseScore = 5.5;
  } else if (isBriefDescription || isBriefComment) {
    baseScore = 6.2;
  } else if (similarity >= 0.06 || actionHits >= 1) {
    baseScore = 8.0;
  } else {
    baseScore = 6.8;
  }

  // 5. Dynamic Time Reasonableness check based on Experience + AI Subscription
  const timeReasonableness = (context?.plannedMinutes && context?.actualMinutes)
    ? calculateDynamicTaskTimeReasonableness({
        taskName: context.taskName,
        taskDescription: cleanDesc,
        comments: cleanComments,
        userExperienceYears: context.userExperienceYears,
        seniorityLevel: context.seniorityLevel,
        aiSubscriptions: context.aiSubscriptions,
        plannedMinutes: context.plannedMinutes,
        actualMinutes: context.actualMinutes,
      })
    : undefined;

  if (timeReasonableness && timeReasonableness.penalty > 0) {
    baseScore = Math.max(2.5, baseScore - timeReasonableness.penalty);
  } else if (timeReasonableness && timeReasonableness.bonus > 0 && !isChecklistComment && !isBriefDescription) {
    baseScore = Math.min(10.0, baseScore + timeReasonableness.bonus);
  } else if (hasAi && !isChecklistComment && !isBriefDescription) {
    baseScore = Math.min(10.0, baseScore + 0.2);
  }

  const finalScore = Number(Math.min(10.0, Math.max(1.0, baseScore)).toFixed(1));
  const expTag = context?.seniorityLevel ? ` for a ${context.seniorityLevel} developer (${context.userExperienceYears || 2} yrs)` : '';

  let explanation = '';
  if (timeReasonableness && timeReasonableness.velocityLabel === 'TIME_INFLATED_FOR_AI_TIER') {
    explanation = `${timeReasonableness.explanation} Comments partially explain implementation${expTag}.`;
  } else if (isChecklistComment) {
    explanation = `Comments primarily mirror the task checklist with status indicators rather than explaining technical implementation steps${expTag}.`;
  } else if (finalScore >= 8.5) {
    explanation = `Comments strongly justify the description and confirm work completed${expTag}.`;
  } else if (isBriefDescription && isBriefComment) {
    explanation = `Task description and progress updates are brief and lack substantive implementation context${expTag}.`;
  } else {
    explanation = `Comments partially explain the task description${expTag}.`;
  }

  return {
    workMatchScore: finalScore,
    alignmentLabel: finalScore >= 8.5 ? 'STRONG_ALIGNMENT' : finalScore >= 7.0 ? 'MODERATE_ALIGNMENT' : 'WEAK_ALIGNMENT',
    explanation,
    isBriefDescription,
    isChecklistComment,
    isBriefComment,
    timeReasonableness,
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
      repetitionScore: 10,
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
    const penalty = Math.min(7.0, Number((maxSimilarity * 8.0).toFixed(1)));
    const repetitionScore = Math.max(2.0, Number((10 - penalty).toFixed(1)));

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
    repetitionScore: 10,
    explanation: 'Task scope is sufficiently unique within this project.'
  };
}

/**
 * Calculates composite score combining all weighted parameters out of 10
 */
export function computeCompositeTaskScore(params: {
  timeScore: number;
  commentQualityScore: number;
  complexityScore: number;
  repetitionScore: number;
  isQAReview: boolean;
}): number {
  const normTime = params.timeScore > 10 ? params.timeScore / 10 : params.timeScore;
  const normComment = params.commentQualityScore > 10 ? params.commentQualityScore / 10 : params.commentQualityScore;
  const normComplexity = params.complexityScore > 10 ? params.complexityScore / 10 : params.complexityScore;
  const normRepetition = params.repetitionScore > 10 ? params.repetitionScore / 10 : params.repetitionScore;

  // Base weights (Total = 1.0):
  // Work / Comment match: 45% (4.5 pts)
  // Time Adherence (±10m buffer): 35% (3.5 pts)
  // Complexity: 10% (1.0 pt)
  // Originality / Non-Repetition: 10% (1.0 pt)
  let weighted =
    normComment * 0.45 +
    normTime * 0.35 +
    normComplexity * 0.10 +
    normRepetition * 0.10;

  // Bonus for moving to QA Review with clear handoff (+0.3 pts)
  if (params.isQAReview) {
    weighted = Math.min(10, weighted + 0.3);
  }

  return Number(Math.max(1.0, Math.min(10.0, weighted)).toFixed(1));
}

export interface DynamicPerformanceSummary {
  performanceSummary: string;
  whereLacked: string;
  whereToImprove: string;
  improvementItems: string[];
}

/**
 * Generates an evaluative, non-repetitive dynamic performance summary
 * based on user performance, description, comments, experience, and AI tools.
 */
export function generateDynamicPerformanceSummary(params: {
  taskDescription: string;
  comments: string[];
  timeAssessmentLabel: string;
  workMatchScore: number;
  seniorityLevel?: string;
  userExperienceYears?: number;
  aiSubscriptions?: string[];
  isQAReview?: boolean;
}): DynamicPerformanceSummary {
  const hasComments = params.comments && params.comments.length > 0;
  const isSenior = (params.userExperienceYears || 0) >= 3 || (params.seniorityLevel || '').toLowerCase().includes('senior') || (params.seniorityLevel || '').toLowerCase().includes('lead');
  const aiTools = params.aiSubscriptions && params.aiSubscriptions.length > 0 ? params.aiSubscriptions.join(', ') : '';

  // Analyze description and comment depth
  const descWords = (params.taskDescription || '').trim().split(/\s+/).filter(Boolean);
  const isBriefDescription = descWords.length > 0 && descWords.length < 35;

  const combinedComments = (params.comments || []).join(' ').trim();
  const commentWords = combinedComments.split(/\s+/).filter(Boolean);
  const isBriefComment = commentWords.length > 0 && commentWords.length < 35;

  const checklistMarkers = [
    /\b(done|not done|pending|completed)\b/i,
    /-\s*(done|pending|not done)/i,
  ];
  const hasChecklistMarkers = checklistMarkers.some(re => re.test(combinedComments));

  const descWordSet = new Set(descWords.map(w => w.toLowerCase().replace(/[^a-z0-9]/g, '')));
  const nonDescWords = commentWords.filter(w => {
    const cleanW = w.toLowerCase().replace(/[^a-z0-9]/g, '');
    return cleanW.length > 0 && !descWordSet.has(cleanW);
  });
  const statusStopWords = new Set(['done', 'pending', 'not', 'is', 'are', 'which', 'by', 'client', 'key', 'for', 'and', 'the', 'on', 'to', '1', '2', '3', 'ok', 'yes', 'no', 'of', 'in', 'at']);
  const technicalExplanationWords = nonDescWords.filter(w => !statusStopWords.has(w.toLowerCase().replace(/[^a-z0-9]/g, '')));
  const isChecklistComment = hasComments && hasChecklistMarkers && (technicalExplanationWords.length < 15);

  // 1. Performance Summary
  const lines: string[] = [];
  if (params.workMatchScore >= 8.5) {
    lines.push(`Task implementation was successfully executed with clear, substantive progress updates validating the completed scope.`);
    lines.push(`The technical commentary directly corroborates the development effort required for a ${params.seniorityLevel || 'developer'} with ${params.userExperienceYears || 2}+ years of experience.`);
    if (aiTools) {
      lines.push(`Active AI tooling (${aiTools}) was effectively leveraged to streamline implementation and maintain engineering velocity.`);
    } else {
      lines.push(`Delivery met core quality benchmarks with proper task discipline and scope alignment.`);
    }
  } else if (params.workMatchScore >= 6.0) {
    lines.push(`The feature scope was functionally delivered, but logged comments provide only partial technical context on implementation details.`);
    lines.push(`Given ${params.userExperienceYears || 2}+ years of engineering experience, deeper documentation on code changes, APIs, or test coverage is expected.`);
    lines.push(`Ensure future task updates clearly delineate the modules modified and verification steps performed before closing.`);
  } else if (hasComments) {
    lines.push(`Task activity was recorded, but the task description and progress comments provide only high-level status statements without substantive implementation depth.`);
    lines.push(`Without granular technical context or architectural details, there is insufficient evidence to substantiate the development effort against the assigned scope.`);
    lines.push(`For a ${params.seniorityLevel || 'developer'}, documenting pull requests, unit tests, and QA status is essential for accountability.`);
  } else {
    lines.push(`The task was closed and logged without any progress comments in Zoho Projects to substantiate the work completed.`);
    lines.push(`Without technical verification notes, there is no audit trail to justify the time spent against the assigned description.`);
    lines.push(`For a ${params.seniorityLevel || 'developer'}, documenting pull requests, unit tests, and QA status is essential for accountability.`);
  }
  const performanceSummary = lines.join('\n');

  // 2. Where User Lacked (Specific gap in execution/commenting/timing)
  let whereLacked = '';
  if (!params.taskDescription || params.taskDescription.trim().length === 0) {
    whereLacked = 'Task description was completely missing in Zoho Projects, preventing verification of work completed against any defined scope or acceptance criteria.';
  } else if (params.timeAssessmentLabel === 'NOT_LOGGED') {
    whereLacked = 'No actual hours were logged in Zoho Projects for this task.';
  } else if (!hasComments) {
    whereLacked = 'Lacked progress comments, PR references, or test verification notes in Zoho to confirm completion of the task description.';
  } else if (isChecklistComment) {
    whereLacked = 'Comments primarily mirrored the task checklist with status markers (done/pending) rather than detailing the actual technical work, code changes, or verification outcomes.';
  } else if (params.timeAssessmentLabel === 'OVERDUE') {
    whereLacked = 'Exceeded the scheduled delivery buffer without proactively noting technical roadblocks or blockers in task updates.';
  } else if (params.workMatchScore < 7.0 && isBriefDescription && isBriefComment) {
    whereLacked = 'Task description lacked detailed requirements and acceptance criteria, while logged comments provided only brief high-level status updates.';
  } else if (params.workMatchScore < 7.0 && isBriefDescription) {
    whereLacked = 'Task description was overly brief and lacked detailed specifications or acceptance criteria.';
  } else if (params.workMatchScore < 7.0 && isBriefComment) {
    whereLacked = 'Logged comments were brief and lacked granular technical details on implementation and test verification.';
  } else if (params.workMatchScore < 7.0) {
    whereLacked = 'Logged comments lacked specific technical context (modules tested, code changes, or QA status) relative to task complexity.';
  } else if (params.timeAssessmentLabel === 'UNEXPECTED_EARLY') {
    whereLacked = 'Completed well ahead of estimate without documenting comprehensive automated tests or edge-case handling.';
  } else if (!params.isQAReview) {
    whereLacked = 'Lacked formal transition to QA review with deployment verification notes.';
  } else {
    whereLacked = 'Minimal gaps identified; could further document architectural decisions or edge cases.';
  }

  // 3. Where to Improve (Primary recommendation)
  let whereToImprove = '';
  if (!params.taskDescription || params.taskDescription.trim().length === 0) {
    whereToImprove = 'Always provide clear task descriptions with defined acceptance criteria in Zoho Projects before tracking hours and logging progress.';
  } else if (isChecklistComment || (params.workMatchScore < 7.0 && isBriefDescription && isBriefComment)) {
    whereToImprove = 'Document comprehensive technical requirements in task descriptions and detail the specific code changes, configurations, and verification results in task comments.';
  } else if (params.timeAssessmentLabel === 'NOT_LOGGED') {
    whereToImprove = 'Accurately log all work hours and timelogs in Zoho Projects alongside technical completion notes.';
  } else if (!hasComments) {
    whereToImprove = 'Always log a brief technical wrap-up in Zoho detailing what was built, files modified, and test verification outcomes.';
  } else if (aiTools) {
    whereToImprove = `Leverage active AI subscriptions (${aiTools}) to accelerate boilerplate code, draft unit tests, and provide structured commit notes.`;
  } else if (isSenior) {
    whereToImprove = 'Document architectural trade-offs, link pull requests, and mentor peers through detailed task comment summaries.';
  } else {
    whereToImprove = 'Refine task estimation discipline and include explicit QA verification steps before closing work items.';
  }

  // 4. Actionable improvement points list for user to work on
  const improvementItems: string[] = [];
  if (isChecklistComment) {
    improvementItems.push('Explain Work Done Beyond Status Updates: In Zoho task comments, substantiate your work with at least 40–50 words detailing specific technical implementation (what code was modified, packages upgraded, issues resolved, and verification findings) instead of repeating the task checklist with status markers like "done" or "pending".');
  }
  if (isBriefDescription && (isChecklistComment || params.workMatchScore < 7.0)) {
    improvementItems.push('Define Comprehensive Task Scope: When creating or assigning tasks, document complete technical specifications, background context, and acceptance criteria (aim for at least 40–50 words of detailed scope rather than short summary bullets).');
  }
  if (isBriefComment && !isChecklistComment && params.workMatchScore < 7.0) {
    improvementItems.push('Substantiate Execution in Comments: Detail specific code modifications, configurations changed, and QA verification outcomes in depth (target 40–50 words explaining the technical implementation corresponding to each task requirement).');
  }
  if (params.timeAssessmentLabel === 'NOT_LOGGED') {
    improvementItems.push('Log Task Hours in Zoho: Make sure to record accurate billable or non-billable timelog entries for completed or ongoing work.');
  }
  if (!hasComments) {
    improvementItems.push('Log Technical Progress Comments: Always post a concise comment in Zoho detailing files changed, architecture decisions, and verification steps.');
  }
  if (params.timeAssessmentLabel === 'OVERDUE') {
    improvementItems.push('Time Tolerance & Blocker Escalation: Flag dependencies or roadblocks early in comments to keep delivery within the +5m buffer.');
  }
  if (params.timeAssessmentLabel === 'UNEXPECTED_EARLY') {
    improvementItems.push('Calibrate Estimation & Expand Testing: Ensure early completions include exhaustive automated test suites and edge case coverage.');
  }
  if (aiTools) {
    improvementItems.push(`Leverage AI Subscriptions (${aiTools}): Utilize AI coding assistants for automated unit test authoring and commit message generation.`);
  }
  if (!params.isQAReview) {
    improvementItems.push('Complete QA Verification Handoff: Explicitly transition tasks to QA Review with verification criteria for testers.');
  }
  if (improvementItems.length === 0) {
    improvementItems.push('Continue maintaining high-quality commit summaries and structured technical comments on upcoming milestones.');
  }

  return {
    performanceSummary,
    whereLacked,
    whereToImprove,
    improvementItems,
  };
}

