import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { generateContentMock } = vi.hoisted(() => {
  return {
    generateContentMock: vi.fn().mockImplementation(async () => {
      return {
        text: JSON.stringify({
          commentQualityScore: 85,
          complexityScore: 80,
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
    it('evaluates task with slight overrun within 5m buffer', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      const result = await evaluateZohoTask({
        taskName: 'Implement Supabase RLS security policies',
        taskDescription: 'Write comprehensive idempotent RLS policies for zoho tables',
        projectName: 'Creole Knowledge Portal',
        plannedMinutes: 240, // 4 hours
        actualMinutes: 245,  // 4:05 (+5 mins)
        zohoStatus: 'QA Review',
        isQAReview: true,
        comments: ['PR created and test suite passed with 100% coverage.'],
        userExperienceYears: 3,
        seniorityLevel: 'Mid',
        aiSubscriptions: ['GitHub Copilot'],
      });

      expect(result.timeScore).toBe(100);
      expect(result.timeAssessmentLabel).toBe('SLIGHT_OVERRUN_TOLERATED');
      expect(result.overallScore).toBeGreaterThanOrEqual(85);
      expect(result.isRepetitive).toBe(false);
      expect(generateContentMock).toHaveBeenCalled();
    });

    it('evaluates task with early completion exceeding 15m gap', async () => {
      delete process.env.GEMINI_API_KEY; // test rule-based fallback
      const result = await evaluateZohoTask({
        taskName: 'API Endpoint integration',
        taskDescription: 'Create REST endpoints',
        projectName: 'CKP',
        plannedMinutes: 240, // 4 hours
        actualMinutes: 210,  // 3:30 (30 mins early)
        zohoStatus: 'QA Review',
        isQAReview: true,
        comments: ['Done'],
        userExperienceYears: 1,
        seniorityLevel: 'Junior',
        aiSubscriptions: [],
      });

      expect(result.timeAssessmentLabel).toBe('UNEXPECTED_EARLY');
      expect(result.timeScore).toBeLessThan(100);
      expect(result.improvements.some(imp => imp.includes('Early completion gap'))).toBe(true);
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
      expect(result.repetitionScore).toBeLessThan(100);
      expect(result.repetitionSimilarityPct).toBeGreaterThanOrEqual(60);
      expect(result.improvements.some(imp => imp.includes('Similar task scope repeated'))).toBe(true);
    });
  });

  describe('evaluateFullDay', () => {
    it('aggregates daily tasks into summary metrics and scores', () => {
      const tasks = [
        {
          plannedMinutes: 120,
          actualMinutes: 125,
          overallScore: 92,
          timeAssessmentLabel: 'SLIGHT_OVERRUN_TOLERATED',
          isQAReview: true,
          zohoStatus: 'QA Review',
        },
        {
          plannedMinutes: 180,
          actualMinutes: 175,
          overallScore: 95,
          timeAssessmentLabel: 'ON_TIME',
          isQAReview: false,
          zohoStatus: 'Closed',
        },
      ];

      const summary = evaluateFullDay(tasks, '2026-10-28');
      expect(summary.totalTasks).toBe(2);
      expect(summary.doneTasks).toBe(1);
      expect(summary.qaReviewTasks).toBe(1);
      expect(summary.delayedTasks).toBe(0);
      expect(summary.dailyScore).toBe(94); // (92+95)/2 = 93.5 -> 94
      expect(summary.totalPlannedHours).toBe(5); // 300 / 60
      expect(summary.totalActualHours).toBe(5);  // 300 / 60
      expect(summary.dailySummary).toContain('Outstanding daily performance');
    });

    it('handles empty task list gracefully', () => {
      const summary = evaluateFullDay([], '2026-10-28');
      expect(summary.totalTasks).toBe(0);
      expect(summary.dailyScore).toBe(0);
      expect(summary.dailySummary).toBe('No tasks logged for this day.');
    });
  });
});
