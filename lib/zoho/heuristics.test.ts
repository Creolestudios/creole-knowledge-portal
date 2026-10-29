import { describe, it, expect } from 'vitest';
import {
  calculateTimeAdherence,
  detectRepetitiveTask,
  computeCompositeTaskScore,
} from './heuristics';

describe('Zoho Heuristics Engine', () => {
  describe('calculateTimeAdherence', () => {
    it('awards 100 score when task is 4 hours and user spends 4 hours 5 minutes (+5m buffer)', () => {
      // 4 hours = 240 mins, 4:05 = 245 mins
      const result = calculateTimeAdherence(240, 245);
      expect(result.timeScore).toBe(100);
      expect(result.timeVarianceMinutes).toBe(5);
      expect(result.assessmentLabel).toBe('SLIGHT_OVERRUN_TOLERATED');
    });

    it('awards 100 score when task is completed exactly on planned time', () => {
      const result = calculateTimeAdherence(120, 120);
      expect(result.timeScore).toBe(100);
      expect(result.timeVarianceMinutes).toBe(0);
      expect(result.assessmentLabel).toBe('ON_TIME');
    });

    it('awards 100 score when completed within allowed 15-minute early window', () => {
      // 4 hours = 240 mins, completed in 3:45 = 225 mins (-15 mins)
      const result = calculateTimeAdherence(240, 225);
      expect(result.timeScore).toBe(100);
      expect(result.timeVarianceMinutes).toBe(-15);
      expect(result.assessmentLabel).toBe('ON_TIME');
    });

    it('penalizes early completion when gap exceeds 15 minutes (e.g., 4h task done in 3h 30m)', () => {
      // 4 hours = 240 mins, completed in 3:30 = 210 mins (-30 mins variance, 15m beyond buffer)
      const result = calculateTimeAdherence(240, 210);
      expect(result.timeScore).toBeLessThan(100);
      expect(result.timeVarianceMinutes).toBe(-30);
      expect(result.assessmentLabel).toBe('UNEXPECTED_EARLY');
      expect(result.explanation).toContain('potential estimation padding or rushed execution');
    });

    it('penalizes overdue task when overtime exceeds 5-minute buffer', () => {
      // 2 hours = 120 mins, took 3 hours = 180 mins (+60 mins)
      const result = calculateTimeAdherence(120, 180);
      expect(result.timeScore).toBeLessThan(80);
      expect(result.timeVarianceMinutes).toBe(60);
      expect(result.assessmentLabel).toBe('OVERDUE');
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
      expect(result.repetitionScore).toBeLessThan(100);
    });

    it('passes unique tasks with full score', () => {
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
      expect(result.repetitionScore).toBe(100);
      expect(result.matchedTaskId).toBeNull();
    });

    it('handles empty historical tasks gracefully', () => {
      const result = detectRepetitiveTask('New Feature', 'Initial setup', []);
      expect(result.isRepetitive).toBe(false);
      expect(result.repetitionScore).toBe(100);
    });
  });

  describe('computeCompositeTaskScore', () => {
    it('correctly calculates weighted score with QA review bonus', () => {
      const score = computeCompositeTaskScore({
        timeScore: 90,
        commentQualityScore: 85,
        complexityScore: 80,
        repetitionScore: 100,
        isQAReview: true,
      });

      // 90*0.35 + 85*0.25 + 80*0.20 + 100*0.20 = 31.5 + 21.25 + 16 + 20 = 88.75 + 3 (QA bonus) = 91.75 -> 92
      expect(score).toBe(92);
    });
  });
});
