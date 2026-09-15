import { describe, it, expect, vi, beforeEach } from 'vitest';
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
});

describe('extractKeywordsFromResumeAndJD', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
});
