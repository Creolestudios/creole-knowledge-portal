import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './route';

const mockRequireAdminUser = vi.fn();
const mockUpload = vi.fn();
const mockRemove = vi.fn();
const mockSingle = vi.fn();
const mockInsertSelect = vi.fn(() => ({ single: mockSingle }));
const mockInsert = vi.fn(() => ({ select: mockInsertSelect }));
// GET builds a chain: select().eq().order().order().limit() — the list
// query result resolves on the final .limit() call.
const mockLimit = vi.fn();
const listQuery: any = {
  eq: vi.fn(() => listQuery),
  order: vi.fn(() => listQuery),
  limit: (...args: any[]) => mockLimit(...args),
};

vi.mock('@/lib/supabase/admin', () => ({
  requireAdminUser: () => mockRequireAdminUser(),
  supabaseAdmin: {
    storage: {
      from: vi.fn().mockReturnValue({
        upload: (...args: any[]) => mockUpload(...args),
        remove: (...args: any[]) => mockRemove(...args),
      }),
    },
    from: vi.fn().mockReturnValue({
      insert: (...args: any[]) => mockInsert(...args),
      select: () => listQuery,
    }),
  },
}));

function makeFile(name: string, type: string, content = 'x'.repeat(10)) {
  return new File([content], name, { type });
}

function makeRequest(fields: { resume?: File | null; jd?: File | null; jdText?: string; [k: string]: any }) {
  const form = new FormData();
  if (fields.resume) form.set('resume', fields.resume);
  if (fields.jd) form.set('jd', fields.jd);
  if (fields.jdText) form.set('jdText', fields.jdText);
  if (fields.candidateName) form.set('candidateName', fields.candidateName);
  return new Request('http://localhost/api/admin/ai-interviews', { method: 'POST', body: form });
}

describe('POST /api/admin/ai-interviews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not an admin', async () => {
    mockRequireAdminUser.mockResolvedValue(null);
    const res = await POST(makeRequest({ resume: makeFile('r.pdf', 'application/pdf'), jd: makeFile('j.pdf', 'application/pdf') }));
    expect(res.status).toBe(401);
  });

  it('requires a resume', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    const res = await POST(makeRequest({ jd: makeFile('j.pdf', 'application/pdf') }));
    expect(res.status).toBe(400);
  });

  it('requires a job description (file or text)', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    const res = await POST(makeRequest({ resume: makeFile('r.pdf', 'application/pdf') }));
    expect(res.status).toBe(400);
  });

  it('rejects job description text over the length limit', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    const res = await POST(
      makeRequest({ resume: makeFile('r.pdf', 'application/pdf'), jdText: 'x'.repeat(20001) }),
    );
    expect(res.status).toBe(400);
  });

  it('creates an interview from pasted JD text without uploading a second file', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    mockUpload.mockResolvedValue({ error: null });
    mockSingle.mockResolvedValue({ error: null, data: { id: 'interview-2', access_code: '654321' } });

    const res = await POST(
      makeRequest({ resume: makeFile('r.pdf', 'application/pdf'), jdText: 'We are hiring a great engineer.' }),
    );

    expect(res.status).toBe(200);
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ jd_storage_path: null, jd_text: 'We are hiring a great engineer.' }),
    );
  });

  it('rejects unsupported file types', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    const res = await POST(
      makeRequest({ resume: makeFile('r.exe', 'application/x-msdownload'), jd: makeFile('j.pdf', 'application/pdf') }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects files over the size limit', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    const big = 'x'.repeat(11 * 1024 * 1024);
    const res = await POST(
      makeRequest({ resume: makeFile('r.pdf', 'application/pdf', big), jd: makeFile('j.pdf', 'application/pdf') }),
    );
    expect(res.status).toBe(400);
  });

  it('uploads both files and creates an interview record', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    mockUpload.mockResolvedValue({ error: null });
    mockSingle.mockResolvedValue({ error: null, data: { id: 'interview-1', access_code: '123456' } });

    const res = await POST(
      makeRequest({
        resume: makeFile('r.pdf', 'application/pdf'),
        jd: makeFile('j.pdf', 'application/pdf'),
        candidateName: 'Jane Doe',
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.interviewId).toBe('interview-1');
    expect(body.accessCode).toBe('123456');
    expect(body.link).toContain('/interview/interview-1');
    expect(mockUpload).toHaveBeenCalledTimes(2);
  });

  it('returns 500 and cleans up when the resume upload fails', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    mockUpload.mockResolvedValueOnce({ error: { message: 'boom' } });

    const res = await POST(
      makeRequest({ resume: makeFile('r.pdf', 'application/pdf'), jd: makeFile('j.pdf', 'application/pdf') }),
    );
    expect(res.status).toBe(500);
  });

  it('returns 500 and cleans up when the JD upload fails', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    mockUpload.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: 'boom' } });

    const res = await POST(
      makeRequest({ resume: makeFile('r.pdf', 'application/pdf'), jd: makeFile('j.pdf', 'application/pdf') }),
    );
    expect(res.status).toBe(500);
    expect(mockRemove).toHaveBeenCalled();
  });

  it('returns 500 and cleans up storage when the DB insert fails', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    mockUpload.mockResolvedValue({ error: null });
    mockSingle.mockResolvedValue({ error: { message: 'db down', code: '500' }, data: null });

    const res = await POST(
      makeRequest({ resume: makeFile('r.pdf', 'application/pdf'), jd: makeFile('j.pdf', 'application/pdf') }),
    );
    expect(res.status).toBe(500);
    expect(mockRemove).toHaveBeenCalled();
  });
});

describe('GET /api/admin/ai-interviews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not an admin', async () => {
    mockRequireAdminUser.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('lists interviews from interview_sessions, flattening the latest invite', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    mockLimit.mockResolvedValue({
      data: [
        {
          id: 'i1',
          candidate_name: 'Jane Doe',
          candidate_email: 'jane@example.com',
          parsed_jd: { jobTitle: 'Frontend Engineer' },
          status: 'questions_generated',
          created_at: '2026-09-20T00:00:00.000Z',
          interview_invites: [{ status: 'active', expires_at: '2026-09-25T00:00:00.000Z', created_at: '2026-09-21T00:00:00.000Z' }],
        },
        {
          id: 'i2',
          candidate_name: 'No Invite Yet',
          candidate_email: null,
          parsed_jd: {},
          status: 'draft',
          created_at: '2026-09-19T00:00:00.000Z',
          interview_invites: [],
        },
      ],
      error: null,
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.interviews).toEqual([
      {
        id: 'i1',
        candidate_name: 'Jane Doe',
        candidate_email: 'jane@example.com',
        job_title: 'Frontend Engineer',
        status: 'active',
        expires_at: '2026-09-25T00:00:00.000Z',
        created_at: '2026-09-20T00:00:00.000Z',
      },
      {
        id: 'i2',
        candidate_name: 'No Invite Yet',
        candidate_email: null,
        job_title: null,
        status: 'draft',
        expires_at: null,
        created_at: '2026-09-19T00:00:00.000Z',
      },
    ]);
  });

  it('returns 500 when the query fails', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    mockLimit.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const res = await GET();
    expect(res.status).toBe(500);
  });
});
