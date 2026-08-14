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

const baseSubmission = {
  id: 'sub-1',
  author: 'dev@creolestudios.com',
  status: 'PENDING_QUIZ',
  quiz: {
    questions: [
      { id: 'q1', correctOptionIndex: 0 },
      { id: 'q2', correctOptionIndex: 1 },
      { id: 'q3', correctOptionIndex: 2 },
    ],
  },
};

describe('POST /api/submissions/[id]/quiz', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(mockRequest({ userSelection: {} }), ctx());
    expect(res.status).toBe(401);
  });

  it('returns 404 when the submission does not exist', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { email: 'dev@creolestudios.com' } } });
    mockGetSubmissionById.mockResolvedValue(null);
    const res = await POST(mockRequest({ userSelection: {} }), ctx());
    expect(res.status).toBe(404);
  });

  it('forbids a non-author, non-admin from taking the quiz', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { email: 'someone-else@x.com' } } });
    mockGetSubmissionById.mockResolvedValue({ ...baseSubmission });
    const res = await POST(mockRequest({ userSelection: {} }), ctx());
    expect(res.status).toBe(403);
  });

  it('rejects when the submission is not awaiting a quiz', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { email: 'dev@creolestudios.com' } } });
    mockGetSubmissionById.mockResolvedValue({ ...baseSubmission, status: 'APPROVED' });
    const res = await POST(mockRequest({ userSelection: {} }), ctx());
    expect(res.status).toBe(400);
  });

  it('validates the userSelection payload', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { email: 'dev@creolestudios.com' } } });
    mockGetSubmissionById.mockResolvedValue({ ...baseSubmission });
    const res = await POST(mockRequest({}), ctx());
    expect(res.status).toBe(400);
  });

  it('approves the submission when the score meets the passing threshold', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { email: 'dev@creolestudios.com' } } });
    mockGetSubmissionById.mockResolvedValue({ ...baseSubmission, quiz: { ...baseSubmission.quiz } });

    const res = await POST(
      mockRequest({ userSelection: { q1: 0, q2: 1, q3: 9 } }), // 2 correct
      ctx(),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.submission.status).toBe('APPROVED');
    expect(body.submission.quiz.score).toBe(2);
    expect(mockSaveSubmission).toHaveBeenCalled();
  });

  it('rejects the submission when the score is below the passing threshold', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { email: 'dev@creolestudios.com' } } });
    mockGetSubmissionById.mockResolvedValue({ ...baseSubmission, quiz: { ...baseSubmission.quiz } });

    const res = await POST(mockRequest({ userSelection: { q1: 9 } }), ctx()); // 0 correct
    const body = await res.json();
    expect(body.submission.status).toBe('REJECTED_QUIZ');
  });

  it('allows the admin to take the quiz on behalf of another author', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { email: 'priya.dhanani@creolestudios.com' } } });
    mockGetSubmissionById.mockResolvedValue({ ...baseSubmission, quiz: { ...baseSubmission.quiz } });

    const res = await POST(mockRequest({ userSelection: { q1: 0, q2: 1, q3: 2 } }), ctx());
    expect(res.status).toBe(200);
  });
});
