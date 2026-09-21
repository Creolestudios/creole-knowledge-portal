import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerateContent = vi.hoisted(() => vi.fn());

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: mockGenerateContent };
  },
}));

import { extractKeywordsFromResumeAndJD, extractKeywordsLocalFallback } from './extractor';

describe('extractKeywordsLocalFallback', () => {
  it('correctly matches overlapping technical keywords between resume and JD', () => {
    const resumeText = 'Senior React Developer with experience in TypeScript, Node.js, Next.js, and PostgreSQL.';
    const jdText = 'Looking for a React Developer skilled in TypeScript, Next.js, Docker, and AWS.';

    const result = extractKeywordsLocalFallback(resumeText, jdText);

    expect(result.analysis.matchedKeywords).toContain('react');
    expect(result.analysis.matchedKeywords).toContain('typescript');
    expect(result.analysis.matchedKeywords).toContain('next.js');
    expect(result.analysis.missingKeywords).toContain('docker');
    expect(result.analysis.missingKeywords).toContain('aws');
    expect(result.analysis.matchPercentage).toBeGreaterThan(0);
    expect(result.extractedAt).toBeDefined();
  });

  it('strips leading/trailing dots and punctuation from words without catastrophic backtracking', () => {
    const resumeText = '...Experienced with C++ ...and Node.js, (great), skills!';
    const jdText = 'C++ and Node.js required.';

    const start = Date.now();
    const result = extractKeywordsLocalFallback(resumeText, jdText);
    expect(Date.now() - start).toBeLessThan(500);

    expect(result.candidateProfile.extractedSkills).toContain('c++');
    expect(result.candidateProfile.extractedSkills).toContain('node.js');
    expect(result.candidateProfile.extractedSkills).not.toContain('...experienced');
  });

  it('does not hang on long dot-heavy strings (regression for superlinear regex)', () => {
    const pathological = `${'.'.repeat(5000)}word${'.'.repeat(5000)}`;
    const start = Date.now();
    const result = extractKeywordsLocalFallback(pathological, 'word');
    expect(Date.now() - start).toBeLessThan(1000);
    expect(result.analysis.matchedKeywords).toContain('word');
  });
});

describe('extractKeywordsFromResumeAndJD', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockGenerateContent.mockReset();
  });

  it('throws an error if both text and file inputs are missing', async () => {
    await expect(extractKeywordsFromResumeAndJD({})).rejects.toThrow(
      'Resume text or file content is required.'
    );
  });

  it('throws an error if JD input is missing', async () => {
    await expect(
      extractKeywordsFromResumeAndJD({ resumeText: 'React developer resume' })
    ).rejects.toThrow('Job Description (JD) text or file content is required.');
  });

  it('uses fallback parser gracefully when GEMINI_API_KEY is not set', async () => {
    const originalApiKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const result = await extractKeywordsFromResumeAndJD({
      resumeText: 'Fullstack Engineer Python FastAPI React Next.js',
      jdText: 'Python Developer FastAPI PostgreSQL Docker',
    });

    expect(result.candidateProfile).toBeDefined();
    expect(result.jdRequirements).toBeDefined();
    expect(result.analysis.matchedKeywords).toContain('python');
    expect(result.analysis.matchedKeywords).toContain('fastapi');

    process.env.GEMINI_API_KEY = originalApiKey;
  });

  it('parses the Gemini response, stripping any surrounding non-JSON prose', async () => {
    const originalApiKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-key';

    const jsonPayload = {
      candidateProfile: {
        name: 'Jane Doe',
        summary: 'Experienced engineer',
        extractedSkills: ['react'],
        domains: ['Engineering'],
        yearsOfExperience: 5,
      },
      jdRequirements: {
        mustHaveSkills: ['react'],
        niceToHaveSkills: [],
        keyResponsibilities: ['Build things'],
      },
      analysis: {
        matchPercentage: 90,
        matchedKeywords: ['react'],
        missingKeywords: [],
        resumeOnlyKeywords: [],
        skillGapSummary: 'Strong match',
        keyStrengths: ['react'],
        improvementAreas: [],
      },
    };

    mockGenerateContent.mockResolvedValueOnce({
      text: `Here is the JSON:\n${JSON.stringify(jsonPayload)}\nThanks!`,
    });

    const result = await extractKeywordsFromResumeAndJD({
      resumeText: 'Jane Doe resume',
      jdText: 'React JD',
    });

    expect(result.candidateProfile.name).toBe('Jane Doe');
    expect(result.analysis.matchPercentage).toBe(90);
    expect(result.analysis.matchedKeywords).toEqual(['react']);

    process.env.GEMINI_API_KEY = originalApiKey;
  });

  it('falls back to the local parser when every Gemini model call fails', async () => {
    const originalApiKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-key';

    mockGenerateContent.mockRejectedValue(new Error('model unavailable'));

    const result = await extractKeywordsFromResumeAndJD({
      resumeText: 'Python FastAPI engineer',
      jdText: 'Python FastAPI role',
    });

    expect(result.analysis.matchedKeywords).toContain('python');

    process.env.GEMINI_API_KEY = originalApiKey;
  });
});
