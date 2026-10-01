import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

const { mockSingleProfile, mockSingleInterview, mockUpdateEq, mockUpdate } = vi.hoisted(() => {
  const mockUpdateEq = vi.fn();
  return {
    mockSingleProfile: vi.fn(),
    mockSingleInterview: vi.fn(),
    mockUpdateEq,
    mockUpdate: vi.fn(() => ({ eq: mockUpdateEq })),
  };
});

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn().mockReturnValue(undefined),
    set: vi.fn(),
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'user_profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ single: mockSingleProfile }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ single: mockSingleInterview, maybeSingle: mockSingleInterview }),
        }),
        update: (...args: any[]) => mockUpdate(...args),
      };
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
  beforeEach(() => {
    vi.clearAllMocks();
    mockSingleProfile.mockResolvedValue({ data: { role: 'user' } });
  });

  it('requires interviewId and email', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it('returns 404 when the interview does not exist', async () => {
    mockSingleInterview.mockResolvedValue({ data: null, error: { message: 'not found' } });
    const res = await POST(makeRequest({ interviewId: 'i1', email: 'test@example.com' }));
    expect(res.status).toBe(404);
  });

  it('returns 410 when the interview has expired', async () => {
    mockSingleInterview.mockResolvedValue({
      data: { id: 'i1', status: 'pending', expires_at: '2000-01-01T00:00:00Z', access_code: '123456' },
      error: null,
    });
    const res = await POST(makeRequest({ interviewId: 'i1', email: 'test@example.com' }));
    expect(res.status).toBe(410);
  });

  it('returns requiresAccessCode if not admin and accessCode is missing', async () => {
    mockSingleInterview.mockResolvedValue({
      data: {
        id: 'i1',
        status: 'pending',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        access_code: '123456',
      },
      error: null,
    });
    const res = await POST(makeRequest({ interviewId: 'i1', email: 'test@example.com' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requiresAccessCode).toBe(true);
  });

  it('bypasses access code check if user is admin', async () => {
    mockSingleProfile.mockResolvedValue({ data: { role: 'admin' } });
    mockSingleInterview.mockResolvedValue({
      data: {
        id: 'i1',
        status: 'pending',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        access_code: '123456',
      },
      error: null,
    });
    
    // No access code provided
    const res = await POST(makeRequest({ interviewId: 'i1', email: 'admin@example.com' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verified).toBe(true);
    expect(body.isAdmin).toBe(true);
  });

  it('returns 401 on an incorrect passcode for normal user', async () => {
    mockSingleInterview.mockResolvedValue({
      data: {
        id: 'i1',
        status: 'pending',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        access_code: '123456',
      },
      error: null,
    });
    const res = await POST(makeRequest({ interviewId: 'i1', email: 'test@example.com', accessCode: '000000' }));
    expect(res.status).toBe(401);
  });

  it('verifies a correct passcode and marks the interview in_progress', async () => {
    mockSingleInterview.mockResolvedValue({
      data: {
        id: 'i1',
        status: 'pending',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        access_code: '123456',
      },
      error: null,
    });
    mockUpdateEq.mockResolvedValue({ error: null });

    const res = await POST(makeRequest({ interviewId: 'i1', email: 'test@example.com', accessCode: '123456' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verified).toBe(true);
    expect(body.isAdmin).toBe(false);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'in_progress', used_at: expect.any(String) }),
    );
  });

  it('returns 410 when the interview was already terminated', async () => {
    mockSingleInterview.mockResolvedValue({
      data: {
        id: 'i1',
        status: 'terminated',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        access_code: '123456',
      },
      error: null,
    });
    const res = await POST(makeRequest({ interviewId: 'i1', email: 'test@example.com', accessCode: '123456' }));
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe('This interview has already ended');
  });

  it('returns 410 when the interview was already completed', async () => {
    mockSingleInterview.mockResolvedValue({
      data: {
        id: 'i1',
        status: 'completed',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        access_code: '123456',
      },
      error: null,
    });
    const res = await POST(makeRequest({ interviewId: 'i1', email: 'test@example.com', accessCode: '123456' }));
    expect(res.status).toBe(410);
  });

  it('blocks re-entry with 410 when interview is already in_progress (one-time access)', async () => {
    mockSingleInterview.mockResolvedValue({
      data: {
        id: 'i1',
        status: 'in_progress',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        access_code: '123456',
      },
      error: null,
    });

    const res = await POST(makeRequest({ interviewId: 'i1', email: 'test@example.com', accessCode: '123456' }));
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe('This interview link has already been used and cannot be re-opened');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns 410 when joining via invite but underlying session is cancelled', async () => {
    // 1st call: ai_interviews (returns null)
    // 2nd call: interview_invites (returns invite)
    // 3rd call: interview_sessions (returns cancelled session)
    mockSingleInterview
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: {
          id: 'inv1',
          session_id: 'sess1',
          status: 'active',
          token_hash: '123456',
          expires_at: new Date(Date.now() + 86400000).toISOString()
        },
        error: null
      })
      .mockResolvedValueOnce({
        data: { id: 'sess1', status: 'cancelled' },
        error: null
      });

    const res = await POST(makeRequest({ interviewId: '123456', email: 'test@example.com', accessCode: '123456' }));
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe('This interview has already ended');
  });
});
