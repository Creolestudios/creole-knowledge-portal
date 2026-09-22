import { describe, it, expect, vi } from 'vitest';

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: class GoogleGenAI {
      static mockError = false;
      static mockMalformed = false;
      static mockResponseText: string | null = null;
      models = {
        generateContent: vi.fn().mockImplementation(() => {
          if (GoogleGenAI.mockError) {
            if (GoogleGenAI.mockMalformed) {
              return Promise.resolve({ text: 'Not a JSON' });
            }
            return Promise.reject(new Error('API Error'));
          }
          if (GoogleGenAI.mockResponseText) {
            return Promise.resolve({ text: GoogleGenAI.mockResponseText });
          }
          return Promise.resolve({
            text: '[{"question_text":"Gemini generated question?","question_type":"behavioral","category":"teamwork","difficulty":"medium","required_skills":["Teamwork"],"intent":"Test intent"}]'
          });
        })
      };
    }
  };
});
import {
  generateQuestionsLocalFallback,
  assembleQuestionSet,
  DEFAULT_MANDATORY_HR_QUESTIONS,
  generateInterviewQuestions,
  calculateQuestionCount,
  QUESTION_BANK,
} from './question-generator';
import { CandidateProfile, JDRequirements, KeywordMatchAnalysis } from './types';

