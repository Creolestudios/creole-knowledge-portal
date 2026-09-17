import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/admin', () => ({
  requireAdminUser: vi.fn().mockResolvedValue({ userId: 'admin-1' }),
}));

import { POST } from './route';

describe('POST /api/ai-interview/extract', () => {
  it('returns 400 when both resume and JD inputs are empty', async () => {
    const req = new NextRequest('http://localhost:3000/api/ai-interview/extract', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resumeText: '', jdText: '' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain('Please provide both Resume and Job Description');
  });

  it('returns 400 when resume input is missing', async () => {
    const req = new NextRequest('http://localhost:3000/api/ai-interview/extract', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resumeText: '', jdText: 'Looking for React developer' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toContain('Resume content or file is missing.');
  });

  it('returns 200 with extracted keywords when valid JSON payload provided', async () => {
    const req = new NextRequest('http://localhost:3000/api/ai-interview/extract', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        resumeText: 'Frontend Engineer with React, TypeScript, Next.js, and CSS expertise.',
        jdText: 'Seeking React Developer with TypeScript and Next.js experience.',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.analysis).toBeDefined();
    expect(data.analysis.matchedKeywords).toBeDefined();
    expect(data.candidateProfile).toBeDefined();
    expect(data.jdRequirements).toBeDefined();
  });
});
