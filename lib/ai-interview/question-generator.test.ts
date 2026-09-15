import { describe, it, expect } from 'vitest';
import {
  generateQuestionsLocalFallback,
  assembleQuestionSet,
  DEFAULT_MANDATORY_HR_QUESTIONS,
  generateInterviewQuestions,
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

  it('generates question set using local fallback', () => {
    const questions = generateQuestionsLocalFallback(sampleProfile, sampleJd, sampleAnalysis);
    expect(questions.length).toBeGreaterThanOrEqual(5);

    // Check mandatory HR questions are included
    const hrQuestions = questions.filter((q) => q.is_mandatory_hr);
    expect(hrQuestions.length).toBe(3);

    // Check sequential order index
    for (let i = 0; i < questions.length; i++) {
      expect(questions[i].question_order).toBe(i + 1);
    }
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

  it('fallback triggers when GEMINI_API_KEY is missing', async () => {
    const prevKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const result = await generateInterviewQuestions(sampleProfile, sampleJd, sampleAnalysis);
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((q) => q.is_mandatory_hr)).toBe(true);

    process.env.GEMINI_API_KEY = prevKey;
  });
});
