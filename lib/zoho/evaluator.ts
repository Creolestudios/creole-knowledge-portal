import { GoogleGenAI, Type, Schema } from '@google/genai';
import {
  calculateTimeAdherence,
  detectRepetitiveTask,
  computeCompositeTaskScore,
  TimeAdherenceResult,
  RepetitionCheckResult,
  HistoricalTask,
} from './heuristics';

export interface TaskEvaluationInput {
  taskName: string;
  taskDescription: string;
  projectName: string;
  plannedMinutes: number;
  actualMinutes: number;
  zohoStatus: string;
  isQAReview: boolean;
  comments: string[];
  userExperienceYears: number;
  seniorityLevel: string;
  aiSubscriptions: string[];
  historicalTasks?: HistoricalTask[];
}

export interface TaskEvaluationResult {
  overallScore: number;
  timeScore: number;
  commentQualityScore: number;
  complexityScore: number;
  repetitionScore: number;
  timeVarianceMinutes: number;
  timeAssessmentLabel: string;
  isRepetitive: boolean;
  repetitionSimilarityPct: number;
  matchedTaskId: string | null;
  summaryFeedback: string;
  strengths: string[];
  improvements: string[];
  aiModelUsed: string;
}

export interface DayEvaluationSummary {
  evaluationDate: string;
  totalTasks: number;
  doneTasks: number;
  qaReviewTasks: number;
  delayedTasks: number;
  totalPlannedHours: number;
  totalActualHours: number;
  dailyScore: number;
  dailySummary: string;
}

const aiEvaluationSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    commentQualityScore: {
      type: Type.INTEGER,
      description: 'Score for comments, PR notes, and QA clarity (0-100)',
    },
    complexityScore: {
      type: Type.INTEGER,
      description: 'Task complexity assessment based on scope and role (0-100)',
    },
    summaryFeedback: {
      type: Type.STRING,
      description: '2-3 sentence performance summary for this specific task',
    },
    strengths: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '1-3 key positive highlights of execution',
    },
    improvements: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '1-2 constructive improvement tips',
    },
  },
  required: [
    'commentQualityScore',
    'complexityScore',
    'summaryFeedback',
    'strengths',
    'improvements',
  ],
};

/**
 * Fallback generator when Gemini API is offline or key is unconfigured
 */
function generateHeuristicEvaluation(
  input: TaskEvaluationInput,
  timeAdherence: TimeAdherenceResult,
  repetition: RepetitionCheckResult
): TaskEvaluationResult {
  const hasComments = input.comments && input.comments.length > 0;
  const commentQualityScore = hasComments
    ? input.isQAReview ? 90 : 75
    : 45;

  // Estimate complexity from description length and seniority
  const descLength = (input.taskDescription || '').trim().length;
  const complexityScore = descLength > 100 ? 85 : descLength > 30 ? 75 : 60;

  const overallScore = computeCompositeTaskScore({
    timeScore: timeAdherence.timeScore,
    commentQualityScore,
    complexityScore,
    repetitionScore: repetition.repetitionScore,
    isQAReview: input.isQAReview,
  });

  const strengths: string[] = [];
  const improvements: string[] = [];

  if (timeAdherence.assessmentLabel === 'UNEXPECTED_EARLY') {
    improvements.push('Early completion gap noted; refine estimation and ensure comprehensive QA testing.');
  } else if (timeAdherence.assessmentLabel === 'OVERDUE') {
    improvements.push('Task exceeded planned hours; flag blockers earlier in Zoho comments.');
  } else {
    strengths.push('Excellent time adherence within the allowed tolerance window.');
  }

  if (input.isQAReview) {
    strengths.push('Properly transitioned status to QA Review upon completion.');
  } else {
    improvements.push('Ensure task is formally moved to QA Review with verification steps.');
  }

  if (repetition.isRepetitive) {
    improvements.push(`Similar task scope repeated in project (${repetition.similarityPct}% match). Keep task definitions distinct.`);
  }

  if (input.aiSubscriptions && input.aiSubscriptions.length > 0) {
    strengths.push(`Effective AI tool utilization (${input.aiSubscriptions.join(', ')}).`);
  }

  const summaryFeedback = `Task completed in ${Math.round((input.actualMinutes / 60) * 10) / 10}h (planned ${Math.round((input.plannedMinutes / 60) * 10) / 10}h). ${timeAdherence.explanation} ${repetition.isRepetitive ? repetition.explanation : 'Original scope with verified status.'}`;

  return {
    overallScore,
    timeScore: timeAdherence.timeScore,
    commentQualityScore,
    complexityScore,
    repetitionScore: repetition.repetitionScore,
    timeVarianceMinutes: timeAdherence.timeVarianceMinutes,
    timeAssessmentLabel: timeAdherence.assessmentLabel,
    isRepetitive: repetition.isRepetitive,
    repetitionSimilarityPct: repetition.similarityPct,
    matchedTaskId: repetition.matchedTaskId,
    summaryFeedback,
    strengths,
    improvements,
    aiModelUsed: 'rule-engine-fallback',
  };
}

