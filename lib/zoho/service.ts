import { supabaseAdmin } from '@/lib/supabase/admin';
import { evaluateZohoTask, evaluateFullDay, TaskEvaluationResult, DayEvaluationSummary } from './evaluator';
import { buildZohoTaskDeepLink } from './client';

export interface ZohoUserSummary {
  userId: string;
  email: string;
  name: string;
  role: string;
  yearsOfExperience: number;
  seniorityLevel: string;
  aiSubscriptions: string[];
  tillDateSummary: {
    doneTasks: number;
    pendingTasks: number;
    delayedTasks: number;
    weeklyAvgScore: number;
    totalHoursLogged: number;
  };
  dailyEvaluations: {
    date: string;
    dayScore: number;
    summary: string;
    tasks: ZohoTaskItem[];
  }[];
}

export interface ZohoTaskItem {
  id: string;
  zohoTaskId: string;
  projectId: string;
  projectName: string;
  taskName: string;
  taskDescription: string;
  zohoStatus: string;
  isQAReview: boolean;
  plannedHours: number;
  actualHours: number;
  taskDate: string;
  zohoLink: string;
  comments: { author: string; content: string; time: string }[];
  evaluation?: TaskEvaluationResult;
}

export interface DateFilterOptions {
  type: 'week' | 'month' | 'range';
  startDate?: string;
  endDate?: string;
  weekOffset?: number; // 0 = this week, -1 = last week
  monthOffset?: number; // 0 = this month, -1 = last month
}

/**
 * Generates ISO date boundaries for week, month, and custom range filters
 */
export function resolveDateFilterRange(filter: DateFilterOptions): { start: string; end: string } {
  const now = new Date();

  if (filter.type === 'week') {
    const offset = filter.weekOffset || 0;
    const currentDay = now.getDay(); // 0 is Sunday
    const distanceToMonday = (currentDay === 0 ? -6 : 1) - currentDay;
    const monday = new Date(now);
    monday.setDate(now.getDate() + distanceToMonday + offset * 7);
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    return {
      start: monday.toISOString().split('T')[0],
      end: sunday.toISOString().split('T')[0],
    };
  }

  if (filter.type === 'month') {
    const offset = filter.monthOffset || 0;
    const year = now.getFullYear();
    const month = now.getMonth() + offset;
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);

    return {
      start: firstDay.toISOString().split('T')[0],
      end: lastDay.toISOString().split('T')[0],
    };
  }

  // Custom range
  return {
    start: filter.startDate || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0],
    end: filter.endDate || new Date().toISOString().split('T')[0],
  };
}

/**
 * In-memory fallback mock dataset demonstrating all user prompt criteria
 */
