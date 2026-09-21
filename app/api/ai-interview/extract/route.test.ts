import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockRequireAdminUser, mockExtractKeywords } = vi.hoisted(() => ({
  mockRequireAdminUser: vi.fn(),
  mockExtractKeywords: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  requireAdminUser: mockRequireAdminUser,
}));

vi.mock('@/lib/ai-interview/extractor', () => ({
  extractKeywordsFromResumeAndJD: mockExtractKeywords,
}));

import { POST } from './route';

function reqWith(body: unknown, type?: string) {
  return new NextRequest('http://localhost:3000/api/ai-interview/extract', {
    method: 'POST',
    headers: type ? { 'content-type': type } : undefined,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/ai-interview/extract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    mockExtractKeywords.mockResolvedValue({
      candidateProfile: { extractedSkills: ['react'] },
      jdRequirements: { mustHaveSkills: ['react'] },
      analysis: { matchedKeywords: ['react'], missingKeywords: [], skillGapSummary: '' },
    });
  });

  it('returns 401 when the caller is not an admin', async () => {
    mockRequireAdminUser.mockResolvedValue(null);
    const res = await POST(reqWith({ resumeText: 'React', jdText: 'React' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 when both resume and JD inputs are empty', async () => {
    const res = await POST(reqWith({ resumeText: '', jdText: '' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Please provide both Resume and Job Description');
  });

  it('returns 400 when resume input is missing', async () => {
    const res = await POST(reqWith({ resumeText: '', jdText: 'Looking for React developer' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Resume content or file is missing.');
  });

  it('returns 400 when JD input is missing', async () => {
    const res = await POST(reqWith({ resumeText: 'React engineer', jdText: '' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Job Description content or file is missing.');
  });

  it('accepts a JSON payload and forwards the extraction request', async () => {
    const res = await POST(reqWith({
      resumeText: 'Frontend Engineer with React and TypeScript.',
      jdText: 'Seeking React Developer with TypeScript.',
    }));
    expect(res.status).toBe(200);
    expect(mockExtractKeywords).toHaveBeenCalledWith({
      resumeText: 'Frontend Engineer with React and TypeScript.',
      jdText: 'Seeking React Developer with TypeScript.',
    });
  });

  it('accepts multipart text files and parses them', async () => {
    const form = new FormData();
    form.append('resumeFile', new File(['React TypeScript Engineer'], 'resume.txt', { type: 'text/plain' }));
    form.append('jdFile', new File(['Seeking React and TypeScript developer'], 'jd.txt', { type: 'text/plain' }));

    const req = new NextRequest('http://localhost:3000/api/ai-interview/extract', {
      method: 'POST',
      body: form,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockExtractKeywords).toHaveBeenCalledWith(expect.objectContaining({
      resumeText: expect.stringContaining('React TypeScript Engineer'),
      jdText: expect.stringContaining('Seeking React and TypeScript developer'),
    }));
  });

  it('accepts multipart binary files and encodes them as base64', async () => {
    const form = new FormData();
    form.append('resumeFile', new File(['resume-binary'], 'resume.pdf', { type: 'application/pdf' }));
    form.append('jdFile', new File(['jd-binary'], 'jd.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));

    const req = new NextRequest('http://localhost:3000/api/ai-interview/extract', {
      method: 'POST',
      body: form,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(mockExtractKeywords).toHaveBeenCalledWith(expect.objectContaining({
      resumeFileBase64: expect.any(String),
      jdFileBase64: expect.any(String),
      resumeMimeType: 'application/pdf',
      jdMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }));
  });

  it('returns 500 when extraction throws', async () => {
    mockExtractKeywords.mockRejectedValue(new Error('Gemini down'));
    const res = await POST(reqWith({
      resumeText: 'Frontend Engineer with React and TypeScript.',
      jdText: 'Seeking React Developer with TypeScript.',
    }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Gemini down');
  });
});
