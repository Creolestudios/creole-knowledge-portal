import { describe, it, expect } from 'vitest';
import {
  calculateTimeAdherence,
  evaluateWorkAndCommentMatch,
  detectRepetitiveTask,
  computeCompositeTaskScore,
  generateDynamicPerformanceSummary,
} from './heuristics';

describe('Zoho Heuristics Engine', () => {
  describe('calculateTimeAdherence (+5m / -15m Buffer)', () => {
    it('awards 10/10 score when task is 4 hours and user logs up to 4 hours 5 minutes (+5m buffer)', () => {
      // 4 hours = 240 mins, 4:05 = 245 mins (+5 mins)
      const result = calculateTimeAdherence(240, 245);
      expect(result.timeScore).toBe(10);
      expect(result.timeVarianceMinutes).toBe(5);
      expect(result.assessmentLabel).toBe('SLIGHT_OVERRUN_TOLERATED');
      expect(result.explanation).toContain('Full score (10/10) awarded');
    });

    it('awards 10/10 score when task is 4 hours and user logs down to 3 hours 45 minutes (-15m buffer)', () => {
      // 4 hours = 240 mins, 3:45 = 225 mins (-15 mins)
      const result = calculateTimeAdherence(240, 225);
      expect(result.timeScore).toBe(10);
      expect(result.timeVarianceMinutes).toBe(-15);
      expect(result.assessmentLabel).toBe('ON_TIME');
      expect(result.explanation).toContain('Full score (10/10) awarded');
    });

    it('awards 10/10 score when task is completed exactly on planned time', () => {
      const result = calculateTimeAdherence(120, 120);
      expect(result.timeScore).toBe(10);
      expect(result.timeVarianceMinutes).toBe(0);
      expect(result.assessmentLabel).toBe('ON_TIME');
    });

    it('penalizes early completion when gap exceeds 15 minutes (e.g. 4h task done in 3h 30m)', () => {
      // 4 hours = 240 mins, 3:30 = 210 mins (-30 mins variance, 15m beyond buffer)
      const result = calculateTimeAdherence(240, 210);
      expect(result.timeScore).toBeLessThan(10);
      expect(result.timeVarianceMinutes).toBe(-30);
      expect(result.assessmentLabel).toBe('UNEXPECTED_EARLY');
      expect(result.explanation).toContain('beyond the -15m buffer');
    });

    it('penalizes overdue task when overtime exceeds 5-minute buffer (e.g. 4h task took 4h 15m)', () => {
      // 4 hours = 240 mins, 4:15 = 255 mins (+15 mins variance, 10m beyond buffer)
      const result = calculateTimeAdherence(240, 255);
      expect(result.timeScore).toBeLessThan(10);
      expect(result.timeVarianceMinutes).toBe(15);
      expect(result.assessmentLabel).toBe('OVERDUE');
      expect(result.explanation).toContain('beyond the +5m buffer');
    });

    it('returns score 0 and NOT_LOGGED label when user has logged 0 minutes', () => {
      const result = calculateTimeAdherence(480, 0);
      expect(result.timeScore).toBe(0);
      expect(result.assessmentLabel).toBe('NOT_LOGGED');
      expect(result.explanation).toContain('No hours were logged');
    });
  });

  describe('evaluateWorkAndCommentMatch', () => {
    it('awards high score (>= 8.5/10) when comments match description and document completed work', () => {
      const desc = 'Implement Image Upload Validation and Review Server Settings';
      const comments = [
        'Added client-side image size validation and server-side MIME type checks. Configured upload limit to 10MB and tested edge cases. PR submitted.',
      ];

      const result = evaluateWorkAndCommentMatch(desc, comments);
      expect(result.workMatchScore).toBeGreaterThanOrEqual(8.5);
      expect(result.alignmentLabel).toBe('STRONG_ALIGNMENT');
      expect(result.explanation).toContain('strongly justify the description');
    });

    it('penalizes score to 0 when task description is provided but zero comments were logged', () => {
      const desc = 'Write unit tests for authentication endpoint';
      const result = evaluateWorkAndCommentMatch(desc, []);
      expect(result.workMatchScore).toBe(0);
      expect(result.alignmentLabel).toBe('NO_COMMENTS');
      expect(result.explanation).toContain('Score is 0');
    });

    it('penalizes score when comment is superficial (e.g. just "done")', () => {
      const desc = 'Refactor database models and add migration scripts';
      const result = evaluateWorkAndCommentMatch(desc, ['done']);
      expect(result.workMatchScore).toBeLessThanOrEqual(5.5);
      expect(result.alignmentLabel).toBe('WEAK_ALIGNMENT');
      expect(result.explanation).toContain('superficial');
    });

    it('penalizes score when comment simply copy-pastes description and appends "- Done" checklist markers', () => {
      const desc = 'Do Server (Ubuntu) Upgrade. Do php upgrade Update 3 plugins on live Testing on live.';
      const comments = [
        'Do Server (Ubuntu) Upgrade. - Done Do php upgrade - Done Update 3 plugins on live - 1 is done 2 are pending which are depnedent on key by client. Testing on live. - Done',
      ];

      const result = evaluateWorkAndCommentMatch(desc, comments);
      expect(result.workMatchScore).toBeLessThanOrEqual(5.0);
      expect(result.isChecklistComment).toBe(true);
      expect(result.isBriefDescription).toBe(true);
      expect(result.alignmentLabel).toBe('WEAK_ALIGNMENT');
      expect(result.explanation).toContain('mirror the task checklist with status indicators');
    });

    it('penalizes score when task description is vague and brief (e.g. "Continue AI chatbot research")', () => {
      const desc = 'Continue AI chatbot research. Make home page section changes';
      const comments = ['Worked on chatbot and updated home page sections'];

      const result = evaluateWorkAndCommentMatch(desc, comments);
      expect(result.workMatchScore).toBeLessThanOrEqual(5.5);
      expect(result.isBriefDescription).toBe(true);
      expect(result.isBriefComment).toBe(true);
    });
  });

  describe('detectRepetitiveTask', () => {
    it('detects repetitive task when title and description are almost identical', () => {
      const historical = [
        {
          id: 'task-1',
          name: 'Fix UI alignment on user dashboard header',
          description: 'Adjust css padding and flex alignment for responsive cards',
        },
      ];

      const current = {
        name: 'Fix UI alignment on user dashboard header',
        description: 'Adjust padding and flex alignment on responsive cards',
      };

      const result = detectRepetitiveTask(current.name, current.description, historical);
      expect(result.isRepetitive).toBe(true);
      expect(result.similarityPct).toBeGreaterThanOrEqual(60);
      expect(result.matchedTaskId).toBe('task-1');
      expect(result.repetitionScore).toBeLessThan(10);
    });

    it('passes unique tasks with full score (10/10)', () => {
      const historical = [
        {
          id: 'task-1',
          name: 'Setup PostgreSQL migrations for user roles',
          description: 'Add RLS policies and indexes on auth users',
        },
      ];

      const current = {
        name: 'Implement OAuth callback handler for Zoho API',
        description: 'Store refresh token securely in encrypted vault',
      };

      const result = detectRepetitiveTask(current.name, current.description, historical);
      expect(result.isRepetitive).toBe(false);
      expect(result.repetitionScore).toBe(10);
      expect(result.matchedTaskId).toBeNull();
    });
  });

  describe('computeCompositeTaskScore', () => {
    it('correctly calculates weighted score out of 10 with QA review bonus', () => {
      const score = computeCompositeTaskScore({
        timeScore: 9.0,
        commentQualityScore: 8.5,
        complexityScore: 8.0,
        repetitionScore: 10.0,
        isQAReview: true,
      });

      // 8.5*0.45 + 9.0*0.35 + 8.0*0.10 + 10.0*0.10 = 3.825 + 3.15 + 0.8 + 1.0 = 8.775 + 0.3 (QA bonus) = 9.075 -> 9.1
      expect(score).toBe(9.1);
      expect(score).toBeLessThanOrEqual(10.0);
    });
  });

  describe('generateDynamicPerformanceSummary', () => {
    it('generates non-repetitive performance summary without repeating numerical hours or variance', () => {
      const summary = generateDynamicPerformanceSummary({
        taskDescription: 'Implement audio chunking logic for interview transcription',
        comments: ['Implemented 30-second audio buffer with fallback to local storage. Unit tests verified.'],
        timeAssessmentLabel: 'OVERDUE',
        workMatchScore: 9.0,
        seniorityLevel: 'Senior',
        userExperienceYears: 5,
        aiSubscriptions: ['GitHub Copilot'],
        isQAReview: true,
      });

      // Does not repeat raw numerical hours or stats
      expect(summary.performanceSummary).not.toContain('mins');
      expect(summary.performanceSummary).toContain('Task implementation was successfully executed');
      expect(summary.performanceSummary.split('\n').length).toBeGreaterThanOrEqual(3);

      // Flags where user lacked based on overdue status
      expect(summary.whereLacked).toContain('Exceeded the scheduled delivery buffer');

      // Provides actionable advice factoring in active AI tools
      expect(summary.whereToImprove).toContain('GitHub Copilot');
      expect(summary.improvementItems.length).toBeGreaterThanOrEqual(2);
    });

    it('flags lack of progress comments when comments array is empty', () => {
      const summary = generateDynamicPerformanceSummary({
        taskDescription: 'Refactor database indexing',
        comments: [],
        timeAssessmentLabel: 'ON_TIME',
        workMatchScore: 0,
        seniorityLevel: 'Junior',
        userExperienceYears: 1,
      });

      expect(summary.whereLacked).toContain('Lacked progress comments');
      expect(summary.whereToImprove).toContain('Always log a brief technical wrap-up in Zoho');
    });

    it('flags checklist comments and vague descriptions with actionable guidance without mentioning word counts', () => {
      const summary = generateDynamicPerformanceSummary({
        taskDescription: 'Do Server (Ubuntu) Upgrade. Do php upgrade Update 3 plugins on live Testing on live.',
        comments: [
          'Do Server (Ubuntu) Upgrade. - Done Do php upgrade - Done Update 3 plugins on live - 1 is done 2 are pending which are depnedent on key by client. Testing on live. - Done',
        ],
        timeAssessmentLabel: 'ON_TIME',
        workMatchScore: 4.8,
        seniorityLevel: 'Mid',
        userExperienceYears: 3,
      });

      // Does not mention explicit word count numbers
      expect(summary.performanceSummary).not.toMatch(/\b\d+\s*words\b/i);
      expect(summary.whereLacked).not.toMatch(/\b\d+\s*words\b/i);
      expect(summary.whereToImprove).not.toMatch(/\b\d+\s*words\b/i);

      // Flags checklist and brief description specifically
      expect(summary.whereLacked).toContain('status markers');
      expect(summary.improvementItems.some((i) => i.includes('Explain Work Done Beyond Status Updates'))).toBe(true);
      expect(summary.improvementItems.some((i) => i.includes('Define Comprehensive Task Scope'))).toBe(true);

      // Instructs user on 40-50 words benchmark inside improvementItems only
      expect(summary.improvementItems.some((i) => i.includes('40–50 words') || i.includes('40-50 words'))).toBe(true);
      expect(summary.performanceSummary).not.toContain('40');
      expect(summary.whereLacked).not.toContain('40');
      expect(summary.whereToImprove).not.toContain('40');
    });
  });
});