/**
 * Evaluates a single Zoho task using heuristics + Gemini 2.5 Flash
 */
export async function evaluateZohoTask(
  input: TaskEvaluationInput
): Promise<TaskEvaluationResult> {
  const timeAdherence = calculateTimeAdherence(
    input.plannedMinutes,
    input.actualMinutes
  );

  const repetition = detectRepetitiveTask(
    input.taskName,
    input.taskDescription,
    input.historicalTasks || []
  );

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return generateHeuristicEvaluation(input, timeAdherence, repetition);
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `
You are the Chief Engineering Evaluator for the Creole Knowledge Portal.
Evaluate the following completed software development task based on our engineering evaluation rules:

ENGINEERING RULES:
1. Time Tolerance:
   - Planned: ${input.plannedMinutes} mins. Actual: ${input.actualMinutes} mins.
   - Variance: ${timeAdherence.timeVarianceMinutes} mins (${timeAdherence.assessmentLabel}).
   - Rule applied: ${timeAdherence.explanation}
2. Repetitive Task Check:
   - Repetition Flag: ${repetition.isRepetitive} (${repetition.similarityPct}% similarity to prior project task).
   - Rule: Repetitive or duplicate tasks in the same project indicate scope-padding or lack of distinct planning.
3. Seniority & AI Tools:
   - Experience: ${input.seniorityLevel} (${input.userExperienceYears} years exp).
   - Active AI Subscriptions: ${input.aiSubscriptions.length > 0 ? input.aiSubscriptions.join(', ') : 'None'}.
   - Expected standard: Senior developers or users with AI tools should provide clear documentation, test evidence, and accurate estimations.
4. QA Review Status:
   - Current Status: ${input.zohoStatus}
   - Moved to QA Review: ${input.isQAReview ? 'YES' : 'NO'}.

TASK CONTEXT:
- Project: "${input.projectName}"
- Task Name: "${input.taskName}"
- Description: "${input.taskDescription || 'No description provided'}"
- Comments / Progress Updates:
${input.comments && input.comments.length > 0 ? input.comments.map((c, i) => `  ${i + 1}. ${c}`).join('\n') : '  No comments logged'}

Return your evaluation strictly conforming to the requested JSON schema.
`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: aiEvaluationSchema,
        temperature: 0.2,
      },
    });

    const parsed = JSON.parse(response.text?.trim() || '{}');
    const commentQualityScore = Number.isFinite(parsed.commentQualityScore)
      ? Math.max(0, Math.min(100, parsed.commentQualityScore))
      : 75;
    const complexityScore = Number.isFinite(parsed.complexityScore)
      ? Math.max(0, Math.min(100, parsed.complexityScore))
      : 75;

    const overallScore = computeCompositeTaskScore({
      timeScore: timeAdherence.timeScore,
      commentQualityScore,
      complexityScore,
      repetitionScore: repetition.repetitionScore,
      isQAReview: input.isQAReview,
    });

    const rawStrengths = Array.isArray(parsed.strengths) ? parsed.strengths : [];
    const rawImprovements = Array.isArray(parsed.improvements) ? parsed.improvements : [];

    // Ensure critical engineering heuristics are always surfaced in feedback
    if (timeAdherence.assessmentLabel === 'UNEXPECTED_EARLY' && !rawImprovements.some((i: string) => i.toLowerCase().includes('early'))) {
      rawImprovements.unshift('Early completion gap noted; refine estimation accuracy and verify thorough testing.');
    }
    if (repetition.isRepetitive && !rawImprovements.some((i: string) => i.toLowerCase().includes('repeat') || i.toLowerCase().includes('similar'))) {
      rawImprovements.unshift(`Similar task scope repeated in project (${repetition.similarityPct}% match). Keep task definitions distinct.`);
    }

    return {
      overallScore,
      timeScore: timeAdherence.timeScore,
      commentQualityScore,
      complexityScore,
      repetitionScore: repetition.repetitionScore,
      timeVarianceMinutes: timeAdherence.timeVarianceMinutes,
      timeAssessmentLabel: timeAdherence.assessmentLabel,
      isRepetitive: repetition.isRepetitive,
      repetitionSimilarityPct: repetition.similarityPct,
      matchedTaskId: repetition.matchedTaskId,
      summaryFeedback: parsed.summaryFeedback || timeAdherence.explanation,
      strengths: rawStrengths,
      improvements: rawImprovements,
      aiModelUsed: 'gemini-2.5-flash',
    };
  } catch (error) {
    console.warn('[evaluateZohoTask] Gemini API failed, falling back to rule engine:', error);
    return generateHeuristicEvaluation(input, timeAdherence, repetition);
  }
}

