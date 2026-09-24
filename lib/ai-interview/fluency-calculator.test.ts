import { describe, it, expect } from 'vitest';
import {
  countFillerWords,
  calculateWPM,
  calculateLocalFluency,
  combineFluencyScores,
  calculateCognitiveComposite,
  mapCefrToScore,
} from './fluency-calculator';

describe('fluency-calculator', () => {
  describe('countFillerWords', () => {
    it('detects common single-word and two-word fillers', () => {
      const text = 'Um, I think, like, we should basically use sort of a microservice architecture, you know?';
      const result = countFillerWords(text);

      expect(result.count).toBeGreaterThanOrEqual(4);
      expect(result.breakdown['um']).toBe(1);
      expect(result.breakdown['like']).toBe(1);
      expect(result.breakdown['basically']).toBe(1);
      expect(result.breakdown['you know']).toBe(1);
      expect(result.breakdown['sort of']).toBe(1);
      expect(result.ratio).toBeGreaterThan(0.2);
    });

    it('returns zero for clean speech without fillers', () => {
      const text = 'We deployed the Next.js application using standard Docker containers and Kubernetes clusters.';
      const result = countFillerWords(text);

      expect(result.count).toBe(0);
      expect(result.ratio).toBe(0);
    });

    it('handles empty or malformed input safely', () => {
      expect(countFillerWords('').count).toBe(0);
      expect(countFillerWords(null as unknown as string).count).toBe(0);
    });
  });

  describe('calculateWPM', () => {
    it('calculates prose WPM correctly', () => {
      // 150 words in 60,000 ms (1 minute) = 150 WPM
      expect(calculateWPM(150, 60000)).toBe(150);
      // 75 words in 30,000 ms (0.5 minute) = 150 WPM
      expect(calculateWPM(75, 30000)).toBe(150);
    });

    it('handles zero or invalid speech time gracefully', () => {
      expect(calculateWPM(50, 0)).toBe(0);
      expect(calculateWPM(0, 10000)).toBe(0);
    });
  });

  describe('calculateLocalFluency', () => {
    it('gives a high score for ideal speech characteristics', () => {
      const result = calculateLocalFluency({
        wordCount: 140,
        speechMs: 60000, // 140 WPM (in 110-170 target)
        pauseMsTotal: 5000,
        pauseCount: 2, // 2 pauses/min (in <4 target)
        fillerCount: 2, // 2/140 = 1.4% (in <3% target)
        responseLatencyMs: 800, // 800ms (in 300-1800 target)
      });

      expect(result.wpm).toBe(140);
      expect(result.localFluencyScore).toBeGreaterThanOrEqual(90);
    });

    it('penalizes very slow speech with high filler ratio', () => {
      const result = calculateLocalFluency({
        wordCount: 50,
        speechMs: 60000, // 50 WPM (sluggish)
        pauseMsTotal: 30000,
        pauseCount: 16, // excessive pauses
        fillerCount: 10, // 20% fillers
        responseLatencyMs: 4000, // high latency
      });

      expect(result.wpm).toBe(50);
      expect(result.localFluencyScore).toBeLessThan(50);
    });
  });

  describe('CEFR Mapping and Score Combinations', () => {
    it('maps CEFR levels correctly', () => {
      expect(mapCefrToScore('C2')).toBe(95);
      expect(mapCefrToScore('B2')).toBe(72);
      expect(mapCefrToScore('A2')).toBe(35);
    });

    it('combines local and model fluency scores accurately', () => {
      // 45% of 80 (36) + 55% of 90 (49.5) = 86
      const combined = combineFluencyScores(80, 90);
      expect(combined).toBe(86);
    });

    it('calculates cognitive composite from competency avg, reasoning, and clarity', () => {
      // Competency 4/5 -> 75 pts. 60% of 75 = 45. 30% of 80 = 24. 10% of 90 = 9. Total = 78.
      const composite = calculateCognitiveComposite(4, 80, 90);
      expect(composite).toBe(78);
    });
  });
});
