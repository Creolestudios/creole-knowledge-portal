import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as createSession, GET as listSessions } from './route';
import { POST as parseSession } from './[id]/parse/route';
import { POST as generateQuestions } from './[id]/generate/route';
import { POST as createInvite } from './[id]/invite/route';
import { GET as getSession } from './[id]/route';

// Mock Supabase admin client for API route testing
vi.mock('@/lib/supabase/admin', () => {
  const dummySession = {
    id: 'test-session-123',
    candidate_name: 'Jane Doe',
    candidate_email: 'jane@example.com',
    status: 'draft',
    parsed_resume: { summary: 'Python & React Developer' },
    parsed_jd: { keyResponsibilities: ['Python backend development'] },
    skill_gap: { matchedKeywords: ['python'], missingKeywords: ['fastapi'] },
  };

  const dummyQuestions = [
    {
      id: 'q-1',
      session_id: 'test-session-123',
      question_text: 'Introduce yourself',
      question_type: 'hr',
      question_order: 1,
      is_mandatory_hr: true,
    },
    {
      id: 'q-2',
      session_id: 'test-session-123',
      question_text: 'Explain FastAPI routing',
      question_type: 'technical',
      question_order: 2,
      is_mandatory_hr: false,
    },
  ];

  const dummyInvite = {
    id: 'invite-123',
    session_id: 'test-session-123',
    token_hash: 'abc123hash',
    status: 'active',
  };

  const mockFrom = vi.fn().mockImplementation((table: string) => {
    if (table === 'interview_sessions') {
      return {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: dummySession, error: null }),
          }),
        }),
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: [dummySession], error: null }),
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: dummySession, error: null }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { ...dummySession, status: 'parsed' }, error: null }),
            }),
          }),
        }),
      };
    }
    if (table === 'hr_question_bank') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      };
    }
    if (table === 'interview_questions') {
      return {
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: dummyQuestions, error: null }),
        }),
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: dummyQuestions, error: null }),
          }),
        }),
      };
    }
    if (table === 'interview_invites') {
      return {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: dummyInvite, error: null }),
          }),
        }),
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [dummyInvite], error: null }),
          }),
        }),
      };
    }
    return {};
  });

  return {
    supabaseAdmin: {
      from: mockFrom,
    },
  };
});

describe('AI Interview Module API Endpoints', () => {
  it('POST /api/interviews creates a new interview session', async () => {
    const req = new NextRequest('http://localhost/api/interviews', {
      method: 'POST',
      body: JSON.stringify({
        candidate_name: 'Jane Doe',
        candidate_email: 'jane@example.com',
        resumeText: 'Experienced Python developer',
        jdText: 'Python FastAPI engineer',
      }),
    });

    const res = await createSession(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.session).toBeDefined();
    expect(json.session.candidate_name).toBe('Jane Doe');
  });

  it('GET /api/interviews lists sessions', async () => {
    const res = await listSessions();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.sessions.length).toBeGreaterThan(0);
  });

  it('POST /api/interviews/[id]/parse parses resume & JD', async () => {
    const req = new NextRequest('http://localhost/api/interviews/test-session-123/parse', {
      method: 'POST',
      body: JSON.stringify({
        resumeText: 'Fullstack developer with React and Node.js',
        jdText: 'React frontend developer with TypeScript',
      }),
    });

    const res = await parseSession(req, { params: Promise.resolve({ id: 'test-session-123' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.extraction).toBeDefined();
  });

  it('POST /api/interviews/[id]/generate synthesizes questions', async () => {
    const req = new NextRequest('http://localhost/api/interviews/test-session-123/generate', {
      method: 'POST',
    });

    const res = await generateQuestions(req, { params: Promise.resolve({ id: 'test-session-123' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.questions).toBeDefined();
    expect(json.total_count).toBeGreaterThan(0);
  });

  it('POST /api/interviews/[id]/invite creates single-use token invite', async () => {
    const req = new NextRequest('http://localhost/api/interviews/test-session-123/invite', {
      method: 'POST',
      body: JSON.stringify({ passcode: '123456' }),
    });

    const res = await createInvite(req, { params: Promise.resolve({ id: 'test-session-123' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.invite_url).toContain('/assess/');
    expect(json.passcode).toBe('123456');
  });

  it('GET /api/interviews/[id] returns session and questions', async () => {
    const req = new NextRequest('http://localhost/api/interviews/test-session-123');
    const res = await getSession(req, { params: Promise.resolve({ id: 'test-session-123' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.session.id).toBe('test-session-123');
    expect(json.session.questions.length).toBeGreaterThan(0);
  });
});
