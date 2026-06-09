import { GoogleGenAI } from '@google/genai';
import { Submission, ValidationReport, QuizQuestion } from '../data/db';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function calculateJaccardSimilarity(text1: string, text2: string): number {
  const normalize = (text: string) => {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2); // filter out tiny words
  };

  const words1 = new Set(normalize(text1));
  const words2 = new Set(normalize(text2));

  if (words1.size === 0 || words2.size === 0) return 0;

  let intersectionSize = 0;
  for (const word of words1) {
    if (words2.has(word)) {
      intersectionSize++;
    }
  }

  const unionSize = words1.size + words2.size - intersectionSize;
  return (intersectionSize / unionSize) * 100; // Return percentage 0-100
}

export async function validateContent(
  title: string,
  content: string,
  existingSubmissions: Submission[]
): Promise<ValidationReport> {
  // 1. Calculate Jaccard similarity against all existing submissions
  let maxJaccard = 0;
  let mostSimilarContent = '';

  for (const sub of existingSubmissions) {
    const sim = calculateJaccardSimilarity(content, sub.content);
    if (sim > maxJaccard) {
      maxJaccard = sim;
      mostSimilarContent = sub.content;
    }
  }

  // 2. Call Gemini for Quality, AI spam, Gibberish, and Semantic Plagiarism checks
  let prompt = `You are a blog validation checker. Check the following blog post:
Title: "${title}"
Content:
"""
${content}
"""
`;

  if (mostSimilarContent) {
    prompt += `\nCompare it against this previously submitted blog post to check for similarity or plagiarism:
Comparison Content:
"""
${mostSimilarContent}
"""
`;
  } else {
    prompt += `\nThere are no existing blogs to compare against for plagiarism. Set plagiarismOverlap to 0 unless the content is obviously copied from well-known sources.`;
  }

  prompt += `\n\nEvaluate the following:
1. Is the content gibberish, meaningless keyboard mash, or random strings of letters?
2. Is the content extremely low quality, short, lacking depth, or lacking informative value?
3. Is it AI-spammed marketing fluff or generic AI-generated filler text?
4. What is the overall quality score (0 to 100)?
5. What is the semantic overlap/plagiarism percentage (0 to 100) compared to the provided comparison content?

Return your findings in the requested JSON format.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            qualityScore: { type: 'INTEGER' },
            gibberishDetected: { type: 'BOOLEAN' },
            lowQualityDetected: { type: 'BOOLEAN' },
            aiSpamDetected: { type: 'BOOLEAN' },
            plagiarismOverlap: { type: 'INTEGER' },
            reason: { type: 'STRING' },
          },
          required: [
            'qualityScore',
            'gibberishDetected',
            'lowQualityDetected',
            'aiSpamDetected',
            'plagiarismOverlap',
            'reason',
          ],
        },
      },
    });

    const report = JSON.parse(response.text || '{}') as ValidationReport;

    // Combine Jaccard similarity with Gemini's assessment to be extra robust
    if (maxJaccard > report.plagiarismOverlap) {
      report.plagiarismOverlap = Math.round(maxJaccard);
    }

    return report;
  } catch (error) {
    console.error('AI Validation pipeline failed:', error);
    // Safe fallback in case of API error
    return {
      qualityScore: 50,
      gibberishDetected: false,
      lowQualityDetected: false,
      aiSpamDetected: false,
      plagiarismOverlap: Math.round(maxJaccard),
      reason: 'Fallback validation due to AI check failure.',
    };
  }
}

export async function generateQuiz(content: string): Promise<QuizQuestion[]> {
  const prompt = `You are a technical quiz generator. Generate exactly 3 multiple-choice comprehension questions from the following blog content.
Each question must test key technical points and have exactly 4 plausible options, with only one correct option.
Content:
"""
${content}
"""

Return your questions in the requested JSON format.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              id: { type: 'STRING' },
              question: { type: 'STRING' },
              options: {
                type: 'ARRAY',
                items: { type: 'STRING' },
              },
              correctOptionIndex: { type: 'INTEGER' },
            },
            required: ['id', 'question', 'options', 'correctOptionIndex'],
          },
        },
      },
    });

    const questions = JSON.parse(response.text || '[]') as QuizQuestion[];

    // Ensure we have exactly 3 questions, and assign clean IDs if necessary
    return questions.slice(0, 3).map((q, idx) => ({
      ...q,
      id: q.id || `q-${idx + 1}`,
    }));
  } catch (error) {
    console.error('Failed to generate quiz via Gemini:', error);
    // Simple fallback questions if generation fails
    return [
      {
        id: 'q-1',
        question: 'What is the primary topic of the submitted blog?',
        options: [
          'Technical innovation',
          'Marketing strategies',
          'Personal hobbies',
          'None of the above',
        ],
        correctOptionIndex: 0,
      },
      {
        id: 'q-2',
        question: 'Which of the following describes the tone of this content?',
        options: [
          'Informative & Educational',
          'Gibberish & Random',
          'Spam & Promotional',
          'Casual Chat',
        ],
        correctOptionIndex: 0,
      },
      {
        id: 'q-3',
        question: 'What is the primary goal of sharing this blog post?',
        options: [
          'To share knowledge with the team',
          'To test the AI validation engine',
          'To complete a task',
          'All of the above',
        ],
        correctOptionIndex: 3,
      },
    ];
  }
}
