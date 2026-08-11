import { describe, it, expect, vi } from 'vitest';
import { evaluateDescriptiveAnswer } from './quiz-evaluator';

// Mock GoogleGenAI
vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      models = {
        generateContent: vi.fn().mockResolvedValue({
          text: JSON.stringify({ isCorrect: true, reason: 'Test reason' })
        })
      };
    }
  };
});

describe('Quiz Evaluator AI Service', () => {
  it('should return 0 points and incorrect if user answer is empty', async () => {
    const result = await evaluateDescriptiveAnswer('conceptual', 'Explain React?', ['Virtual DOM'], '   ');
    expect(result.isCorrect).toBe(false);
    expect(result.points).toBe(0);
    expect(result.reason).toBe('No answer provided.');
  });

  it('should award 2 points for correct descriptive answers', async () => {
    const result = await evaluateDescriptiveAnswer('descriptive', 'Explain Context API', ['State management', 'Provider'], 'It provides state to the whole app.');
    expect(result.isCorrect).toBe(true);
    expect(result.points).toBe(2);
    expect(result.reason).toBe('Test reason');
  });

  it('should award 1 point for conceptual answers', async () => {
    const result = await evaluateDescriptiveAnswer('conceptual', 'What is a closure?', ['Functions scope'], 'A function that remembers its outer variables.');
    expect(result.isCorrect).toBe(true);
    expect(result.points).toBe(1);
  });
});
