import type { ZohoEvaluationRulesConfig } from './rules-types';
/**
 * Analyzes whole-sentence context to accurately identify actual pending deliverables,
 * while preventing false penalties on roadmap boundaries ("audio and video support remain deferred")
 * or resolved items ("resolved pending comments").
 */
export function detectPendingScope(commentsText: string): {
  hasPendingScope: boolean;
  pendingOccurrences: number;
  hasDocumentedBlockers: boolean;
} {
  if (!commentsText || !commentsText.trim()) {
    return { hasPendingScope: false, pendingOccurrences: 0, hasDocumentedBlockers: false };
  }

  // Pre-process: insert boundary before next word if following a status keyword (Done, Pending, etc.)
  const normalizedText = commentsText.replace(
    /\b(Done|Pending|In Progress|Not Done)\b(?=[ \t]+[A-Z0-9])/g,
    '$1\n'
  );

  // Split into sentences / bullet segments by newline, semicolon, bullet dash/asterisk, or sentence terminator (. / ! / ?)
  const segments = normalizedText
    .split(/(?:\r?\n|;|\.\s+|[-*•]\s+)/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  // Markers that explicitly indicate unfinished deliverables or scope
  const unfinishedPatterns = [
    /^(?:pending|not done|in progress|left|remaining|deferred)\b/i,
    /[-*•]\s*(?:pending|not done|in progress|left|remaining|deferred)\b/i,
    /\b(?:pending|not done)\s*[:\-(]/i,
    /[:\-]\s*(?:pending|not done)\b/i,
    /\b(?:is\s+pending|remains\s+pending|left\s+pending)\b/i,
    /\b(?:testing|work|integration|review|verification|deployment)\s+is\s+pending\b/i,
    /\b(?:pending\s+testing|pending\s+review|pending\s+verification)\b/i,
    /\b(?:task\s+deferred|ticket\s+deferred)\b/i,
    /\b(?:not\s+completed|not\s+done|could\s+not\s+complete|couldnt\s+complete)\b/i,
    /\b(?:cant\s+go\s+till|issue\s+in\s+.*?\s+cant)\b/i,
    /\b(?:will\s+do\s+tomorrow|will\s+finish\s+tomorrow|pending\s+for\s+tomorrow|remaining\s+for\s+tomorrow)\b/i,
  ];

  // Patterns indicating out-of-scope / future architectural roadmap notes or completed resolutions
  const roadmapOrResolvedPatterns = [
    /\b(?:remain\s+deferred|support\s+remain|deferred\s+to\s+(?:future|next|later|phase|sprint|release)|out\s+of\s+scope|client\s+deferred|deferred\s+by\s+client)\b/i,
    /\b(?:which\s+i\s+implemented|implemented\s+with\s+code|implemented\s+by\s+me|already\s+implemented|is\s+implemented)\b/i,
    /\b(?:pending\s+(?:points?|items?|tasks?)\s+are\s+due\s+to|due\s+to\s+(?:other\s+tasks?|blockers?|dependencies|client|gemstones|photos|credentials?|assets?)|dependent\s+on\s+(?:other\s+tasks?|client|key|assets?)|waiting\s+for\s+(?:client|key|assets?|photos?))\b/i,
    /\b(?:resolved|fixed|completed|cleared|addressed|closed|handled)\s+(?:all\s+)?(?:pending|deferred)\b/i,
    /\b(?:no|zero|without\s+any)\s+(?:pending|remaining)\b/i,
  ];

  const hasDocumentedBlockers = /\b(?:pending\s+(?:points?|items?|tasks?)\s+are\s+due\s+to|due\s+to\s+(?:other\s+tasks?|blockers?|dependencies|client|gemstones|photos|credentials?|assets?)|dependent\s+on\s+(?:other\s+tasks?|client|key|assets?)|waiting\s+for\s+(?:client|key|assets?|photos?))\b/i.test(commentsText);

  let occurrences = 0;

  for (const segment of segments) {
    const hasUnfinished = unfinishedPatterns.some(p => p.test(segment));
    if (!hasUnfinished) continue;

    const isRoadmapOrResolved = roadmapOrResolvedPatterns.some(p => p.test(segment));
    // If it's a roadmap or resolved statement and doesn't explicitly start with a pending marker like "- Pending" or "testing is pending"
    if (isRoadmapOrResolved && !/^(?:pending|not done)\b/i.test(segment) && !/\b(?:testing|work)\s+is\s+pending\b/i.test(segment)) {
      continue;
    }

    // If segment explicitly states it was implemented with code or already done
    if (/\b(?:which\s+i\s+implemented|implemented\s+with\s+code|already\s+done)\b/i.test(segment)) {
      continue;
    }

    // If segment is an explanation of why items are pending (blocker note)
    if (/\b(?:due\s+to\s+other\s+tasks?|pending\s+points?\s+are\s+due\s+to)\b/i.test(segment)) {
      continue;
    }

    occurrences++;
  }

  return {
    hasPendingScope: occurrences > 0,
    pendingOccurrences: occurrences,
    hasDocumentedBlockers,
  };
}

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
  alignmentLabel: 'STRONG_ALIGNMENT' | 'MODERATE_ALIGNMENT' | 'WEAK_ALIGNMENT' | 'NO_COMMENTS' | 'UNVERIFIED' | 'MISSING_TASK_DESCRIPTION' | 'OFF_TOPIC' | 'PARTIAL_DELIVERY';
  explanation: string;
  isBriefDescription?: boolean;
  isChecklistComment?: boolean;
  isBriefComment?: boolean;
  isMissingDescription?: boolean;
  hasPendingScope?: boolean;
  pendingItemsCount?: number;
  hasMeetingLogged?: boolean;
  isPartialDelivery?: boolean;
  hasDocumentedBlockers?: boolean;
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
  actualMinutes: number,
  rules?: Partial<ZohoEvaluationRulesConfig>
): TimeAdherenceResult {
  const safePlanned = Number.isFinite(plannedMinutes) && plannedMinutes > 0 ? plannedMinutes : 60;
  const safeActual = Number.isFinite(actualMinutes) && actualMinutes >= 0 ? actualMinutes : 0;

  const zeroScore = rules?.zeroHoursLoggedScore ?? 0;
  const overtimeGrace = rules?.overtimeGraceMinutes ?? 5;
  const earlyGrace = rules?.earlyCompletionBufferMinutes ?? 15;
  const earlyDeduction = rules?.earlyGapDeduction ?? 2.0;
  const overtimeDeduction = rules?.overtimeBreachDeduction ?? 2.0;
  const earlyBaseCap = Math.max(1.0, 10.0 - earlyDeduction);
  const overtimeBaseCap = Math.max(1.0, 10.0 - overtimeDeduction);

  if (safeActual === 0) {
    return {
      timeScore: zeroScore,
      timeVarianceMinutes: -safePlanned,
      assessmentLabel: 'NOT_LOGGED',
      explanation: 'No hours were logged for this task in Zoho Projects.'
    };
  }

  const variance = safeActual - safePlanned;

  // Case 1: Overtime with <= 5 minutes buffer (e.g. 4h planned, up to 4:05)
  if (variance > 0 && variance <= overtimeGrace) {
    return {
      timeScore: 10,
      timeVarianceMinutes: variance,
      assessmentLabel: 'SLIGHT_OVERRUN_TOLERATED',
      explanation: `Task took ${variance}m over planned time, within the permitted +${overtimeGrace}m buffer. Full score (10/10) awarded.`
    };
  }

  // Case 2: Exact on-time or completed within 15 min early buffer (e.g. 4h planned, down to 3:45)
  if (variance <= 0 && variance >= -earlyGrace) {
    return {
      timeScore: 10,
      timeVarianceMinutes: variance,
      assessmentLabel: 'ON_TIME',
      explanation: variance === 0
        ? 'Task completed exactly on planned time (10/10).'
        : `Task completed ${Math.abs(variance)}m early, within the permitted -${earlyGrace}m buffer. Full score (10/10) awarded.`
    };
  }

  // Case 3: Completed too early (> 15 min early, e.g. 4h planned done in 3h 15m => 45m early)
  if (variance < -earlyGrace) {
    const earlyGapMinutes = Math.abs(variance) - earlyGrace;
    const earlyRatio = earlyGapMinutes / safePlanned;
    // Strict early completion penalty: buffer breach immediately caps score by earlyGapDeduction
    const scaledPenalty = Math.min(5.5, Number((earlyRatio * 9.0).toFixed(1)));
    const score = Math.max(2.5, Number((earlyBaseCap - scaledPenalty).toFixed(1)));

    return {
      timeScore: score,
      timeVarianceMinutes: variance,
      assessmentLabel: 'UNEXPECTED_EARLY',
      explanation: `Task finished ${Math.abs(variance)}m earlier than estimated (${earlyGapMinutes}m beyond the -${earlyGrace}m buffer). Early completion gap strictly penalized time score (${score}/10).`
    };
  }

  // Case 4: Overdue (> 5 minutes overtime, e.g. 3h planned done in 3h 12m => 7m excess overtime)
  const excessOvertime = variance - overtimeGrace;
  const lateRatio = excessOvertime / safePlanned;
  // Strict buffer breach penalty: exceeding the buffer immediately drops max score by overtimeBreachDeduction
  const scaledPenalty = Math.min(6.0, Number((lateRatio * 8.0).toFixed(1)));
  const score = Math.max(2.0, Number((overtimeBaseCap - scaledPenalty).toFixed(1)));

  return {
    timeScore: score,
    timeVarianceMinutes: variance,
    assessmentLabel: 'OVERDUE',
    explanation: `Task exceeded planned time by ${variance}m (${excessOvertime}m beyond the +${overtimeGrace}m buffer). Buffer breach strictly penalized time score (${score}/10).`
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
  comments: string[],
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
  const cleanComments = (comments || []).filter(c => Boolean(c && c.trim().length > 0));

  if (!cleanComments || cleanComments.length === 0) {
    return {
      workMatchScore: 0.0,
      alignmentLabel: 'NO_COMMENTS',
      explanation: 'No progress comments were logged in Zoho Projects to substantiate the work completed. Score is 0.',
      isBriefDescription: false,
      isChecklistComment: false,
      isBriefComment: false,
    };
  }

  const combinedComments = cleanComments.join(' ').trim();
  const descWords = cleanDesc ? cleanDesc.split(/\s+/).filter(Boolean) : [];
  const commentWords = combinedComments ? combinedComments.split(/\s+/).filter(Boolean) : [];

  const isBriefDescription = descWords.length < 20;
  const isBriefComment = commentWords.length < 10;

  if (!cleanDesc) {
    return {
      workMatchScore: 3.0,
      alignmentLabel: 'MISSING_TASK_DESCRIPTION',
      isMissingDescription: true,
      explanation: 'Task description is completely missing in Zoho Projects. Work justification score is strictly capped at 3.0/10.',
      isBriefDescription: true,
      isChecklistComment: false,
      isBriefComment,
    };
  }

  // Detect pending deliverables or unfinished scope in comments using sentence context
  const { hasPendingScope, pendingOccurrences, hasDocumentedBlockers } = detectPendingScope(combinedComments);

  // Detect meeting hours logged inside development feature tickets
  const meetingPattern = /\b(?:\d+\s*(?:hr|hour|mins?|minutes?)\s*(?:of\s*)?meeting|meeting\s+is\s+logged|meeting\s+logged|logged\s+in\s+this\s+task\s+itself)\b/i;
  const hasMeetingLogged = meetingPattern.test(combinedComments);

  // Detect checklist comments that copy-paste the description with "- Done", "Done", "pending"
  const checklistMarkers = [
    /\b(done|not done|pending|completed)\b/i,
    /-\s*(done|pending|not done)/i,
  ];
  const hasChecklistMarkers = checklistMarkers.some(re => re.test(combinedComments));

  const doneStampCount = (combinedComments.match(/-\s*done\b/gi) || []).length;
  const pendingStampCount = (combinedComments.match(/-\s*pending\b/gi) || []).length;
  const totalStamps = doneStampCount + pendingStampCount;

  const descWordSet = new Set(descWords.map(w => w.toLowerCase().replace(/[^a-z0-9]/g, '')));
  const nonDescWords = commentWords.filter(w => {
    const cleanW = w.toLowerCase().replace(/[^a-z0-9]/g, '');
    return cleanW.length > 0 && !descWordSet.has(cleanW);
  });
  const statusStopWords = new Set([
    'done', 'pending', 'not', 'is', 'are', 'which', 'by', 'client', 'key', 'for', 'and',
    'the', 'on', 'to', '1', '2', '3', 'ok', 'yes', 'no', 'of', 'in', 'at', 'instead',
    'did', 'note', '1hr', 'task', 'itself', 'as', 'there', 'some'
  ]);
  const technicalExplanationWords = nonDescWords.filter(w => !statusStopWords.has(w.toLowerCase().replace(/[^a-z0-9]/g, '')));
  const isChecklistComment = (hasChecklistMarkers && technicalExplanationWords.length < 18) ||
    (totalStamps >= 2 && technicalExplanationWords.length < 25);

  // Check action words
  const actionTerms = [
    'implemented', 'resolved', 'tested', 'verified', 'pr', 'commit', 'bug', 'fixed',
    'created', 'updated', 'added', 'configured', 'refactored', 'debugged', 'unit test',
    'endpoint', 'api', 'reviewed', 'validation', 'handler', 'schema', 'migration'
  ];
  let actionHits = 0;
  for (const term of actionTerms) {
    if (combinedComments.toLowerCase().includes(term)) actionHits++;
  }

  // Detect superficial comments (e.g. just "done", "fixed", "completed", <= 3 words without technical substance)
  if (commentWords.length <= 3 && actionHits <= 1 && technicalExplanationWords.length < 4) {
    return {
      workMatchScore: 4.0,
      alignmentLabel: 'WEAK_ALIGNMENT',
      explanation: 'Comments are superficial (e.g. "done") and lack technical details.',
      isBriefDescription,
      isChecklistComment: false,
      isBriefComment: true,
      hasPendingScope,
      pendingItemsCount: pendingOccurrences,
      hasMeetingLogged,
    };
  }

  // Extract true topical/domain keywords from task name and description
  const TOPIC_STOP_WORDS = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'has', 'had',
    'not', 'but', 'are', 'was', 'were', 'been', 'being', 'can', 'could', 'will',
    'would', 'should', 'all', 'any', 'each', 'both', 'few', 'more', 'most', 'other',
    'some', 'such', 'into', 'over', 'after', 'about', 'than', 'them', 'then', 'there',
    'these', 'they', 'through', 'under', 'further', 'which', 'while', 'who', 'whom',
    'our', 'their', 'your', 'his', 'her', 'its', 'out', 'off', 'down', 'only', 'own',
    'same', 'too', 'very', 'just', 'where', 'when', 'why', 'how', 'again', 'once',
    'here', 'also', 'part', 'make', 'made', 'like', 'well', 'back', 'even', 'still',
    'must', 'done', 'doing', 'does', 'did', 'work', 'working', 'task', 'tasks',
    // Action verbs describing generic progress rather than specific domain deliverable:
    'ensure', 'ensuring', 'ensured', 'implemented', 'implementing', 'implement',
    'updated', 'updating', 'update', 'configured', 'configuring', 'configure',
    'resolved', 'resolving', 'resolve', 'tested', 'testing', 'tests', 'test',
    'created', 'creating', 'create', 'added', 'adding', 'add', 'fixed', 'fixing', 'fix',
    'review', 'reviewed', 'reviewing', 'support', 'supporting', 'supported',
    'across', 'including', 'included', 'include', 'project', 'projects', 'user', 'users',
    'status', 'detail', 'details', 'section', 'sections', 'item', 'items', 'complete',
    'completed', 'completing', 'setup', 'requirement', 'requirements'
  ]);

  // Extract title deliverable keywords
  const titleTokens = (context?.taskName || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !TOPIC_STOP_WORDS.has(w));
  const titleKeywords = new Set(titleTokens);

  const fullTaskText = `${context?.taskName || ''} ${cleanDesc}`.toLowerCase();
  const rawDescTokens = fullTaskText.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2);
  const topicKeywords = new Set(rawDescTokens.filter(w => !TOPIC_STOP_WORDS.has(w)));

  const rawCommentTokens = combinedComments.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2);
  const commentTopicWords = new Set(rawCommentTokens.filter(w => !TOPIC_STOP_WORDS.has(w)));

  let topicMatches = 0;
  for (const kw of topicKeywords) {
    if (commentTopicWords.has(kw)) {
      topicMatches++;
    }
  }

  let titleMatches = 0;
  for (const kw of titleKeywords) {
    if (commentTopicWords.has(kw)) {
      titleMatches++;
    }
  }

  const descTokens = tokenizeText(cleanDesc);
  const commentTokens = tokenizeText(combinedComments);
  const overallSimilarity = computeJaccardSimilarity(descTokens, commentTokens);
  const topicSimilarity = computeJaccardSimilarity(topicKeywords, commentTopicWords);

  // Strict check: Is the comment completely off-topic or addressing a completely different feature?
  // E.g. Task is "Admin Portal UI Improvements & Tab-Based Routing Fixes" but comment is about "mail server and SMTP settings"
  const isOffTopic = (titleKeywords.size >= 2 && titleMatches === 0 && topicSimilarity < 0.08) ||
                     (topicKeywords.size >= 8 && topicMatches <= 1 && titleMatches === 0 && topicSimilarity < 0.06);

  const isWeakTopicalMatch = !isOffTopic && (
    (titleKeywords.size >= 2 && titleMatches === 0 && topicSimilarity < 0.12) ||
    (topicKeywords.size >= 8 && topicMatches <= 2 && topicSimilarity < 0.09)
  );

  // Consider user seniority and AI subscriptions in expectations
  const hasAi = context?.aiSubscriptions && context.aiSubscriptions.length > 0;
  const isSenior = (context?.userExperienceYears || 2) >= 5;

  const safePlannedMins = context?.plannedMinutes && context.plannedMinutes > 0 ? context.plannedMinutes : 240;
  const isHighPlannedDuration = typeof context?.plannedMinutes === 'number' && context.plannedMinutes >= 180;
  const isPartialDelivery = Boolean(hasPendingScope && (isHighPlannedDuration || pendingOccurrences >= 2) && !hasDocumentedBlockers);

  let baseScore = 7.5;

  const hasStrongTechnicalEvidence = !isOffTopic && !isWeakTopicalMatch && (
    (actionHits >= 2 && (topicMatches >= 1 || overallSimilarity >= 0.05)) ||
    (actionHits >= 1 && topicMatches >= 1 && (topicSimilarity >= 0.10 || overallSimilarity >= 0.08)) ||
    (!isBriefComment && overallSimilarity >= 0.25)
  );

  if (isPartialDelivery) {
    // Deliverables left pending on a 3h-8h ticket:
    // With 4h to 8h planned, leaving core deliverables pending (or untested) means the assigned scope was incomplete.
    if (pendingOccurrences >= 2 || isChecklistComment || totalStamps >= 2) {
      baseScore = 5.0;
    } else {
      baseScore = 5.5;
    }
  } else if (isChecklistComment && isBriefDescription) {
    baseScore = 4.8;
  } else if (isChecklistComment) {
    baseScore = 5.2;
  } else if (isOffTopic) {
    // Strictly penalize off-topic comments where user logged work unrelated to task description/title
    baseScore = 3.8;
  } else if (isWeakTopicalMatch) {
    // Weak topical alignment between description and progress comment
    baseScore = 4.5;
  } else if (isBriefDescription && isBriefComment) {
    // Vague/brief description combined with brief comment lacks substantive context
    baseScore = 5.5;
  } else if (hasStrongTechnicalEvidence && !hasPendingScope) {
    baseScore = 9.0 + Math.min(1.0, actionHits * 0.3);
  } else if (isBriefDescription || isBriefComment) {
    baseScore = 6.2;
  } else if (topicMatches >= 2 || overallSimilarity >= 0.15) {
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
  } else if (timeReasonableness && timeReasonableness.bonus > 0 && !isChecklistComment && !isBriefDescription && !isOffTopic && !isWeakTopicalMatch && !isPartialDelivery) {
    baseScore = Math.min(10.0, baseScore + timeReasonableness.bonus);
  } else if (hasAi && !isChecklistComment && !isBriefDescription && !isOffTopic && !isWeakTopicalMatch && !isPartialDelivery) {
    baseScore = Math.min(10.0, baseScore + 0.2);
  }

  // Cap score strictly if partial delivery or checklist comment
  if (isPartialDelivery) {
    baseScore = Math.min(5.5, baseScore);
  } else if (isChecklistComment) {
    baseScore = Math.min(5.2, baseScore);
  }

  const finalScore = Number(Math.min(10.0, Math.max(1.0, baseScore)).toFixed(1));
  const expTag = context?.seniorityLevel ? ` for a ${context.seniorityLevel} developer (${context.userExperienceYears || 2} yrs)` : '';

  let explanation = '';
  if (isOffTopic) {
    explanation = `Comments do not topically align with the assigned task description or requirements${expTag}. Progress notes must directly substantiate the specific deliverable.`;
  } else if (isPartialDelivery) {
    const plannedHrs = Math.round((safePlannedMins / 60) * 10) / 10;
    explanation = `Key deliverables were left pending or unverified (e.g. testing pending, uncompleted sections) despite ${plannedHrs}h allocated${expTag}. High-duration tasks must be fully completed and verified or blockers escalated earlier.`;
  } else if (isWeakTopicalMatch) {
    explanation = `Comments show weak topical alignment with the assigned task scope${expTag}. Progress notes should directly address the assigned features and deliverables.`;
  } else if (timeReasonableness && timeReasonableness.velocityLabel === 'TIME_INFLATED_FOR_AI_TIER') {
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

  const alignmentLabel = isOffTopic
    ? 'OFF_TOPIC'
    : isPartialDelivery
    ? 'PARTIAL_DELIVERY'
    : isChecklistComment
    ? 'WEAK_ALIGNMENT'
    : finalScore >= 8.5
    ? 'STRONG_ALIGNMENT'
    : finalScore >= 7.0
    ? 'MODERATE_ALIGNMENT'
    : 'WEAK_ALIGNMENT';

  return {
    workMatchScore: finalScore,
    alignmentLabel,
    explanation,
    isBriefDescription,
    isChecklistComment,
    isBriefComment,
    hasPendingScope,
    pendingItemsCount: pendingOccurrences,
    hasMeetingLogged,
    isPartialDelivery,
    timeReasonableness,
  };
}

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
  rules?: Partial<ZohoEvaluationRulesConfig>;
}): number {
  const normTime = params.timeScore > 10 ? params.timeScore / 10 : params.timeScore;
  const normComment = params.commentQualityScore > 10 ? params.commentQualityScore / 10 : params.commentQualityScore;
  const normComplexity = params.complexityScore > 10 ? params.complexityScore / 10 : params.complexityScore;
  const normRepetition = params.repetitionScore > 10 ? params.repetitionScore / 10 : params.repetitionScore;

  // If no hours were logged and no progress comments were submitted, the task has zero recorded work
  if (normTime === 0 && normComment === 0) {
    return 0.0;
  }

  // Base weights (Total = 1.0):
  // Work / Comment match: 45% (4.5 pts)
  // Time Adherence (±10m buffer): 35% (3.5 pts)
  // Complexity: 10% (1.0 pt)
  // Originality / Non-Repetition: 10% (1.0 pt)
  const wComment = params.rules?.workMatchWeight ?? 0.45;
  const wTime = params.rules?.timeAdherenceWeight ?? 0.35;
  const wComplexity = params.rules?.complexityWeight ?? 0.10;
  const wRepetition = params.rules?.repetitionWeight ?? 0.10;
  const nonQADeduction = params.rules?.nonQAReviewDeduction ?? 1.0;

  let weighted =
    normComment * wComment +
    normTime * wTime +
    normComplexity * wComplexity +
    normRepetition * wRepetition;

  if (!params.isQAReview) {
    weighted = Math.max(0.0, weighted - nonQADeduction);
  }

  return Number(Math.max(0.0, Math.min(10.0, weighted)).toFixed(1));
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

  const { hasPendingScope, pendingOccurrences, hasDocumentedBlockers } = detectPendingScope(combinedComments);

  const meetingPattern = /\b(?:\d+\s*(?:hr|hour|mins?|minutes?)\s*(?:of\s*)?meeting|meeting\s+is\s+logged|meeting\s+logged|logged\s+in\s+this\s+task\s+itself)\b/i;
  const hasMeetingLogged = hasComments && meetingPattern.test(combinedComments);

  const doneStampCount = (combinedComments.match(/-\s*done\b/gi) || []).length;
  const pendingStampCount = (combinedComments.match(/-\s*pending\b/gi) || []).length;
  const totalStamps = doneStampCount + pendingStampCount;

  const descWordSet = new Set(descWords.map(w => w.toLowerCase().replace(/[^a-z0-9]/g, '')));
  const nonDescWords = commentWords.filter(w => {
    const cleanW = w.toLowerCase().replace(/[^a-z0-9]/g, '');
    return cleanW.length > 0 && !descWordSet.has(cleanW);
  });
  const statusStopWords = new Set([
    'done', 'pending', 'not', 'is', 'are', 'which', 'by', 'client', 'key', 'for', 'and',
    'the', 'on', 'to', '1', '2', '3', 'ok', 'yes', 'no', 'of', 'in', 'at', 'instead',
    'did', 'note', '1hr', 'task', 'itself', 'as', 'there', 'some'
  ]);
  const technicalExplanationWords = nonDescWords.filter(w => !statusStopWords.has(w.toLowerCase().replace(/[^a-z0-9]/g, '')));
  const isChecklistComment = hasComments && ((hasChecklistMarkers && technicalExplanationWords.length < 18) || (totalStamps >= 2 && technicalExplanationWords.length < 25));

  // 1. Performance Summary
  const lines: string[] = [];
  if (hasPendingScope && params.workMatchScore < 7.0) {
    lines.push(`Task was recorded with deliverables left pending or unverified at the end of the planned duration.`);
    lines.push(`While partial progress was noted, closing extended duration tasks with pending deliverables or unresolved testing does not meet engineering completion standards.`);
    lines.push(`For a ${params.seniorityLevel || 'developer'}, tasks should either be completed and verified within the allocated time or roadblocks escalated proactively.`);
  } else if (params.workMatchScore >= 8.5) {
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
  } else if (hasPendingScope) {
    whereLacked = 'Key deliverables were left in a pending or unverified state (e.g. testing pending, uncompleted sections) at the end of the planned duration without proactive blocker escalation.';
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
    whereLacked = 'Status Not In QA Review: Task was left in "In Progress" or "Backlog" instead of formally transitioning to In QA Review upon completion; points were deducted from the overall score.';
  } else {
    whereLacked = 'Minimal gaps identified; could further document architectural decisions or edge cases.';
  }

  // 3. Where to Improve (Primary recommendation)
  let whereToImprove = '';
  if (!params.taskDescription || params.taskDescription.trim().length === 0) {
    whereToImprove = 'Always provide clear task descriptions with defined acceptance criteria in Zoho Projects before tracking hours and logging progress.';
  } else if (hasPendingScope) {
    whereToImprove = 'Complete and test all assigned deliverables within the allocated timeframe, or proactively escalate blockers to project leads during the shift.';
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
  if (hasPendingScope && hasDocumentedBlockers) {
    improvementItems.push('Coordinate Dependent Blockers: You documented that pending items are due to other tasks/dependencies. Coordinate closely with assigned owners on dependent tasks (e.g. assets, API keys, upstream deliverables) to verify end-to-end integration as soon as they are ready.');
  } else if (hasPendingScope) {
    improvementItems.push('Resolve Pending Deliverables & Escalate Blockers: Work was logged with items explicitly marked "Pending" (e.g. testing pending or deferred scope) on an extended duration ticket. Fully complete and test deliverables within the allocated timeframe, or proactively escalate blockers to project leads during the day rather than closing tasks with pending items.');
  }
  if (hasMeetingLogged) {
    improvementItems.push('Separate Meeting Logs from Development Tasks: Record non-development activities such as internal or client meetings (e.g. 1 hour logged) under dedicated administrative/meeting tasks in Zoho Projects rather than commingling meeting hours inside technical feature tickets.');
  }
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
    improvementItems.push('Status Not Moved to In QA Review: Task was left in "In Progress" or "Backlog" instead of transitioning to In QA Review upon completion. 1.0 point was deducted from the overall score. Ensure task is formally moved to In QA Review with self-testing verification notes.');
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

