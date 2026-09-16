/**
 * QA scenario suite for the AI Interview module (Phase 1: resume/JD upload,
 * link + passcode generation, candidate passcode verification).
 *
 * Each test is tagged with a QA case ID (TC-xx) and a plain-language
 * scenario name so results map directly to a test-case report.
 *
 * Scope: app/api/admin/ai-interviews/route.ts + app/api/interview/verify/route.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRequireAdminUser, mockUpload, mockRemove, mockSingle, mockInsert, mockEq, mockOrder } = vi.hoisted(() => {
  const mockSingle = vi.fn();
  const mockSelect = vi.fn(() => ({ single: mockSingle }));
  return {
    mockRequireAdminUser: vi.fn(),
    mockUpload: vi.fn(),
    mockRemove: vi.fn(),
    mockSingle,
    mockInsert: vi.fn(() => ({ select: mockSelect })),
    mockEq: vi.fn(),
    mockOrder: vi.fn(),
  };
});

const { mockVerifySingle, mockVerifyUpdateEq, mockVerifyUpdate } = vi.hoisted(() => {
  const mockVerifyUpdateEq = vi.fn();
  return {
    mockVerifySingle: vi.fn(),
    mockVerifyUpdateEq,
    mockVerifyUpdate: vi.fn(() => ({ eq: mockVerifyUpdateEq })),
  };
});

vi.mock('@/lib/supabase/admin', () => ({
  requireAdminUser: () => mockRequireAdminUser(),
  supabaseAdmin: {
    storage: {
      from: vi.fn().mockReturnValue({
        upload: (...args: any[]) => mockUpload(...args),
        remove: (...args: any[]) => mockRemove(...args),
      }),
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'ai_interviews') {
        return {
          insert: (...args: any[]) => mockInsert(...args),
          select: (cols: string) => {
            // GET listing path: .select().eq().order()
            // POST verify path:  .select().eq().single()
            return {
              eq: (...args: any[]) => {
                mockEq(...args);
                return { order: mockOrder, single: mockVerifySingle };
              },
            };
          },
          update: (...args: any[]) => mockVerifyUpdate(...args),
        };
      }
      return {};
    }),
  },
}));

import { POST as createInterview, GET as listInterviews } from '@/app/api/admin/ai-interviews/route';
import { POST as verifyInterview } from '@/app/api/interview/verify/route';

function makeFile(name: string, type: string, content = 'x'.repeat(10)) {
  return new File([content], name, { type });
}

function makeCreateRequest(fields: {
  resume?: File | null;
  jd?: File | null;
  jdText?: string;
  candidateName?: string;
  candidateEmail?: string;
  jobTitle?: string;
}) {
  const form = new FormData();
  if (fields.resume) form.set('resume', fields.resume);
  if (fields.jd) form.set('jd', fields.jd);
  if (fields.jdText) form.set('jdText', fields.jdText);
  if (fields.candidateName) form.set('candidateName', fields.candidateName);
  if (fields.candidateEmail) form.set('candidateEmail', fields.candidateEmail);
  if (fields.jobTitle) form.set('jobTitle', fields.jobTitle);
  return new Request('http://localhost/api/admin/ai-interviews', { method: 'POST', body: form });
}

function makeVerifyRequest(body: unknown) {
  return new Request('http://localhost/api/interview/verify', { method: 'POST', body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEq.mockReturnValue({ order: mockOrder, single: mockVerifySingle });
});

// ---------------------------------------------------------------------------
// Admin: POST /api/admin/ai-interviews — create interview (upload + link/passcode)
// ---------------------------------------------------------------------------
describe('AI Interview creation — admin API', () => {
  it('TC-01 Unauthenticated/non-admin caller is rejected', async () => {
    mockRequireAdminUser.mockResolvedValue(null);
    const res = await createInterview(
      makeCreateRequest({ resume: makeFile('r.pdf', 'application/pdf'), jdText: 'JD text' }),
    );
    expect(res.status).toBe(401);
  });

  it('TC-02 Missing resume is rejected', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    const res = await createInterview(makeCreateRequest({ jdText: 'JD text' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/resume/i);
  });

  it('TC-03 Missing job description (no file, no text) is rejected', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    const res = await createInterview(makeCreateRequest({ resume: makeFile('r.pdf', 'application/pdf') }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/job description/i);
  });

  it('TC-04 Unsupported resume file type is rejected', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    const res = await createInterview(
      makeCreateRequest({ resume: makeFile('r.exe', 'application/x-msdownload'), jdText: 'JD text' }),
    );
    expect(res.status).toBe(400);
  });

  it('TC-05 Oversized resume (>10MB) is rejected', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    const big = 'x'.repeat(11 * 1024 * 1024);
    const res = await createInterview(
      makeCreateRequest({ resume: makeFile('r.pdf', 'application/pdf', big), jdText: 'JD text' }),
    );
    expect(res.status).toBe(400);
  });

  it('TC-06 Unsupported JD file type is rejected (file mode)', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    const res = await createInterview(
      makeCreateRequest({ resume: makeFile('r.pdf', 'application/pdf'), jd: makeFile('j.exe', 'application/x-msdownload') }),
    );
    expect(res.status).toBe(400);
  });

  it('TC-07 Oversized JD file (>10MB) is rejected (file mode)', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    const big = 'x'.repeat(11 * 1024 * 1024);
    const res = await createInterview(
      makeCreateRequest({ resume: makeFile('r.pdf', 'application/pdf'), jd: makeFile('j.pdf', 'application/pdf', big) }),
    );
    expect(res.status).toBe(400);
  });

  it('TC-08 JD text over the 20,000-character limit is rejected (text mode)', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    const res = await createInterview(
      makeCreateRequest({ resume: makeFile('r.pdf', 'application/pdf'), jdText: 'x'.repeat(20001) }),
    );
    expect(res.status).toBe(400);
  });

  it('TC-09 Valid submission with JD as a file succeeds and returns link + passcode', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    mockUpload.mockResolvedValue({ error: null });
    mockSingle.mockResolvedValue({ error: null, data: { id: 'interview-1', access_code: '123456' } });

    const res = await createInterview(
      makeCreateRequest({ resume: makeFile('r.pdf', 'application/pdf'), jd: makeFile('j.pdf', 'application/pdf') }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ interviewId: 'interview-1', accessCode: '123456' });
    expect(body.link).toContain('/interview/interview-1');
    expect(mockUpload).toHaveBeenCalledTimes(2); // resume + jd file
  });

  it('TC-10 Valid submission with pasted JD text succeeds and skips a second file upload', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    mockUpload.mockResolvedValue({ error: null });
    mockSingle.mockResolvedValue({ error: null, data: { id: 'interview-2', access_code: '654321' } });

    const res = await createInterview(
      makeCreateRequest({ resume: makeFile('r.pdf', 'application/pdf'), jdText: 'We are hiring a great engineer.' }),
    );
    expect(res.status).toBe(200);
    expect(mockUpload).toHaveBeenCalledTimes(1); // resume only
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ jd_storage_path: null, jd_text: 'We are hiring a great engineer.' }),
    );
  });

  it('TC-11 When both a JD file and JD text are supplied, the file takes precedence', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    mockUpload.mockResolvedValue({ error: null });
    mockSingle.mockResolvedValue({ error: null, data: { id: 'interview-3', access_code: '111111' } });

    await createInterview(
      makeCreateRequest({
        resume: makeFile('r.pdf', 'application/pdf'),
        jd: makeFile('j.pdf', 'application/pdf'),
        jdText: 'ignored text',
      }),
    );
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ jd_text: null }));
  });

  it('TC-12 Optional candidate fields are omitted correctly when not provided', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    mockUpload.mockResolvedValue({ error: null });
    mockSingle.mockResolvedValue({ error: null, data: { id: 'interview-4', access_code: '222222' } });

    await createInterview(makeCreateRequest({ resume: makeFile('r.pdf', 'application/pdf'), jdText: 'JD text' }));
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ candidate_name: null, candidate_email: null, job_title: null }),
    );
  });

  it('TC-13 Access-code collision (unique constraint) is retried once with a fresh code', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    mockUpload.mockResolvedValue({ error: null });
    mockSingle
      .mockResolvedValueOnce({ error: { code: '23505', message: 'duplicate' }, data: null })
      .mockResolvedValueOnce({ error: null, data: { id: 'interview-5', access_code: '333333' } });

    const res = await createInterview(
      makeCreateRequest({ resume: makeFile('r.pdf', 'application/pdf'), jdText: 'JD text' }),
    );
    expect(res.status).toBe(200);
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });

  it('TC-14 Resume upload failure returns 500 and does not touch the DB', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    mockUpload.mockResolvedValueOnce({ error: { message: 'storage down' } });

    const res = await createInterview(
      makeCreateRequest({ resume: makeFile('r.pdf', 'application/pdf'), jdText: 'JD text' }),
    );
    expect(res.status).toBe(500);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('TC-15 JD file upload failure returns 500 and cleans up the already-uploaded resume', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    mockUpload.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: 'storage down' } });

    const res = await createInterview(
      makeCreateRequest({ resume: makeFile('r.pdf', 'application/pdf'), jd: makeFile('j.pdf', 'application/pdf') }),
    );
    expect(res.status).toBe(500);
    expect(mockRemove).toHaveBeenCalled();
  });

  it('TC-16 DB insert failure returns 500 and cleans up all uploaded storage objects', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    mockUpload.mockResolvedValue({ error: null });
    mockSingle.mockResolvedValue({ error: { message: 'db down', code: '500' }, data: null });

    const res = await createInterview(
      makeCreateRequest({ resume: makeFile('r.pdf', 'application/pdf'), jd: makeFile('j.pdf', 'application/pdf') }),
    );
    expect(res.status).toBe(500);
    expect(mockRemove).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Admin: GET /api/admin/ai-interviews — list interviews
// ---------------------------------------------------------------------------
describe('AI Interview listing — admin API', () => {
  it('TC-17 Unauthenticated/non-admin caller is rejected', async () => {
    mockRequireAdminUser.mockResolvedValue(null);
    const res = await listInterviews();
    expect(res.status).toBe(401);
  });

  it('TC-18 Returns the interviews created by the calling admin', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    mockOrder.mockResolvedValue({ data: [{ id: 'i1' }, { id: 'i2' }], error: null });

    const res = await listInterviews();
    expect(res.status).toBe(200);
    expect((await res.json()).interviews).toHaveLength(2);
  });

  it('TC-19 Database error while listing returns 500', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    mockOrder.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const res = await listInterviews();
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Candidate: POST /api/interview/verify — passcode verification
// ---------------------------------------------------------------------------
describe('Candidate passcode verification', () => {
  it('TC-20 Missing interviewId or accessCode is rejected', async () => {
    const res1 = await verifyInterview(makeVerifyRequest({ accessCode: '123456' }));
    expect(res1.status).toBe(400);
    const res2 = await verifyInterview(makeVerifyRequest({ interviewId: 'i1' }));
    expect(res2.status).toBe(400);
  });

  it('TC-21 Non-existent interview id returns 404', async () => {
    mockVerifySingle.mockResolvedValue({ data: null, error: { message: 'not found' } });
    const res = await verifyInterview(makeVerifyRequest({ interviewId: 'ghost', accessCode: '123456' }));
    expect(res.status).toBe(404);
  });

  it('TC-22 Expired interview link is rejected', async () => {
    mockVerifySingle.mockResolvedValue({
      data: { id: 'i1', status: 'pending', expires_at: '2000-01-01T00:00:00Z', access_code: '123456' },
      error: null,
    });
    const res = await verifyInterview(makeVerifyRequest({ interviewId: 'i1', accessCode: '123456' }));
    expect(res.status).toBe(410);
  });

  it('TC-23 Incorrect passcode is rejected', async () => {
    mockVerifySingle.mockResolvedValue({
      data: { id: 'i1', status: 'pending', expires_at: futureDate(), access_code: '123456' },
      error: null,
    });
    const res = await verifyInterview(makeVerifyRequest({ interviewId: 'i1', accessCode: '000000' }));
    expect(res.status).toBe(401);
  });

  it('TC-24 Correct passcode on a pending interview verifies and flips status to in_progress', async () => {
    mockVerifySingle.mockResolvedValue({
      data: { id: 'i1', status: 'pending', expires_at: futureDate(), access_code: '123456' },
      error: null,
    });
    mockVerifyUpdateEq.mockResolvedValue({ error: null });

    const res = await verifyInterview(makeVerifyRequest({ interviewId: 'i1', accessCode: '123456' }));
    expect(res.status).toBe(200);
    expect((await res.json()).verified).toBe(true);
    expect(mockVerifyUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'in_progress' }));
  });

  it('TC-25 Correct passcode on an already in_progress interview verifies without re-updating status', async () => {
    mockVerifySingle.mockResolvedValue({
      data: { id: 'i1', status: 'in_progress', expires_at: futureDate(), access_code: '123456' },
      error: null,
    });
    const res = await verifyInterview(makeVerifyRequest({ interviewId: 'i1', accessCode: '123456' }));
    expect(res.status).toBe(200);
    expect(mockVerifyUpdate).not.toHaveBeenCalled();
  });

  it('TC-26 Passcode with surrounding whitespace is trimmed before comparison', async () => {
    mockVerifySingle.mockResolvedValue({
      data: { id: 'i1', status: 'pending', expires_at: futureDate(), access_code: '123456' },
      error: null,
    });
    mockVerifyUpdateEq.mockResolvedValue({ error: null });

    const res = await verifyInterview(makeVerifyRequest({ interviewId: 'i1', accessCode: '  123456  ' }));
    expect(res.status).toBe(200);
  });

  it('TC-27 Malformed JSON body is rejected with 400 instead of crashing', async () => {
    const req = new Request('http://localhost/api/interview/verify', { method: 'POST', body: '{not json' });
    const res = await verifyInterview(req);
    expect(res.status).toBe(400);
  });
});

function futureDate() {
  return new Date(Date.now() + 86400000).toISOString();
}
