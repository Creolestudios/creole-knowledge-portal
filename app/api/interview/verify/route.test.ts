import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './route';

const { mockSingleProfile, mockSingleInterview, mockUpdateEq, mockUpdate, mockAtomicMaybeSingle, chain } = vi.hoisted(() => {
  const mockAtomicMaybeSingle = vi.fn();
  const mockUpdateEq: any = vi.fn();
  const chain: any = {
    eq: mockUpdateEq,
    neq: mockUpdateEq,
    select: vi.fn(() => ({
      maybeSingle: mockAtomicMaybeSingle,
    })),
    then: (resolve: any) => Promise.resolve({ error: null }).then(resolve),
  };
  mockUpdateEq.mockReturnValue(chain);

  return {
    mockSingleProfile: vi.fn(),
    mockSingleInterview: vi.fn(),
    mockUpdateEq,
    mockAtomicMaybeSingle,
    mockUpdate: vi.fn(() => chain),
    chain,
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

import { resetSessionLocks, CONCURRENT_SESSION_ERROR } from '@/lib/ai-interview/session-lock';

function makeRequest(body: unknown, headers?: Record<string, string>) {
  return new Request('http://localhost/api/interview/verify', {
    method: 'POST',
    headers: headers || {},
    body: JSON.stringify(body),
  });
}

describe('POST /api/interview/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionLocks();
    mockUpdateEq.mockReturnValue(chain);
    mockSingleProfile.mockResolvedValue({ data: { role: 'user' } });
    mockAtomicMaybeSingle.mockResolvedValue({ data: { id: 'mock-id' }, error: null });
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

  it('verifies a correct passcode but does NOT mark the interview in_progress immediately', async () => {
    mockSingleInterview.mockResolvedValue({
      data: {
        id: 'i1',
        status: 'pending',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        access_code: '123456',
      },
      error: null,
    });
    mockAtomicMaybeSingle.mockResolvedValue({ data: { id: 'i1' }, error: null });

    const res = await POST(makeRequest({ interviewId: 'i1', email: 'test@example.com', accessCode: '123456' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.verified).toBe(true);
    expect(body.isAdmin).toBe(false);
    // Should NOT update to in_progress yet (waits for client to call /start)
    expect(mockUpdate).not.toHaveBeenCalled();
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
    expect(body.note).toBe('Note: This interview link has already been used and is expired.');
  });

  it('rejects a second user joining at the same time with millisecond difference', async () => {
    mockSingleInterview.mockResolvedValue({
      data: {
        id: 'i-concur',
        status: 'pending',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        access_code: '123456',
      },
      error: null,
    });
    mockAtomicMaybeSingle.mockResolvedValue({ data: { id: 'i-concur' }, error: null });

    // User 1 on Laptop A joins
    const res1 = await POST(makeRequest({
      interviewId: 'i-concur',
      accessCode: '123456',
      deviceId: 'laptop-A',
    }));
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.verified).toBe(true);

    // User 2 on Laptop B joins milliseconds later with the same interview link
    const res2 = await POST(makeRequest({
      interviewId: 'i-concur',
      accessCode: '123456',
      deviceId: 'laptop-B',
    }));
    expect(res2.status).toBe(409);
    const body2 = await res2.json();
    expect(body2.error).toBe(CONCURRENT_SESSION_ERROR);
    expect(body2.concurrent).toBe(true);
    expect(body2.code).toBe('CONCURRENT_SESSION_DETECTED');
  });


});

describe('GET /api/interview/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeGetRequest(interviewId?: string) {
    const url = interviewId
      ? `http://localhost/api/interview/verify?interviewId=${encodeURIComponent(interviewId)}`
      : 'http://localhost/api/interview/verify';
    return new Request(url, { method: 'GET' });
  }

  it('returns 400 when interviewId query param is missing', async () => {
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Interview ID is required');
  });

  it('returns 404 when interview is not found in database', async () => {
    mockSingleInterview.mockResolvedValue({ data: null, error: { message: 'not found' } });
    const res = await GET(makeGetRequest('non-existent-id'));
    expect(res.status).toBe(404);
  });

  it('returns 410 when interview has expired (expires_at in past)', async () => {
    mockSingleInterview.mockResolvedValue({
      data: {
        id: 'i1',
        status: 'pending',
        expires_at: '2020-01-01T00:00:00Z',
        used_at: null,
      },
      error: null,
    });
    const res = await GET(makeGetRequest('i1'));
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.expired).toBe(true);
    expect(body.note).toBe('Note: This interview link has expired.');
  });

  it('returns 410 when interview was already used (used_at is set)', async () => {
    mockSingleInterview.mockResolvedValue({
      data: {
        id: 'i1',
        status: 'pending',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        used_at: '2026-10-01T10:00:00Z',
      },
      error: null,
    });
    const res = await GET(makeGetRequest('i1'));
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.expired).toBe(true);
    expect(body.used).toBe(true);
    expect(body.note).toBe('Note: This interview link has already been used and is expired.');
  });

  it('returns 410 when interview status is completed or terminated', async () => {
    for (const status of ['completed', 'terminated']) {
      mockSingleInterview.mockResolvedValue({
        data: {
          id: 'i1',
          status,
          expires_at: new Date(Date.now() + 86400000).toISOString(),
          used_at: null,
        },
        error: null,
      });
      const res = await GET(makeGetRequest('i1'));
      expect(res.status).toBe(410);
      const body = await res.json();
      expect(body.expired).toBe(true);
      expect(body.used).toBe(true);
      expect(body.note).toBe('Note: This interview link has already been used and is expired.');
    }
  });

  it('returns 200 with active: true and inProgress: true when interview is in_progress', async () => {
    mockSingleInterview.mockResolvedValue({
      data: {
        id: 'i1',
        status: 'in_progress',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        used_at: null,
      },
      error: null,
    });
    const res = await GET(makeGetRequest('i1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.active).toBe(true);
    expect(body.inProgress).toBe(true);
  });

  it('returns 200 with active: true when interview is valid and pending', async () => {
    mockSingleInterview.mockResolvedValue({
      data: {
        id: 'i1',
        status: 'pending',
        expires_at: new Date(Date.now() + 86400000).toISOString(),
        used_at: null,
      },
      error: null,
    });
    const res = await GET(makeGetRequest('i1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.active).toBe(true);
    expect(body.status).toBe('pending');
  });
});
