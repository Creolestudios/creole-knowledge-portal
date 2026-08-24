import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateQuizForBlog } from './quiz-generator';

const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockEq = vi.fn();
const mockUpsert = vi.fn();
const mockSingle = vi.fn();

vi.mock('@/lib/supabase/admin', () => {
  return {
    supabaseAdmin: {
      from: vi.fn((table: string) => {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnValue({
            single: mockSingle,
            eq: mockEq,
          }),
          single: mockSingle,
          upsert: mockUpsert,
          insert: mockInsert,
          update: mockUpdate.mockReturnValue({ eq: mockEq.mockReturnValue({ error: null }) })
        };
      })
    }
  };
});

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

describe('Quiz Generator AI Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSingle.mockReturnValue({ data: { id: 'ebd00000-0000-0000-0000-000000000000' }, error: null });
    mockInsert.mockReturnValue({ error: null });
    mockUpsert.mockReturnValue({ error: null });
    mockUpdate.mockReturnValue({ eq: mockEq.mockReturnValue({ error: null }) });
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
  });

  it('should strip markdown formatting before parsing JSON', async () => {
    mockGenerateContent.mockResolvedValue({
      text: "```json\n" + validJsonResponse + "\n```"
    });

    const resultCount = await generateQuizForBlog('test-blog-id', 'test content');
    expect(resultCount).toBe(1);
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it('should include exclusion context when existingQuestionTexts are provided', async () => {
    mockGenerateContent.mockResolvedValue({
      text: validJsonResponse
    });

    await generateQuizForBlog('test-blog-id', 'test content', 5, ['Previous Question 1']);
    expect(mockGenerateContent).toHaveBeenCalled();
  });

  it('should retry on transient 429/503 errors and succeed on subsequent attempt', async () => {
    vi.useFakeTimers();
    mockGenerateContent
      .mockRejectedValueOnce(new Error('503 Service Unavailable'))
      .mockResolvedValueOnce({ text: validJsonResponse });

    const promise = generateQuizForBlog('test-blog-id', 'test content');
    await vi.runAllTimersAsync();
    const resultCount = await promise;

    expect(resultCount).toBe(1);
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('should fallback to deterministic questions when AI throws immediately', async () => {
    mockGenerateContent.mockRejectedValue(new Error('Fatal Error'));

    const resultCount = await generateQuizForBlog('test-blog-id', 'test content');
    expect(resultCount).toBe(5);
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it('should upsert parent blog record with H2 header title if blog does not exist', async () => {
    mockSingle.mockReturnValue({ data: null, error: { message: 'not found' } });
    mockGenerateContent.mockResolvedValue({ text: validJsonResponse });

    const blogContentWithH2 = "## Architecture Deep Dive\n\nSome text content here.";
    const resultCount = await generateQuizForBlog('test-blog-id', blogContentWithH2);

    expect(resultCount).toBe(1);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Architecture Deep Dive' }),
      { onConflict: 'id' }
    );
  });

  it('should upsert parent blog record with plain line title if no H1/H2 header present', async () => {
    mockSingle.mockReturnValue({ data: null, error: { message: 'not found' } });
    mockGenerateContent.mockResolvedValue({ text: validJsonResponse });

    const blogContentPlain = "Regular paragraph line introducing technical concept.";
    const resultCount = await generateQuizForBlog('test-blog-id', blogContentPlain);

    expect(resultCount).toBe(1);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Regular paragraph line introducing technical concept.' }),
      { onConflict: 'id' }
    );
  });

  it('should throw error if parent blog upsert fails', async () => {
    mockSingle.mockReturnValue({ data: null, error: { message: 'not found' } });
    mockUpsert.mockReturnValue({ error: { message: 'FK violation' } });
    mockGenerateContent.mockResolvedValue({ text: validJsonResponse });

    await expect(generateQuizForBlog('test-blog-id', 'some content')).rejects.toThrow('Failed to create parent blog row: FK violation');
  });

  it('should fallback to deterministic questions if AI returns invalid non-JSON string', async () => {
    mockGenerateContent.mockResolvedValue({
      text: 'Sorry, I cannot generate this.'
    });

    const resultCount = await generateQuizForBlog('test-blog-id', 'test content');
    expect(resultCount).toBe(5);
  });

  it('should throw error if database insert fails', async () => {
    mockGenerateContent.mockResolvedValue({
      text: validJsonResponse
    });
    mockInsert.mockReturnValue({ error: new Error('DB insert failed') });

    await expect(generateQuizForBlog('test-blog-id', 'test content')).rejects.toThrow('DB insert failed');
  });
});
