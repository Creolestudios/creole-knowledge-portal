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
      text: JSON.stringify({ matchPercentage: 90, reason: 'Test reason' }),
    });
    const result = await evaluateDescriptiveAnswer('descriptive', 'Explain Context API', ['State management', 'Provider'], 'It provides state to the whole app.');
    expect(result.isCorrect).toBe(true);
    expect(result.points).toBe(2);
    expect(result.reason).toBe('Test reason');
  });

  it('should strip markdown formatting from AI json response', async () => {
    mockGenerateContent.mockResolvedValue({
      text: "```json\n" + JSON.stringify({ matchPercentage: 90, reason: 'Stripped markdown' }) + "\n```",
    });
    const result = await evaluateDescriptiveAnswer('code', 'Explain snippet', ['Hook'], 'It uses custom hooks.');
    expect(result.isCorrect).toBe(true);
    expect(result.points).toBe(2);
    expect(result.reason).toBe('Stripped markdown');
  });

  it('should fallback to heuristic concept matching when AI throws error', async () => {
    mockGenerateContent.mockRejectedValue(new Error('AI Service Down'));
    
    const resultPass = await evaluateDescriptiveAnswer('conceptual', 'What is Virtual DOM?', ['virtual dom'], 'Virtual DOM is an in-memory representation.');
    expect(resultPass.isCorrect).toBe(true);
    expect(resultPass.points).toBe(1);
    expect(resultPass.reason).toBe('Answer aligns with expected concepts based on heuristic check.');

    const resultFail = await evaluateDescriptiveAnswer('conceptual', 'What is Virtual DOM?', ['virtual dom'], 'Something unrelated.');
    expect(resultFail.isCorrect).toBe(false);
    expect(resultFail.points).toBe(0);
    expect(resultFail.reason).toBe('Answer did not align closely with expected concepts.');
  });
  it('awards 1 partial point for a mid-range match on a 2-point question', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ matchPercentage: 60, reason: 'Partially there' }),
    });
    const result = await evaluateDescriptiveAnswer('descriptive', 'Explain hydration', ['SSR', 'client'], 'It renders on the server first.');
    expect(result.points).toBe(1);
    expect(result.isCorrect).toBe(false);
    expect(result.matchPercentage).toBe(60);
  });

  it('awards 0 points for a low match on a 2-point question', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ matchPercentage: 20, reason: 'Off topic' }),
    });
    const result = await evaluateDescriptiveAnswer('code', 'Explain snippet', ['Hook'], 'Unrelated.');
    expect(result.points).toBe(0);
    expect(result.isCorrect).toBe(false);
  });

  it('awards 1 point on a 1-point question once the match reaches 70', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ matchPercentage: 70, reason: 'Good enough' }),
    });
    const result = await evaluateDescriptiveAnswer('conceptual', 'What is RSC?', ['server component'], 'A component rendered on the server.');
    expect(result.points).toBe(1);
    expect(result.isCorrect).toBe(true);
  });

  it('defaults matchPercentage to 0 when the AI omits it', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ reason: 'No score returned' }),
    });
    const result = await evaluateDescriptiveAnswer('conceptual', 'What is RSC?', ['server component'], 'Some answer.');
    expect(result.matchPercentage).toBe(0);
    expect(result.points).toBe(0);
    expect(result.isCorrect).toBe(false);
  });

  it('falls back to a generated reason when the AI omits one', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ matchPercentage: 95 }),
    });
    const result = await evaluateDescriptiveAnswer('descriptive', 'Explain memoisation', ['cache'], 'It caches results.');
    expect(result.reason).toBe('Correct.');

    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ matchPercentage: 10 }),
    });
    const wrong = await evaluateDescriptiveAnswer('descriptive', 'Explain memoisation', ['cache'], 'No idea.');
    expect(wrong.reason).toBe('Incorrect.');
  });

  it('treats an empty AI response body as a parse failure and falls back', async () => {
    mockGenerateContent.mockResolvedValue({ text: undefined });
    const result = await evaluateDescriptiveAnswer('conceptual', 'What is a reducer?', ['pure function'], 'A pure function that returns state.');
    expect(result.isCorrect).toBe(true);
    expect(result.matchPercentage).toBe(100);
  });

  it('returns a zero result from the fallback when no usable concepts are supplied', async () => {
    mockGenerateContent.mockRejectedValue(new Error('AI Service Down'));
    const result = await evaluateDescriptiveAnswer('conceptual', 'What is X?', ['a', '  ', ''], 'Any answer at all.');
    expect(result.isCorrect).toBe(false);
    expect(result.points).toBe(0);
    expect(result.matchPercentage).toBe(0);
    expect(result.reason).toBe('Evaluation failed and no valid concepts found.');
  });

  it('awards 2 fallback points when every concept is matched on a 2-point question', async () => {
    mockGenerateContent.mockRejectedValue(new Error('AI Service Down'));
    const result = await evaluateDescriptiveAnswer(
      'descriptive',
      'Explain the render cycle',
      ['virtual dom', 'reconciliation'],
      'React builds a virtual dom and then performs reconciliation.'
    );
    expect(result.matchPercentage).toBe(100);
    expect(result.points).toBe(2);
    expect(result.isCorrect).toBe(true);
  });

  it('awards 1 fallback point when half the concepts are matched on a 2-point question', async () => {
    mockGenerateContent.mockRejectedValue(new Error('AI Service Down'));
    const result = await evaluateDescriptiveAnswer(
      'code',
      'Explain the render cycle',
      ['virtual dom', 'reconciliation'],
      'React builds a virtual dom.'
    );
    expect(result.matchPercentage).toBe(50);
    expect(result.points).toBe(1);
    expect(result.isCorrect).toBe(false);
  });

  it('awards 0 fallback points when nothing matches on a 2-point question', async () => {
    mockGenerateContent.mockRejectedValue(new Error('AI Service Down'));
    const result = await evaluateDescriptiveAnswer(
      'descriptive',
      'Explain the render cycle',
      ['virtual dom', 'reconciliation'],
      'Completely unrelated prose.'
    );
    expect(result.matchPercentage).toBe(0);
    expect(result.points).toBe(0);
  });
});
