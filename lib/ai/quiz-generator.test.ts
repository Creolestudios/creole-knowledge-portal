import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateQuizForBlog } from './quiz-generator';

const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockEq = vi.fn();

// Mock Supabase
vi.mock('@/lib/supabase/admin', () => {
  return {
    supabaseAdmin: {
      from: vi.fn((table: string) => {
        return {
          insert: mockInsert.mockReturnValue({ error: null }),
          update: mockUpdate.mockReturnValue({ eq: mockEq.mockReturnValue({ error: null }) })
        };
      })
    }
  };
});

const mockGenerateContent = vi.fn();

// Mock GoogleGenAI
vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      models = {
        generateContent: mockGenerateContent
      };
    }
  };
});

describe('Quiz Generator AI Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validJsonResponse = `[
    {
      "question_type": "single",
      "difficulty": "Hard",
      "question": "Test Question?",
      "options": ["A", "B", "C", "D"],
      "correct_answers": ["A"],
      "explanation": "Because A",
      "code_snippet": null
    }
  ]`;

  it('should successfully parse valid JSON and insert to supabase', async () => {
    mockGenerateContent.mockResolvedValue({
      text: validJsonResponse
    });

    const resultCount = await generateQuizForBlog('test-blog-id', 'test content');
    
    expect(resultCount).toBe(1);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockEq).toHaveBeenCalledWith('id', 'test-blog-id');
  });

  it('should strip markdown formatting before parsing JSON', async () => {
    mockGenerateContent.mockResolvedValue({
      text: "```json\n" + validJsonResponse + "\n```"
    });

    const resultCount = await generateQuizForBlog('test-blog-id', 'test content');
    expect(resultCount).toBe(1);
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it('should throw an error if AI returns invalid non-JSON string', async () => {
    mockGenerateContent.mockResolvedValue({
      text: 'Sorry, I cannot generate this.'
    });

    await expect(generateQuizForBlog('test-blog-id', 'test content')).rejects.toThrow('AI returned invalid JSON format for quiz questions.');
  });
});
