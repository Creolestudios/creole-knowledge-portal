import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './route';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(() => ({ auth: { getUser: mockGetUser } })),
}));

const mockGetSubmissions = vi.fn();
const mockSaveSubmission = vi.fn();
const mockAddAuditLog = vi.fn();
vi.mock('@/lib/data/db', () => ({
  getSubmissions: (...args: any[]) => mockGetSubmissions(...args),
  saveSubmission: (...args: any[]) => mockSaveSubmission(...args),
  addAuditLog: (...args: any[]) => mockAddAuditLog(...args),
}));

const mockValidateContent = vi.fn();
const mockGenerateQuiz = vi.fn();
vi.mock('@/lib/ai/validator', () => ({
  validateContent: (...args: any[]) => mockValidateContent(...args),
  generateQuiz: (...args: any[]) => mockGenerateQuiz(...args),
}));

function mockGetRequest() {
  return new Request('http://localhost/api/submissions');
}
function mockPostRequest(body: unknown) {
  return new Request('http://localhost/api/submissions', { method: 'POST', body: JSON.stringify(body) });
}

describe('GET /api/submissions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(mockGetRequest());
    expect(res.status).toBe(401);
  });

  it('returns only the caller’s own submissions for a non-admin user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { email: 'dev@creolestudios.com' } } });
    mockGetSubmissions.mockResolvedValue([
      { author: 'dev@creolestudios.com', title: 'Mine' },
      { author: 'other@creolestudios.com', title: 'Not mine' },
    ]);

    const res = await GET(mockGetRequest());
    const body = await res.json();
    expect(body.submissions).toHaveLength(1);
    expect(body.submissions[0].title).toBe('Mine');
  });

  it('returns all submissions for the admin', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { email: 'priya.dhanani@creolestudios.com' } } });
    mockGetSubmissions.mockResolvedValue([
      { author: 'dev@creolestudios.com', title: 'A' },
      { author: 'other@creolestudios.com', title: 'B' },
    ]);

    const res = await GET(mockGetRequest());
    const body = await res.json();
    expect(body.submissions).toHaveLength(2);
  });
});

describe('POST /api/submissions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(mockPostRequest({ title: 'T', content: 'C' }));
    expect(res.status).toBe(401);
  });

  it('requires a title', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { email: 'dev@creolestudios.com' } } });
    const res = await POST(mockPostRequest({ title: '  ', content: 'C' }));
    expect(res.status).toBe(400);
  });

  it('requires content', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { email: 'dev@creolestudios.com' } } });
    const res = await POST(mockPostRequest({ title: 'T', content: '' }));
    expect(res.status).toBe(400);
  });

  it('accepts a passing submission and generates a quiz', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { email: 'dev@creolestudios.com' } } });
    mockGetSubmissions.mockResolvedValue([]);
    mockValidateContent.mockResolvedValue({
      gibberishDetected: false,
      lowQualityDetected: false,
      aiSpamDetected: false,
      qualityScore: 80,
      plagiarismOverlap: 0,
    });
    mockGenerateQuiz.mockResolvedValue([{ question: 'Q1', options: ['A', 'B'], correctIndex: 0 }]);

    const res = await POST(mockPostRequest({ title: 'Great Post', content: 'Detailed content here.' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.submission.status).toBe('PENDING_QUIZ');
    expect(body.submission.quiz.questions).toHaveLength(1);
    expect(mockSaveSubmission).toHaveBeenCalled();
    expect(mockAddAuditLog).toHaveBeenCalledTimes(2);
  });

  it('rejects gibberish content without generating a quiz', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { email: 'dev@creolestudios.com' } } });
    mockGetSubmissions.mockResolvedValue([]);
    mockValidateContent.mockResolvedValue({
      gibberishDetected: true,
      lowQualityDetected: false,
      aiSpamDetected: false,
      qualityScore: 10,
      plagiarismOverlap: 0,
    });

    const res = await POST(mockPostRequest({ title: 'asdkjaslkdj', content: 'aslkdjaslkdj' }));
    const body = await res.json();
    expect(body.submission.status).toBe('REJECTED_AI');
    expect(mockGenerateQuiz).not.toHaveBeenCalled();
  });

  it('rejects content with high plagiarism overlap', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { email: 'dev@creolestudios.com' } } });
    mockGetSubmissions.mockResolvedValue([
      { status: 'APPROVED', title: 'Existing', content: 'x', author: 'a@x.com' },
    ]);
    mockValidateContent.mockResolvedValue({
      gibberishDetected: false,
      lowQualityDetected: false,
      aiSpamDetected: false,
      qualityScore: 80,
      plagiarismOverlap: 75,
    });

    const res = await POST(mockPostRequest({ title: 'Copy', content: 'Copied content' }));
    const body = await res.json();
    expect(body.submission.status).toBe('REJECTED_AI');
  });

  it('returns a 500 when validation throws', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { email: 'dev@creolestudios.com' } } });
    mockGetSubmissions.mockResolvedValue([]);
    mockValidateContent.mockRejectedValue(new Error('AI service down'));

    const res = await POST(mockPostRequest({ title: 'T', content: 'C' }));
    expect(res.status).toBe(500);
  });
});
