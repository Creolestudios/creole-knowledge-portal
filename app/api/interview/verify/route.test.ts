import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

const { mockSingle, mockUpdateEq, mockUpdate } = vi.hoisted(() => {
  const mockUpdateEq = vi.fn();
  return {
    mockSingle: vi.fn(),
    mockUpdateEq,
    mockUpdate: vi.fn(() => ({ eq: mockUpdateEq })),
  };
});

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ single: mockSingle }),
      }),
      update: (...args: any[]) => mockUpdate(...args),
    }),
  },
}));

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/interview/verify', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/interview/verify', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires interviewId and accessCode', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it('returns 404 when the interview does not exist', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'not found' } });
    const res = await POST(makeRequest({ interviewId: 'i1', accessCode: '123456' }));
    expect(res.status).toBe(404);
  });

  it('returns 410 when the interview has expired', async () => {
    mockSingle.mockResolvedValue({
      data: { id: 'i1', status: 'pending', expires_at: '2000-01-01T00:00:00Z', access_code: '123456' },
      error: null,
    });
    const res = await POST(makeRequest({ interviewId: 'i1', accessCode: '123456' }));
    expect(res.status).toBe(410);
  });

  it('returns 401 on an incorrect passcode', async () => {
    mockSingle.mockResolvedValue({
      data: {
        id: 'i1',
        status: 'pending',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        access_code: '123456',
      },
      error: null,
    });
    const res = await POST(makeRequest({ interviewId: 'i1', accessCode: '000000' }));
    expect(res.status).toBe(401);
  });

  it('verifies a correct passcode and marks the interview in_progress', async () => {
    mockSingle.mockResolvedValue({
      data: {
        id: 'i1',
        status: 'pending',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        access_code: '123456',
      },
      error: null,
    });
    mockUpdateEq.mockResolvedValue({ error: null });

    const res = await POST(makeRequest({ interviewId: 'i1', accessCode: '123456' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verified).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'in_progress' }),
    );
  });

  it('returns 410 when the interview was already terminated', async () => {
    mockSingle.mockResolvedValue({
      data: {
        id: 'i1',
        status: 'terminated',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        access_code: '123456',
      },
      error: null,
    });
    const res = await POST(makeRequest({ interviewId: 'i1', accessCode: '123456' }));
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe('This interview has already ended');
  });

  it('returns 410 when the interview was already completed', async () => {
    mockSingle.mockResolvedValue({
      data: {
        id: 'i1',
        status: 'completed',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        access_code: '123456',
      },
      error: null,
    });
    const res = await POST(makeRequest({ interviewId: 'i1', accessCode: '123456' }));
    expect(res.status).toBe(410);
  });

  it('does not re-update status when interview is already in_progress', async () => {
    mockSingle.mockResolvedValue({
      data: {
        id: 'i1',
        status: 'in_progress',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        access_code: '123456',
      },
      error: null,
    });

    const res = await POST(makeRequest({ interviewId: 'i1', accessCode: '123456' }));
    expect(res.status).toBe(200);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
