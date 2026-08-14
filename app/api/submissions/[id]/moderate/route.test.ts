import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(() => ({ auth: { getUser: mockGetUser } })),
}));

const mockGetSubmissionById = vi.fn();
const mockSaveSubmission = vi.fn();
const mockAddAuditLog = vi.fn();
vi.mock('@/lib/data/db', () => ({
  getSubmissionById: (...args: any[]) => mockGetSubmissionById(...args),
  saveSubmission: (...args: any[]) => mockSaveSubmission(...args),
  addAuditLog: (...args: any[]) => mockAddAuditLog(...args),
}));

function ctx(id = 'sub-1') {
  return { params: Promise.resolve({ id }) };
}
function mockRequest(body: unknown) {
  return new Request('http://x', { method: 'POST', body: JSON.stringify(body) });
}

describe('POST /api/submissions/[id]/moderate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(mockRequest({ action: 'APPROVE' }), ctx());
    expect(res.status).toBe(401);
  });

  it('forbids non-admin callers', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { email: 'dev@creolestudios.com' } } });
    const res = await POST(mockRequest({ action: 'APPROVE' }), ctx());
    expect(res.status).toBe(403);
  });

  it('returns 404 when the submission does not exist', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { email: 'priya.dhanani@creolestudios.com' } } });
    mockGetSubmissionById.mockResolvedValue(null);
    const res = await POST(mockRequest({ action: 'APPROVE' }), ctx());
    expect(res.status).toBe(404);
  });

  it('validates the action field', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { email: 'priya.dhanani@creolestudios.com' } } });
    mockGetSubmissionById.mockResolvedValue({ id: 'sub-1', status: 'PENDING_QUIZ' });
    const res = await POST(mockRequest({ action: 'MAYBE' }), ctx());
    expect(res.status).toBe(400);
  });

  it('approves a submission and logs the moderator override', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { email: 'priya.dhanani@creolestudios.com' } } });
    mockGetSubmissionById.mockResolvedValue({ id: 'sub-1', status: 'PENDING_QUIZ' });

    const res = await POST(mockRequest({ action: 'APPROVE', reason: 'Looks good' }), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.submission.status).toBe('APPROVED');
    expect(mockAddAuditLog).toHaveBeenCalledWith(
      'MODERATOR_APPROVED',
      'priya.dhanani@creolestudios.com',
      'sub-1',
      expect.stringContaining('Looks good'),
    );
  });

  it('flags a submission on reject and defaults the reason text', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { email: 'priya.dhanani@creolestudios.com' } } });
    mockGetSubmissionById.mockResolvedValue({ id: 'sub-1', status: 'PENDING_QUIZ' });

    const res = await POST(mockRequest({ action: 'REJECT' }), ctx());
    const body = await res.json();
    expect(body.submission.status).toBe('FLAGGED');
    expect(mockAddAuditLog).toHaveBeenCalledWith(
      'MODERATOR_REJECTED',
      expect.any(String),
      'sub-1',
      expect.stringContaining('No reason provided'),
    );
  });
});
