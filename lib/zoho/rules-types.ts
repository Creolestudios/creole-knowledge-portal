export interface ZohoEvaluationRulesConfig {
  // 1. Status & QA Review Gate
  nonQAReviewDeduction: number; // default: 1.0 (flat points deducted if not in QA Review)

  // 2. Time Tolerance & Grace Buffers
  overtimeGraceMinutes: number; // default: 5 (mins over planned duration tolerated with 10/10)
  overtimeBreachDeduction: number; // default: 2.0 (points cut when overtime exceeds grace buffer)
  earlyCompletionBufferMinutes: number; // default: 15 (mins early tolerated with 10/10)
  earlyGapDeduction: number; // default: 2.0 (points cut when completed earlier than early buffer)
  overtime30mScore: number; // default: 9.0 (score when 15m to 30m over)
  overtime60mScore: number; // default: 8.0 (score when 31m to 60m over)
  overtime120mScore: number; // default: 6.5 (score when 61m to 120m over)
  overtimeMaxScore: number; // default: 5.0 (score when >120m over)
  zeroHoursLoggedScore: number; // default: 0.0 (score when 0 hours logged)

  // 3. Quality & Deliverable Caps
  missingCommentCap: number; // default: 0.0 (score cap when comments empty / -10 pts)
  shortCommentDeduction: number; // default: 4.8 (points deducted from score when comment is <= 10 words)
  missingDescriptionCap: number; // default: 0.0 (score cap when description empty)
  shortDescriptionDeduction: number; // default: 4.5 (points deducted from score when description <= 6 words)
  checklistCommentCap: number; // default: 5.0 (score cap when checklist comment)
  partialDeliveryCap: number; // default: 5.2 (score cap when deliverables pending)

  // 4. Composite Weights
  workMatchWeight: number; // default: 0.50 (50%)
  timeAdherenceWeight: number; // default: 0.10 (10%)
  complexityWeight: number; // default: 0.30 (30%)
  repetitionWeight: number; // default: 0.10 (10%)
}

export const DEFAULT_ZOHO_RULES: ZohoEvaluationRulesConfig = {
  nonQAReviewDeduction: 1.0,
  overtimeGraceMinutes: 5,
  overtimeBreachDeduction: 2.0,
  earlyCompletionBufferMinutes: 15,
  earlyGapDeduction: 2.0,
  overtime30mScore: 9.0,
  overtime60mScore: 8.0,
  overtime120mScore: 6.5,
  overtimeMaxScore: 5.0,
  zeroHoursLoggedScore: 0.0,
  missingCommentCap: 0.0,
  shortCommentDeduction: 4.8,
  missingDescriptionCap: 0.0,
  shortDescriptionDeduction: 4.5,
  checklistCommentCap: 5.0,
  partialDeliveryCap: 5.2,
  workMatchWeight: 0.50,
  timeAdherenceWeight: 0.10,
  complexityWeight: 0.30,
  repetitionWeight: 0.10,
};
