import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { generateContentMock } = vi.hoisted(() => {
  return {
    generateContentMock: vi.fn().mockImplementation(async () => {
      return {
        text: JSON.stringify({
          workMatchScore: 9.0,
          commentQualityScore: 8.5,
          complexityScore: 8.0,
          workMatchFeedback: 'Comments directly match the task description and verify that RLS policies and tests were completed.',
          summaryFeedback: 'Solid execution with clear comments and timely delivery.',
          strengths: ['Clean code review handoff', 'Prompt updates'],
          improvements: ['Early completion gap noted; refine estimation and ensure comprehensive QA testing.'],
        }),
      };
    }),
  };
});

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      models = {
        generateContent: generateContentMock,
      };
    },
    Type: {
      OBJECT: 'OBJECT',
      STRING: 'STRING',
      NUMBER: 'NUMBER',
      INTEGER: 'INTEGER',
      ARRAY: 'ARRAY',
    },
  };
});

import { evaluateZohoTask, evaluateFullDay } from './evaluator';

describe('Zoho Evaluator Service', () => {
  const originalEnv = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalEnv;
  });

  describe('evaluateZohoTask', () => {
    it('evaluates task with overrun within +5m buffer and matching comments (score out of 10)', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      const result = await evaluateZohoTask({
        taskName: 'Implement Supabase RLS security policies',
        taskDescription: 'Write comprehensive idempotent RLS policies for zoho tables',
        projectName: 'Creole Knowledge Portal',
        plannedMinutes: 240, // 4 hours
        actualMinutes: 245,  // 4:05 (+5 mins, within +5m buffer)
        zohoStatus: 'QA Review',
        isQAReview: true,
        comments: ['PR created and test suite passed with 100% coverage.'],
        userExperienceYears: 3,
        seniorityLevel: 'Mid',
        aiSubscriptions: ['GitHub Copilot'],
      });

      expect(result.timeScore).toBe(10);
      expect(result.timeAssessmentLabel).toBe('SLIGHT_OVERRUN_TOLERATED');
      expect(result.overallScore).toBeGreaterThanOrEqual(8.5);
      expect(result.overallScore).toBeLessThanOrEqual(10.0);
      expect(result.isRepetitive).toBe(false);
      expect(generateContentMock).toHaveBeenCalled();
    });

    it('evaluates task with early completion exceeding 10m gap and penalizes score', async () => {
      delete process.env.GEMINI_API_KEY; // test rule-based fallback
      const result = await evaluateZohoTask({
        taskName: 'API Endpoint integration',
        taskDescription: 'Create REST endpoints',
        projectName: 'CKP',
        plannedMinutes: 240, // 4 hours
        actualMinutes: 210,  // 3:30 (30 mins early, 20m beyond 10m buffer)
        zohoStatus: 'QA Review',
        isQAReview: true,
        comments: ['Done'],
        userExperienceYears: 1,
        seniorityLevel: 'Junior',
        aiSubscriptions: [],
      });

      expect(result.timeAssessmentLabel).toBe('UNEXPECTED_EARLY');
      expect(result.timeScore).toBeLessThan(10);
      expect(result.improvements.some(imp => imp.includes('Early completion gap'))).toBe(true);
    });

    it('evaluates work match and penalizes when comments are missing', async () => {
      delete process.env.GEMINI_API_KEY; // test rule-based fallback
      const result = await evaluateZohoTask({
        taskName: 'Complex auth refactor',
        taskDescription: 'Implement OAuth refresh token rotation and revoke sessions',
        projectName: 'CKP',
        plannedMinutes: 120,
        actualMinutes: 120, // exactly on time
        zohoStatus: 'Closed',
        isQAReview: false,
        comments: [], // no comments
        userExperienceYears: 3,
        seniorityLevel: 'Senior',
        aiSubscriptions: [],
      });

      expect(result.timeScore).toBe(10);
      expect(result.workMatchScore).toBe(0);
      expect(result.workMatchFeedback).toContain('Score is 0');
      expect(result.overallScore).toBeLessThan(8.0);
    });

    it('flags repetitive task and applies penalty', async () => {
      delete process.env.GEMINI_API_KEY; // test rule-based fallback
      const historical = [
        {
          id: 'prev-1',
          name: 'Fix UI alignment on user dashboard header',
          description: 'Adjust css padding and flex alignment for responsive cards',
        },
      ];

      const result = await evaluateZohoTask({
        taskName: 'Fix UI alignment on user dashboard header',
        taskDescription: 'Adjust css padding and flex alignment for responsive cards',
        projectName: 'CKP',
        plannedMinutes: 60,
        actualMinutes: 60,
        zohoStatus: 'Closed',
        isQAReview: false,
        comments: [],
        userExperienceYears: 2,
        seniorityLevel: 'Mid',
        aiSubscriptions: [],
        historicalTasks: historical,
      });

      expect(result.isRepetitive).toBe(true);
      expect(result.repetitionScore).toBeLessThan(10);
      expect(result.repetitionSimilarityPct).toBeGreaterThanOrEqual(60);
      expect(result.improvements.some(imp => imp.includes('Similar task scope repeated'))).toBe(true);
    });
  });

  describe('evaluateFullDay', () => {
    it('aggregates daily tasks into summary metrics and scores out of 10', () => {
      const tasks = [
        {
          plannedMinutes: 120,
          actualMinutes: 125,
          overallScore: 9.2,
          timeAssessmentLabel: 'SLIGHT_OVERRUN_TOLERATED',
          isQAReview: true,
          zohoStatus: 'QA Review',
        },
        {
          plannedMinutes: 180,
          actualMinutes: 175,
          overallScore: 9.5,
          timeAssessmentLabel: 'ON_TIME',
          isQAReview: true,
          zohoStatus: 'QA Review',
        },
      ];

      const summary = evaluateFullDay(tasks, '2026-10-27');
      expect(summary.totalTasks).toBe(2);
      expect(summary.qaReviewTasks).toBe(2);
      expect(summary.delayedTasks).toBe(0);
      expect(summary.dailyScore).toBe(9.4);
      expect(summary.dailySummary).toContain('Outstanding daily performance');
    });

    it('handles empty day gracefully', () => {
      const summary = evaluateFullDay([], '2026-10-27');
      expect(summary.totalTasks).toBe(0);
      expect(summary.dailyScore).toBe(0);
      expect(summary.dailySummary).toBe('No tasks logged for this day.');
    });
  });
});