/**
 * Aggregates all tasks for a user on a given day into a full-day evaluation summary
 */
export function evaluateFullDay(
  tasks: {
    plannedMinutes: number;
    actualMinutes: number;
    overallScore: number;
    timeAssessmentLabel: string;
    isQAReview: boolean;
    zohoStatus: string;
  }[],
  evaluationDate: string
): DayEvaluationSummary {
  if (!tasks || tasks.length === 0) {
    return {
      evaluationDate,
      totalTasks: 0,
      doneTasks: 0,
      qaReviewTasks: 0,
      delayedTasks: 0,
      totalPlannedHours: 0,
      totalActualHours: 0,
      dailyScore: 0,
      dailySummary: 'No tasks logged for this day.',
    };
  }

  let totalPlannedMinutes = 0;
  let totalActualMinutes = 0;
  let totalScoreSum = 0;
  let doneCount = 0;
  let qaCount = 0;
  let delayedCount = 0;

  for (const t of tasks) {
    totalPlannedMinutes += t.plannedMinutes || 0;
    totalActualMinutes += t.actualMinutes || 0;
    totalScoreSum += t.overallScore || 0;

    const statusLower = (t.zohoStatus || '').toLowerCase();
    if (statusLower === 'closed' || statusLower === 'done' || statusLower === 'completed') {
      doneCount++;
    }
    if (t.isQAReview || statusLower === 'qa review') {
      qaCount++;
    }
    if (t.timeAssessmentLabel === 'OVERDUE') {
      delayedCount++;
    }
  }

  const avgScore = Math.round(totalScoreSum / tasks.length);
  const totalPlannedHours = Math.round((totalPlannedMinutes / 60) * 100) / 100;
  const totalActualHours = Math.round((totalActualMinutes / 60) * 100) / 100;

  let summary = `Completed ${tasks.length} task(s) on ${evaluationDate}. Total logged hours: ${totalActualHours}h vs ${totalPlannedHours}h planned. `;
  if (delayedCount === 0 && avgScore >= 85) {
    summary += 'Outstanding daily performance with high punctuality and smooth QA handoffs.';
  } else if (delayedCount > 0) {
    summary += `${delayedCount} task(s) ran past the tolerance window; focus on blocker escalation in daily standups.`;
  } else {
    summary += 'Steady productivity maintained with room for tighter estimation accuracy.';
  }

  return {
    evaluationDate,
    totalTasks: tasks.length,
    doneTasks: doneCount,
    qaReviewTasks: qaCount,
    delayedTasks: delayedCount,
    totalPlannedHours,
    totalActualHours,
    dailyScore: avgScore,
    dailySummary: summary,
  };
}
