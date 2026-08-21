import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evaluateDescriptiveAnswer } from './quiz-evaluator';

const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      models = {
        generateContent: mockGenerateContent
      };
    }
  };
});

describe('Quiz Evaluator AI Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 0 points and incorrect if user answer is empty', async () => {
    const result = await evaluateDescriptiveAnswer('conceptual', 'Explain React?', ['Virtual DOM'], '   ');
    expect(result.isCorrect).toBe(false);
    expect(result.points).toBe(0);
    expect(result.reason).toBe('No answer provided.');
  });

  it('should award 2 points for correct descriptive answers', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ isCorrect: true, reason: 'Test reason' }),
    });
    const result = await evaluateDescriptiveAnswer('descriptive', 'Explain Context API', ['State management', 'Provider'], 'It provides state to the whole app.');
    expect(result.isCorrect).toBe(true);
    expect(result.points).toBe(2);
    expect(result.reason).toBe('Test reason');
  });

  it('should strip markdown formatting from AI json response', async () => {
    mockGenerateContent.mockResolvedValue({
      text: "```json\n" + JSON.stringify({ isCorrect: true, reason: 'Stripped markdown' }) + "\n```",
    });
    const result = await evaluateDescriptiveAnswer('code', 'Explain snippet', ['Hook'], 'It uses custom hooks.');
    expect(result.isCorrect).toBe(true);
    expect(result.points).toBe(2);
    expect(result.reason).toBe('Stripped markdown');
  });

  it('should fallback to heuristic concept matching when AI throws error', async () => {
    mockGenerateContent.mockRejectedValue(new Error('AI Service Down'));
    
    const resultPass = await evaluateDescriptiveAnswer('conceptual', 'What is Virtual DOM?', ['virtual dom', 'reconciliation'], 'Virtual DOM is an in-memory representation.');
    expect(resultPass.isCorrect).toBe(true);
    expect(resultPass.points).toBe(1);
    expect(resultPass.reason).toBe('Answer contains key expected concepts.');

    const resultFail = await evaluateDescriptiveAnswer('conceptual', 'What is Virtual DOM?', ['virtual dom'], 'Something unrelated.');
    expect(resultFail.isCorrect).toBe(false);
    expect(resultFail.points).toBe(0);
    expect(resultFail.reason).toBe('Answer did not closely align with expected concepts.');
  });
});