export function getMockZohoData(): ZohoUserSummary[] {
  const portalId = 'creolestudios';

  const task1Eval: TaskEvaluationResult = {
    overallScore: 94,
    timeScore: 100,
    commentQualityScore: 92,
    complexityScore: 88,
    repetitionScore: 100,
    timeVarianceMinutes: 5,
    timeAssessmentLabel: 'SLIGHT_OVERRUN_TOLERATED',
    isRepetitive: false,
    repetitionSimilarityPct: 0,
    matchedTaskId: null,
    summaryFeedback: '4-hour task completed in 4:05. The 5-minute overrun is within the permitted tolerance buffer with zero penalty. Clean QA handoff.',
    strengths: ['Punctual delivery within buffer', 'Moved status to QA Review with thorough checklist'],
    improvements: ['Include unit test coverage screenshot in comments'],
    aiModelUsed: 'gemini-2.5-flash',
  };

  const task2Eval: TaskEvaluationResult = {
    overallScore: 78,
    timeScore: 82,
    commentQualityScore: 75,
    complexityScore: 70,
    repetitionScore: 100,
    timeVarianceMinutes: -30,
    timeAssessmentLabel: 'UNEXPECTED_EARLY',
    isRepetitive: false,
    repetitionSimilarityPct: 0,
    matchedTaskId: null,
    summaryFeedback: 'Task estimated at 4 hours completed in 3:30 (30m early, exceeding 15m allowance). Early completion flags potential over-estimation or rushed QA verification.',
    strengths: ['Swift turnaround', 'Moved to QA Review'],
    improvements: ['Refine estimation buffer; 15-minute gap policy flagged unexpected early finish', 'Attach automated test verification link'],
    aiModelUsed: 'gemini-2.5-flash',
  };

  const task3Eval: TaskEvaluationResult = {
    overallScore: 71,
    timeScore: 100,
    commentQualityScore: 70,
    complexityScore: 65,
    repetitionScore: 40,
    timeVarianceMinutes: 0,
    timeAssessmentLabel: 'ON_TIME',
    isRepetitive: true,
    repetitionSimilarityPct: 75,
    matchedTaskId: 'zoho-t-101',
    summaryFeedback: 'Repetitive task detected in project "CKP Core" (75% scope similarity to prior bugfix). Repetitive generic logs reduce task evaluation score.',
    strengths: ['Completed strictly on time'],
    improvements: ['Avoid logging repetitive generic tasks under the same project', 'Differentiate acceptance criteria'],
    aiModelUsed: 'gemini-2.5-flash',
  };

  const user1Tasks: ZohoTaskItem[] = [
    {
      id: 'task-mock-1',
      zohoTaskId: 'zoho-t-201',
      projectId: 'proj-ckp-1',
      projectName: 'Creole Knowledge Portal',
      taskName: 'Implement Supabase RLS security policies',
      taskDescription: 'Write idempotent PostgreSQL policies for zoho_tasks and zoho_task_evaluations tables to enforce strict user boundaries.',
      zohoStatus: 'QA Review',
      isQAReview: true,
      plannedHours: 4.0,
      actualHours: 4.08, // 4 hours 5 minutes
      taskDate: new Date().toISOString().split('T')[0],
      zohoLink: buildZohoTaskDeepLink(portalId, 'proj-ckp-1', 'zoho-t-201'),
      comments: [
        { author: 'Jayesh Patel', content: 'Started implementation of RLS policies with automated role checking.', time: '10:00 AM' },
        { author: 'Jayesh Patel', content: 'Completed policy authoring and verified SELECT/INSERT rules. Moving task to QA Review.', time: '02:05 PM' },
      ],
      evaluation: task1Eval,
    },
    {
      id: 'task-mock-2',
      zohoTaskId: 'zoho-t-202',
      projectId: 'proj-ckp-1',
      projectName: 'Creole Knowledge Portal',
      taskName: 'Optimize blog digest query caching with Redis',
      taskDescription: 'Add Redis cache keys with 10-minute TTL to reduce database query load during peak morning reading digests.',
      zohoStatus: 'QA Review',
      isQAReview: true,
      plannedHours: 4.0,
      actualHours: 3.5, // 3:30 (30 mins early)
      taskDate: new Date().toISOString().split('T')[0],
      zohoLink: buildZohoTaskDeepLink(portalId, 'proj-ckp-1', 'zoho-t-202'),
      comments: [
        { author: 'Jayesh Patel', content: 'Redis cache wrapper built and tested locally. Finished in 3.5 hours and moved to QA Review.', time: '05:30 PM' },
      ],
      evaluation: task2Eval,
    },
  ];

  const user2Tasks: ZohoTaskItem[] = [
    {
      id: 'task-mock-3',
      zohoTaskId: 'zoho-t-301',
      projectId: 'proj-interviews-2',
      projectName: 'AI Interview Engine',
      taskName: 'Fix video chunk streaming upload timeout',
      taskDescription: 'Adjust chunk upload retries and add backoff for Google Drive API during unstable candidate network connections.',
      zohoStatus: 'Closed',
      isQAReview: false,
      plannedHours: 2.0,
      actualHours: 2.0,
      taskDate: new Date().toISOString().split('T')[0],
      zohoLink: buildZohoTaskDeepLink(portalId, 'proj-interviews-2', 'zoho-t-301'),
      comments: [
        { author: 'Srushti Amin', content: 'Added 3x exponential backoff and updated upload error telemetry.', time: '03:15 PM' },
      ],
      evaluation: task3Eval,
    },
  ];

  return [
    {
      userId: 'mock-user-1',
      email: 'jayesh.patel@creolestudios.com',
      name: 'Jayesh Patel',
      role: 'Full Stack Developer',
      yearsOfExperience: 3,
      seniorityLevel: 'Mid',
      aiSubscriptions: ['GitHub Copilot', 'ChatGPT Plus'],
      tillDateSummary: {
        doneTasks: 28,
        pendingTasks: 3,
        delayedTasks: 1,
        weeklyAvgScore: 89,
        totalHoursLogged: 132.5,
      },
      dailyEvaluations: [
        {
          date: new Date().toISOString().split('T')[0],
          dayScore: 86,
          summary: 'Completed 2 key backend tasks. High adherence on RLS security with slight overrun within 5m buffer; early completion noted on cache task.',
          tasks: user1Tasks,
        },
      ],
    },
    {
      userId: 'mock-user-2',
      email: 'srushti.amin@creolestudios.com',
      name: 'Srushti Amin',
      role: 'Frontend & AI Developer',
      yearsOfExperience: 2,
      seniorityLevel: 'Mid',
      aiSubscriptions: ['Cursor AI', 'Claude Pro'],
      tillDateSummary: {
        doneTasks: 34,
        pendingTasks: 2,
        delayedTasks: 2,
        weeklyAvgScore: 87,
        totalHoursLogged: 140.0,
      },
      dailyEvaluations: [
        {
          date: new Date().toISOString().split('T')[0],
          dayScore: 71,
          summary: 'Completed 1 task on video streaming. Repetitive task criteria flagged against prior chunk upload tickets.',
          tasks: user2Tasks,
        },
      ],
    },
  ];
}

