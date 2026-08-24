import { describe, it, expect, vi, beforeEach } from 'vitest';

// Use vi.hoisted to ensure references are created before vi.mock executes
const { generateContentMock } = vi.hoisted(() => {
  return {
    generateContentMock: vi.fn().mockImplementation(async (args: any) => {
      if (args.contents && args.contents.includes('quiz')) {
        return {
          text: JSON.stringify([
            {
              id: 'q-1',
              question: 'What is Next.js?',
              options: ['Framework', 'Library', 'Language', 'Database'],
              correctOptionIndex: 0,
            },
            {
              id: 'q-2',
              question: 'What version of React does Next.js 15 use?',
              options: ['React 16', 'React 17', 'React 18', 'React 19'],
              correctOptionIndex: 3,
            },
            {
              id: 'q-3',
              question: 'Who developed Next.js?',
              options: ['Google', 'Vercel', 'Meta', 'Microsoft'],
              correctOptionIndex: 1,
            },
          ]),
        };
      }

      return {
        text: JSON.stringify({
          qualityScore: 85,
          gibberishDetected: false,
          lowQualityDetected: false,
          aiSpamDetected: false,
          plagiarismOverlap: 10,
          reason: 'Well-written post with structured code examples.',
        }),
      };
    }),
  };
});

// Mock the module using the class constructor structure
vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class {
      models = {
        generateContent: generateContentMock,
      };
    },
  };
});

import { validateContent, generateQuiz } from './validator';

describe('AI Validator Pipeline Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should validate blog content and return structured validation report', async () => {
    const report = await validateContent(
      'Getting Started with Next.js 15',
      'Next.js 15 introduces React 19 support and many new routing capabilities.',
      []
    );

    expect(report).toBeDefined();
    expect(report.qualityScore).toBe(85);
    expect(report.gibberishDetected).toBe(false);
    expect(report.lowQualityDetected).toBe(false);
    expect(report.aiSpamDetected).toBe(false);
    expect(report.plagiarismOverlap).toBe(10); // Matches the mock return value
    expect(report.reason).toContain('Well-written');
  });

  it('should factor Jaccard similarity when comparing to existing submissions', async () => {
    const existingContent =
      'Next.js 15 introduces React 19 support and many new routing capabilities.';
    const newContent = 'Next.js 15 introduces React 19 support and many new routing capabilities.';

    const report = await validateContent('Getting Started with Next.js 15', newContent, [
      {
        id: '1',
        title: 'Existing Next.js Post',
        content: existingContent,
        author: 'user@example.com',
        status: 'APPROVED',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    // Jaccard similarity should be 100% since content is identical
    expect(report.plagiarismOverlap).toBe(100);
  });

  it('should generate exactly 3 comprehension quiz questions', async () => {
    const quiz = await generateQuiz('Next.js 15 is a framework by Vercel utilizing React 19.');

    expect(quiz).toHaveLength(3);
    expect(quiz[0].question).toBe('What is Next.js?');
    expect(quiz[0].options).toHaveLength(4);
    expect(quiz[0].correctOptionIndex).toBe(0);
    expect(quiz[1].question).toBe('What version of React does Next.js 15 use?');
    expect(quiz[2].correctOptionIndex).toBe(1);
  });

  it('returns fallback validation report when AI generation fails', async () => {
    generateContentMock.mockRejectedValueOnce(new Error('AI API Down'));
    const report = await validateContent('Title', 'Content', []);
    
    expect(report.qualityScore).toBe(50);
    expect(report.gibberishDetected).toBe(false);
    expect(report.reason).toBe('Fallback validation due to AI check failure.');
  });

  it('returns fallback quiz when AI generation fails', async () => {
    generateContentMock.mockRejectedValueOnce(new Error('AI API Down'));
    const quiz = await generateQuiz('Some content');
    
    expect(quiz).toHaveLength(3);
    expect(quiz[0].id).toBe('q-1');
    expect(quiz[0].question).toBe('What is the primary topic of the submitted blog?');
    expect(quiz[1].question).toBe('Which of the following describes the tone of this content?');
  });
});