describe('question-generator', () => {
  const sampleProfile: CandidateProfile = {
    summary: 'Experienced Fullstack Engineer',
    yearsOfExperience: 5,
    extractedSkills: ['React', 'TypeScript', 'Node.js'],
    domains: ['Web Development'],
  };

  const sampleJd: JDRequirements = {
    jobTitle: 'Senior Frontend Developer',
    mustHaveSkills: ['React', 'TypeScript', 'GraphQL', 'Docker'],
    niceToHaveSkills: ['AWS'],
    keyResponsibilities: ['Build web UI'],
  };

  const sampleAnalysis: KeywordMatchAnalysis = {
    matchPercentage: 50,
    matchedKeywords: ['react', 'typescript'],
    missingKeywords: ['graphql', 'docker'],
    resumeOnlyKeywords: ['node.js'],
    skillGapSummary: 'Missing GraphQL and Docker',
    keyStrengths: ['react', 'typescript'],
    improvementAreas: ['graphql', 'docker'],
  };

  it('uses administrator-provided question count or duration', () => {
    expect(calculateQuestionCount()).toBe(0);
    expect(calculateQuestionCount({ durationMinutes: 15 })).toBe(6);
    expect(calculateQuestionCount({ durationMinutes: 20 })).toBe(8);
    expect(calculateQuestionCount({ durationMinutes: 30 })).toBe(12);
    expect(calculateQuestionCount({ durationMinutes: 45 })).toBe(18);
    expect(calculateQuestionCount({ targetQuestions: 5 })).toBe(5);
    expect(calculateQuestionCount({ targetQuestions: 15 })).toBe(15);
  });

  it('generates the administrator-selected count and category allocation', () => {
    const questions = generateQuestionsLocalFallback(sampleProfile, sampleJd, sampleAnalysis, {
      targetQuestions: 4,
      durationMinutes: 20,
      categoryCounts: {
        teamwork: 2,
        culture_fit: 2,
      },
      includeMandatoryHr: false,
    });
    expect(questions.length).toBe(4);
    expect(questions.map((question) => question.category)).toEqual([
      'teamwork',
      'teamwork',
      'culture_fit',
      'culture_fit',
    ]);

    // Check sequential order index
    for (let i = 0; i < questions.length; i++) {
      expect(questions[i].question_order).toBe(i + 1);
    }
  });

  it('generates 4 distinct technical questions in the local fallback, not duplicates', () => {
    const questions = generateQuestionsLocalFallback(sampleProfile, sampleJd, sampleAnalysis, {
      targetQuestions: 4,
      categoryCounts: { technical: 4 },
      includeMandatoryHr: false,
    });
    expect(questions.length).toBe(4);
    expect(questions.every((q) => q.category === 'technical')).toBe(true);
    const uniqueTexts = new Set(questions.map((q) => q.question_text));
    expect(uniqueTexts.size).toBe(4);
  });

  it('returns the exact questions selected from the question bank', async () => {
    const selected = QUESTION_BANK.filter((question) =>
      ['teamwork-1', 'culture_fit-2', 'hr-3'].includes(question.id)
    );
    const result = await generateInterviewQuestions(sampleProfile, sampleJd, sampleAnalysis, undefined, {
      targetQuestions: selected.length,
      durationMinutes: 15,
      selectedQuestionIds: selected.map((question) => question.id),
      includeMandatoryHr: false,
    });

    expect(result.map((question) => question.id)).toEqual(selected.map((question) => question.id));
    expect(result.map((question) => question.question_text)).toEqual(
      selected.map((question) => question.question_text)
    );
  });

  it('appends admin-authored custom questions after selected bank questions', async () => {
    const selected = QUESTION_BANK.filter((question) => question.id === 'hr-1');
    const customQuestion = 'How would you handle a production incident on your first week?';
    const result = await generateInterviewQuestions(sampleProfile, sampleJd, sampleAnalysis, undefined, {
      targetQuestions: 2,
      durationMinutes: 10,
      selectedQuestionIds: selected.map((question) => question.id),
      customQuestions: ['  ', customQuestion],
      includeMandatoryHr: false,
    });

    expect(result).toHaveLength(2);
    expect(result[0].question_text).toBe(selected[0].question_text);
    expect(result[0].is_custom).toBe(false);
    expect(result[1].question_text).toBe(customQuestion);
    expect(result[1].is_custom).toBe(true);
    expect(result[1].category).toBe('custom');
    expect(result[1].question_bank_id).toBeNull();
  });

  it('scales generated questions for longer interview durations', () => {
    const questions45m = generateQuestionsLocalFallback(
      sampleProfile,
      sampleJd,
      sampleAnalysis,
      { durationMinutes: 45 }
    );
    expect(questions45m.length).toBe(18);
  });

  it('assembles AI questions and HR questions in correct order', () => {
    const customAiQuestions = [
      {
        question_text: 'What is GraphQL schema execution?',
        question_type: 'technical' as const,
        category: 'GraphQL',
        difficulty: 'medium' as const,
        required_skills: ['GraphQL'],
        question_order: 3,
        time_limit_sec: 180,
        is_mandatory_hr: false,
      },
    ];

    const assembled = assembleQuestionSet(customAiQuestions, DEFAULT_MANDATORY_HR_QUESTIONS);
    expect(assembled[0].is_mandatory_hr).toBe(true);
    expect(assembled[0].question_order).toBe(1);
    expect(assembled[1].is_mandatory_hr).toBe(true);
    expect(assembled[1].question_order).toBe(2);
    expect(assembled[2].question_text).toContain('GraphQL');
    expect(assembled[2].question_order).toBe(3);
    expect(assembled[assembled.length - 1].question_order).toBe(assembled.length);
  });

  it('fallback triggers when GEMINI_API_KEY is missing and uses administrator count', async () => {
    const prevKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const result = await generateInterviewQuestions(sampleProfile, sampleJd, sampleAnalysis, undefined, {
      targetQuestions: 8,
      categoryCounts: { hr: 8 },
      includeMandatoryHr: false,
    });
    expect(result.length).toBe(8);
    expect(result.every((question) => question.category === 'hr')).toBe(true);

    process.env.GEMINI_API_KEY = prevKey;
  });
  it('generates questions using Gemini API when key is present', async () => {
    process.env.GEMINI_API_KEY = 'mock-key';
    const { GoogleGenAI } = await import('@google/genai');
    // @ts-ignore
    GoogleGenAI.mockError = false;
    GoogleGenAI.mockMalformed = false;

    const result = await generateInterviewQuestions(sampleProfile, sampleJd, sampleAnalysis, undefined, {
      targetQuestions: 1,
      categoryCounts: { teamwork: 1 },
      includeMandatoryHr: false,
    });
    console.log('Result:', result[0]);
    expect(result.length).toBe(1);
    expect(result[0].question_text).toBe('Gemini generated question?');
  });

  it('falls back to local when Gemini API returns malformed JSON', async () => {
    process.env.GEMINI_API_KEY = 'mock-key';
    const { GoogleGenAI } = await import('@google/genai');
    // @ts-ignore
    GoogleGenAI.mockError = true;
    GoogleGenAI.mockMalformed = true;
    
    const result = await generateInterviewQuestions(sampleProfile, sampleJd, sampleAnalysis, undefined, {
      targetQuestions: 1,
      categoryCounts: { teamwork: 1 },
      includeMandatoryHr: false,
    });
    expect(result.length).toBe(1);
    expect(result[0].question_text).not.toBe('Gemini generated question?');
  });

  it('falls back to local when Gemini API throws an error', async () => {
    process.env.GEMINI_API_KEY = 'mock-key';
    const { GoogleGenAI } = await import('@google/genai');
    // @ts-ignore
    GoogleGenAI.mockError = true;
    GoogleGenAI.mockMalformed = false;

    const result = await generateInterviewQuestions(sampleProfile, sampleJd, sampleAnalysis, undefined, {
      targetQuestions: 1,
      categoryCounts: { teamwork: 1 },
      includeMandatoryHr: false,
    });
    expect(result.length).toBe(1);
    expect(result[0].question_text).not.toBe('Gemini generated question?');
  });

  it('falls back to local (distinct) questions when Gemini repeats the same technical question', async () => {
    process.env.GEMINI_API_KEY = 'mock-key';
    const { GoogleGenAI } = await import('@google/genai');
    // @ts-ignore
    GoogleGenAI.mockError = false;
    // @ts-ignore
    GoogleGenAI.mockMalformed = false;
    const duplicateTechnical = Array.from({ length: 4 }, () => ({
      question_text: 'Tell us about a technical project.',
      question_type: 'role_specific',
      category: 'technical',
      difficulty: 'medium',
      required_skills: ['Technical Depth'],
      intent: 'Assess technical depth.',
    }));
    // @ts-ignore
    GoogleGenAI.mockResponseText = JSON.stringify(duplicateTechnical);

    const result = await generateInterviewQuestions(sampleProfile, sampleJd, sampleAnalysis, undefined, {
      targetQuestions: 4,
      categoryCounts: { technical: 4 },
      includeMandatoryHr: false,
    });

    expect(result.length).toBe(4);
    expect(result.every((q) => q.category === 'technical')).toBe(true);
    const uniqueTexts = new Set(result.map((q) => q.question_text));
    expect(uniqueTexts.size).toBe(4);

    // @ts-ignore
    GoogleGenAI.mockResponseText = null;
  });
});
