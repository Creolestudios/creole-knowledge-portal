import { GoogleGenAI, Type, Schema } from '@google/genai';
import {
  calculateTimeAdherence,
  detectRepetitiveTask,
  computeCompositeTaskScore,
  evaluateWorkAndCommentMatch,
  generateDynamicPerformanceSummary,
  TimeAdherenceResult,
  RepetitionCheckResult,
  WorkMatchResult,
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
  overallScore: number; // 0 - 10
  timeScore: number; // 0 - 10
  workMatchScore?: number; // 0 - 10
  commentQualityScore: number; // 0 - 10
  complexityScore: number; // 0 - 10
  repetitionScore: number; // 0 - 10
  timeVarianceMinutes: number;
  timeAssessmentLabel: string;
  isRepetitive: boolean;
  repetitionSimilarityPct: number;
  matchedTaskId: string | null;
  workMatchFeedback?: string;
  summaryFeedback: string;
  whereLacked?: string;
  whereToImprove?: string;
  improvementItems?: string[];
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
    workMatchScore: {
      type: Type.NUMBER,
      description: 'Score out of 10 evaluating if comments match the task description and substantiate the work completed (0.0 - 10.0)',
    },
    commentQualityScore: {
      type: Type.NUMBER,
      description: 'Score out of 10 for technical depth, PR notes, and QA verification in comments (0.0 - 10.0)',
    },
    complexityScore: {
      type: Type.NUMBER,
      description: 'Task complexity assessment based on scope and role (0.0 - 10.0)',
    },
    workMatchFeedback: {
      type: Type.STRING,
      description: 'Detailed explanation comparing the task description against the comments to confirm if work was done as requested',
    },
    summaryFeedback: {
      type: Type.STRING,
      description: '2-3 sentence evaluative performance summary of execution without repeating numerical hours or metrics',
    },
    whereLacked: {
      type: Type.STRING,
      description: 'Concise explanation of where the user lacked or fell short in execution/comments',
    },
    whereToImprove: {
      type: Type.STRING,
      description: 'Concise actionable advice on where and how to improve next time',
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
    'workMatchScore',
    'commentQualityScore',
    'complexityScore',
    'workMatchFeedback',
    'summaryFeedback',
    'whereLacked',
    'whereToImprove',
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
  repetition: RepetitionCheckResult,
  workMatch: WorkMatchResult
): TaskEvaluationResult {
  const descLength = (input.taskDescription || '').trim().length;
  const complexityScore = descLength > 100 ? 8.5 : descLength > 30 ? 7.5 : 6.0;

  const overallScore = computeCompositeTaskScore({
    timeScore: timeAdherence.timeScore,
    commentQualityScore: workMatch.workMatchScore,
    complexityScore,
    repetitionScore: repetition.repetitionScore,
    isQAReview: input.isQAReview,
  });

  const strengths: string[] = [];
  const improvements: string[] = [];

  if (timeAdherence.assessmentLabel === 'NOT_LOGGED') {
    improvements.push('No hours were logged in Zoho Projects for this task. Ensure accurate timelogs are entered.');
  } else if (timeAdherence.assessmentLabel === 'UNEXPECTED_EARLY') {
    improvements.push('Early completion gap noted (>10m early); refine estimation accuracy and verify complete QA testing.');
  } else if (timeAdherence.assessmentLabel === 'OVERDUE') {
    improvements.push('Task exceeded planned hours (>10m overtime); escalate blockers earlier in Zoho comments.');
  } else {
    strengths.push('Excellent time adherence within the permitted ±10m tolerance buffer.');
  }

  if (workMatch.alignmentLabel === 'STRONG_ALIGNMENT') {
    strengths.push('Logged comments clearly match the task description and confirm the completed work.');
  } else if (workMatch.alignmentLabel === 'NO_COMMENTS') {
    improvements.push('Always log progress comments in Zoho Projects describing the implementation steps and test status.');
  } else {
    improvements.push('Ensure comments provide specific technical details aligned with the task description.');
  }

  if (input.isQAReview) {
    strengths.push('Properly transitioned status to QA Review upon completion.');
  } else {
    improvements.push('Ensure task is formally moved to QA Review with verification notes.');
  }

  if (repetition.isRepetitive) {
    improvements.push(`Similar task scope repeated in project (${repetition.similarityPct}% match). Keep task definitions distinct.`);
  }

  if (input.aiSubscriptions && input.aiSubscriptions.length > 0) {
    strengths.push(`Effective AI tool utilization (${input.aiSubscriptions.join(', ')}).`);
  }

  const dynamicSummary = generateDynamicPerformanceSummary({
    taskDescription: input.taskDescription || '',
    comments: input.comments || [],
    timeAssessmentLabel: timeAdherence.assessmentLabel,
    workMatchScore: workMatch.workMatchScore,
    seniorityLevel: input.seniorityLevel,
    userExperienceYears: input.userExperienceYears,
    aiSubscriptions: input.aiSubscriptions,
    isQAReview: input.isQAReview,
  });

  return {
    overallScore,
    timeScore: timeAdherence.timeScore,
    workMatchScore: workMatch.workMatchScore,
    commentQualityScore: workMatch.workMatchScore,
    complexityScore,
    repetitionScore: repetition.repetitionScore,
    timeVarianceMinutes: timeAdherence.timeVarianceMinutes,
    timeAssessmentLabel: timeAdherence.assessmentLabel,
    isRepetitive: repetition.isRepetitive,
    repetitionSimilarityPct: repetition.similarityPct,
    matchedTaskId: repetition.matchedTaskId,
    workMatchFeedback: workMatch.explanation,
    summaryFeedback: dynamicSummary.performanceSummary,
    whereLacked: dynamicSummary.whereLacked,
    whereToImprove: dynamicSummary.whereToImprove,
    improvementItems: dynamicSummary.improvementItems,
    strengths,
    improvements,
    aiModelUsed: 'rule-engine-fallback',
  };
}

/**
 * Evaluates a single Zoho task using heuristics and optional Gemini AI
 */
export async function evaluateZohoTask(
  input: TaskEvaluationInput,
  options: { useAi?: boolean } = { useAi: true }
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
  const workMatch = evaluateWorkAndCommentMatch(
    input.taskDescription,
    input.comments || [],
    {
      userExperienceYears: input.userExperienceYears,
      seniorityLevel: input.seniorityLevel,
      aiSubscriptions: input.aiSubscriptions,
      plannedMinutes: input.plannedMinutes,
      actualMinutes: input.actualMinutes,
    }
  );

  const apiKey = process.env.GEMINI_API_KEY;
  if (!options.useAi || !apiKey) {
    return generateHeuristicEvaluation(input, timeAdherence, repetition, workMatch);
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const prompt = `
You are the Chief Engineering Evaluator for the Creole Knowledge Portal.
Evaluate the following completed software development task. ALL SCORES MUST BE ON A SCALE OF 0.0 TO 10.0 (e.g. 8.5, 9.2, 10.0).

EVALUATION CRITERIA:
1. Work Justification & Comment Alignment (Score 0.0 - 10.0):
   - Compare the Task Description with the Comments logged.
   - Substance Benchmark: Both task description and comments should provide substantive technical depth (benchmark: 40–50 words each) and both must make sense. Comments must reflect the work done regarding the description in depth (modules modified, packages upgraded, errors resolved, testing done).
   - Vague Description & Checklist Penalization:
     * If the user provided a vague, generic description (e.g. 'Continue AI chatbot research. Make home page section changes', or brief bullets without acceptance criteria like 'Do Server (Ubuntu) Upgrade. Do php upgrade Update 3 plugins on live Testing on live.'), OR
     * If comments merely mirror the description checklist with status flags like 'done', 'not done', '- Done', '1 is done 2 are pending',
     * THEN heavily penalize the Work Justification score (cap between 4.0 - 5.0 / 10.0).
   - If comments clearly substantiate the work completed with detailed technical context, award a high score (8.5 - 10.0).
   - If comments are missing, score is strictly 0.0.
   - Privacy Rule for "40–50 words": DO NOT mention the word count or '40–50 words' anywhere in the performance summary, whereLacked, or workMatchFeedback. ONLY provide the 40–50 words coaching in the improvements/to-work-on points.
2. Time Tolerance (Buffer: +5 mins overtime, -15 mins early):
   - Planned: ${input.plannedMinutes} mins. Actual: ${input.actualMinutes} mins.
   - Variance: ${timeAdherence.timeVarianceMinutes} mins (${timeAdherence.assessmentLabel}).
   - Rule:
     * If actual time is 0 (unlogged in Zoho Projects), Time Adherence score MUST be 0.0 and labeled NOT_LOGGED.
     * If actual time is within +5 mins overtime or down to -15 mins early (e.g. 4h planned: 3h 45m to 4h 05m), score is 10/10.
     * Overrun beyond +5 mins or early completion gap beyond -15 mins negatively affects score.
     * Rule engine time score: ${timeAdherence.timeScore} / 10.
3. Work Status:
   - Current Status: ${input.zohoStatus} (QA Review: ${input.isQAReview ? 'YES' : 'NO'}).
4. Dynamic Performance Summary (DO NOT repeat numerical planned/actual hours, overtime minutes, or criteria scores):
   - Provide a 2-3 sentence performance summary evaluating user performance based on task description, comment depth, engineer seniority (${input.seniorityLevel}, ${input.userExperienceYears} yrs experience), and active AI subscriptions (${input.aiSubscriptions.length > 0 ? input.aiSubscriptions.join(', ') : 'None'}).
   - Clearly state where the user lacked in execution, documentation, or time discipline.
   - Clearly state actionable guidance on where and how to improve.

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
    const hasComments = input.comments && input.comments.length > 0;
    const rawWorkMatch = hasComments && Number.isFinite(parsed.workMatchScore) ? parsed.workMatchScore : (hasComments ? workMatch.workMatchScore : 0);
    let workMatchScore = hasComments ? Math.max(0, Math.min(10, rawWorkMatch > 10 ? rawWorkMatch / 10 : rawWorkMatch)) : 0;
    if (workMatch.isChecklistComment || (workMatch.isBriefDescription && workMatch.isBriefComment)) {
      workMatchScore = Math.min(workMatchScore, 5.0);
    }

    const rawCommentQuality = Number.isFinite(parsed.commentQualityScore) ? parsed.commentQualityScore : workMatchScore;
    const commentQualityScore = hasComments ? Math.max(0, Math.min(10, rawCommentQuality > 10 ? rawCommentQuality / 10 : rawCommentQuality)) : 0;

    const rawComplexity = Number.isFinite(parsed.complexityScore) ? parsed.complexityScore : 7.5;
    const complexityScore = Math.max(0, Math.min(10, rawComplexity > 10 ? rawComplexity / 10 : rawComplexity));

    const overallScore = computeCompositeTaskScore({
      timeScore: timeAdherence.timeScore,
      commentQualityScore: workMatchScore,
      complexityScore,
      repetitionScore: repetition.repetitionScore,
      isQAReview: input.isQAReview,
    });

    const rawStrengths = Array.isArray(parsed.strengths) ? parsed.strengths : [];
    const rawImprovements = Array.isArray(parsed.improvements) ? parsed.improvements : [];

    // Ensure critical engineering heuristics are always surfaced in feedback
    if (workMatch.isChecklistComment && !rawImprovements.some((i: string) => i.toLowerCase().includes('status updates') || i.toLowerCase().includes('checklist'))) {
      rawImprovements.unshift('In Zoho task comments, substantiate your work with at least 40–50 words detailing specific technical implementation (what code was modified, packages upgraded, issues resolved, and verification findings) instead of repeating the task checklist with status markers like "done" or "pending".');
    }
    if (workMatch.isBriefDescription && !rawImprovements.some((i: string) => i.toLowerCase().includes('comprehensive task scope') || i.toLowerCase().includes('detailed scope'))) {
      rawImprovements.unshift('When creating or assigning tasks, document complete technical specifications, background context, and acceptance criteria (aim for at least 40–50 words of detailed scope rather than short summary bullets).');
    }
    if (timeAdherence.assessmentLabel === 'NOT_LOGGED' && !rawImprovements.some((i: string) => i.toLowerCase().includes('not logged') || i.toLowerCase().includes('no hours'))) {
      rawImprovements.unshift('No hours were logged in Zoho Projects for this task. Ensure accurate timelogs are entered.');
    }
    if (timeAdherence.assessmentLabel === 'UNEXPECTED_EARLY' && !rawImprovements.some((i: string) => i.toLowerCase().includes('early'))) {
      rawImprovements.unshift('Early completion gap noted (>10m early); refine estimation accuracy and verify thorough testing.');
    }
    if (timeAdherence.assessmentLabel === 'OVERDUE' && !rawImprovements.some((i: string) => i.toLowerCase().includes('overdue') || i.toLowerCase().includes('exceeded'))) {
      rawImprovements.unshift('Task ran past the allowed 10-minute buffer; escalate blockers earlier.');
    }
    if (repetition.isRepetitive && !rawImprovements.some((i: string) => i.toLowerCase().includes('repeat') || i.toLowerCase().includes('similar'))) {
      rawImprovements.unshift(`Similar task scope repeated in project (${repetition.similarityPct}% match). Keep task definitions distinct.`);
    }

    const fallbackSummary = generateDynamicPerformanceSummary({
      taskDescription: input.taskDescription || '',
      comments: input.comments || [],
      timeAssessmentLabel: timeAdherence.assessmentLabel,
      workMatchScore,
      seniorityLevel: input.seniorityLevel,
      userExperienceYears: input.userExperienceYears,
      aiSubscriptions: input.aiSubscriptions,
      isQAReview: input.isQAReview,
    });

    return {
      overallScore,
      timeScore: timeAdherence.timeScore,
      workMatchScore,
      commentQualityScore,
      complexityScore,
      repetitionScore: repetition.repetitionScore,
      timeVarianceMinutes: timeAdherence.timeVarianceMinutes,
      timeAssessmentLabel: timeAdherence.assessmentLabel,
      isRepetitive: repetition.isRepetitive,
      repetitionSimilarityPct: repetition.similarityPct,
      matchedTaskId: repetition.matchedTaskId,
      workMatchFeedback: parsed.workMatchFeedback || workMatch.explanation,
      summaryFeedback: parsed.summaryFeedback || fallbackSummary.performanceSummary,
      whereLacked: parsed.whereLacked || fallbackSummary.whereLacked,
      whereToImprove: parsed.whereToImprove || fallbackSummary.whereToImprove,
      improvementItems: fallbackSummary.improvementItems,
      strengths: rawStrengths,
      improvements: rawImprovements,
      aiModelUsed: 'gemini-2.5-flash',
    };
  } catch (error) {
    console.warn('[evaluateZohoTask] Gemini API failed, falling back to rule engine:', error);
    return generateHeuristicEvaluation(input, timeAdherence, repetition, workMatch);
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

  const rawAvg = totalScoreSum / tasks.length;
  const avgScore = Math.round((rawAvg > 10 ? rawAvg / 10 : rawAvg) * 10) / 10;
  const totalPlannedHours = Math.round((totalPlannedMinutes / 60) * 100) / 100;
  const totalActualHours = Math.round((totalActualMinutes / 60) * 100) / 100;

  let summary = `Completed ${tasks.length} task(s) on ${evaluationDate}. Total logged hours: ${totalActualHours}h vs ${totalPlannedHours}h planned. `;
  if (delayedCount === 0 && avgScore >= 8.5) {
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