/**
 * Formats a clean human-readable name from email and optional metadata
 */
export function formatUserName(email: string, metaName?: string | null): string {
  if (metaName && metaName.trim()) return metaName.trim();
  const namePart = (email || '').split('@')[0];
  return namePart
    .split(/[._-]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Builds realistic date-wise task evaluation items for an authenticated login user
 */
export function buildSampleUserSummary(
  userId: string,
  email: string,
  name: string,
  role: string,
  yearsOfExperience: number,
  seniorityLevel: string,
  aiSubscriptions: string[],
  dateRange: { start: string; end: string }
): ZohoUserSummary {
  const portalId = 'creolestudios';
  const roleLower = (role || '').toLowerCase();
  const taskDate = dateRange.end || new Date().toISOString().split('T')[0];

  // Tailor task titles according to employee's actual role
  let task1Title = 'Implement Supabase RLS security policies';
  let task1Desc = 'Write idempotent PostgreSQL policies for zoho_tasks and zoho_task_evaluations tables to enforce strict user boundaries.';
  let task2Title = 'Optimize blog digest query caching with Redis';
  let task2Desc = 'Add Redis cache keys with 10-minute TTL to reduce database query load during peak morning reading digests.';

  if (roleLower.includes('wordpress')) {
    task1Title = 'Optimize WooCommerce checkout caching and transient queries';
    task1Desc = 'Audit slow queries on WooCommerce checkout funnel and configure Redis object caching.';
    task2Title = 'Custom Gutenberg block for course syllabus preview';
    task2Desc = 'Develop modular React Gutenberg block with server-side rendering for portal courses.';
  } else if (roleLower.includes('ai') || roleLower.includes('ml')) {
    task1Title = 'Fine-tune Gemini prompt evaluation heuristics with tolerance bounds';
    task1Desc = 'Implement strict tolerance rules: +5m buffer allowed, 15m early completion gap checking, and repetition heuristics.';
    task2Title = 'Build semantic vector search pipeline for knowledge portal articles';
    task2Desc = 'Generate text-embedding-004 vectors and index in pgvector for similarity queries.';
  }

  const task1Eval: TaskEvaluationResult = {
    overallScore: 94,
    timeScore: 100,
    commentQualityScore: 92,
    complexityScore: 88,
    repetitionScore: 100,
    timeVarianceMinutes: 5,
    timeAssessmentLabel: 'SLIGHT_OVERRUN_TOLERATED',
    isRepetitive: false,
    repetitionSimilarityPct: 0,
    matchedTaskId: null,
    summaryFeedback: '4-hour task completed in 4:05. The 5-minute overrun is within the permitted tolerance buffer with zero penalty. Clean QA handoff.',
    strengths: ['Punctual delivery within buffer', 'Moved status to QA Review with thorough checklist'],
    improvements: ['Include unit test coverage screenshot in comments'],
    aiModelUsed: 'gemini-2.5-flash',
  };

  const task2Eval: TaskEvaluationResult = {
    overallScore: 78,
    timeScore: 82,
    commentQualityScore: 75,
    complexityScore: 70,
    repetitionScore: 100,
    timeVarianceMinutes: -30,
    timeAssessmentLabel: 'UNEXPECTED_EARLY',
    isRepetitive: false,
    repetitionSimilarityPct: 0,
    matchedTaskId: null,
    summaryFeedback: 'Task estimated at 4 hours completed in 3:30 (30m early, exceeding 15m allowance). Early completion flags potential over-estimation or rushed QA verification.',
    strengths: ['Swift turnaround', 'Moved to QA Review'],
    improvements: ['Refine estimation buffer; 15-minute gap policy flagged unexpected early finish', 'Attach automated test verification link'],
    aiModelUsed: 'gemini-2.5-flash',
  };

  const tasks: ZohoTaskItem[] = [
    {
      id: `task-${userId}-1`,
      zohoTaskId: `zoho-t-${userId.slice(0, 8)}-1`,
      projectId: 'proj-ckp-1',
      projectName: 'Creole Knowledge Portal',
      taskName: task1Title,
      taskDescription: task1Desc,
      zohoStatus: 'QA Review',
      isQAReview: true,
      plannedHours: 4.0,
      actualHours: 4.08,
      taskDate,
      zohoLink: buildZohoTaskDeepLink(portalId, 'proj-ckp-1', `zoho-t-${userId.slice(0, 8)}-1`),
      comments: [
        { author: name, content: 'Started implementation with automated role checking.', time: '10:00 AM' },
        { author: name, content: 'Completed verification and verified test suite. Moving task to QA Review.', time: '02:05 PM' },
      ],
      evaluation: task1Eval,
    },
    {
      id: `task-${userId}-2`,
      zohoTaskId: `zoho-t-${userId.slice(0, 8)}-2`,
      projectId: 'proj-ckp-1',
      projectName: 'Creole Knowledge Portal',
      taskName: task2Title,
      taskDescription: task2Desc,
      zohoStatus: 'QA Review',
      isQAReview: true,
      plannedHours: 4.0,
      actualHours: 3.5,
      taskDate,
      zohoLink: buildZohoTaskDeepLink(portalId, 'proj-ckp-1', `zoho-t-${userId.slice(0, 8)}-2`),
      comments: [
        { author: name, content: 'Wrapper built and tested. Finished in 3.5 hours and moved to QA Review.', time: '05:30 PM' },
      ],
      evaluation: task2Eval,
    },
  ];

  // Hash-based determinism for till-date numbers
  const charCodeSum = email.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const doneTasks = 20 + (charCodeSum % 15);
  const pendingTasks = 1 + (charCodeSum % 4);
  const delayedTasks = charCodeSum % 3;
  const weeklyAvgScore = 82 + (charCodeSum % 14);
  const totalHoursLogged = Math.round((110 + (charCodeSum % 35)) * 10) / 10;

  return {
    userId,
    email,
    name,
    role,
    yearsOfExperience,
    seniorityLevel,
    aiSubscriptions,
    tillDateSummary: {
      doneTasks,
      pendingTasks,
      delayedTasks,
      weeklyAvgScore,
      totalHoursLogged,
    },
    dailyEvaluations: [
      {
        date: taskDate,
        dayScore: Math.round((task1Eval.overallScore + task2Eval.overallScore) / 2),
        summary: `Completed 2 tasks on ${taskDate}. High adherence with tolerated 5m buffer on core task; early completion noted on secondary ticket.`,
        tasks,
      },
    ],
  };
}
