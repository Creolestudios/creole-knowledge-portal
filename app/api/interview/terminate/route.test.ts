import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

const { mockSingleAi, mockSingleSession, mockSingleInvite, mockUpdateEq, mockUpdate } = vi.hoisted(() => {
  const mockUpdateEq = vi.fn();
  return {
    mockSingleAi: vi.fn(),
    mockSingleSession: vi.fn(),
    mockSingleInvite: vi.fn(),
    mockUpdateEq,
    mockUpdate: vi.fn(() => ({ eq: mockUpdateEq })),
  };
});

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      let singleFn = mockSingleAi;
      if (table === 'interview_sessions') singleFn = mockSingleSession;
      if (table === 'interview_invites') singleFn = mockSingleInvite;
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ single: singleFn }),
        }),
        update: (...args: any[]) => mockUpdate(...args),
      };
    }),
  },
}));

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/interview/terminate', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/interview/terminate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSingleAi.mockResolvedValue({ data: null, error: { message: 'not found' } });
    mockSingleSession.mockResolvedValue({ data: null, error: { message: 'not found' } });
    mockSingleInvite.mockResolvedValue({ data: null, error: { message: 'not found' } });
  });

  it('requires interviewId and reason', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it('returns 404 when the interview does not exist', async () => {
    mockSingleAi.mockResolvedValue({ data: null, error: { message: 'not found' } });
    mockSingleSession.mockResolvedValue({ data: null, error: { message: 'not found' } });
    mockSingleInvite.mockResolvedValue({ data: null, error: { message: 'not found' } });
    const res = await POST(makeRequest({ interviewId: 'i1', reason: 'Tab switched' }));
    expect(res.status).toBe(404);
  });

  it('marks an in_progress interview as terminated with the reason and timestamp', async () => {
    mockSingleAi.mockResolvedValue({ data: { id: 'i1', status: 'in_progress' }, error: null });
    mockUpdateEq.mockResolvedValue({ error: null });

    const res = await POST(makeRequest({ interviewId: 'i1', reason: 'Tab switched' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.terminated).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'terminated', termination_reason: 'Tab switched' }),
    );
  });

  it('is idempotent — does not re-update an already-terminated interview', async () => {
    mockSingleAi.mockResolvedValue({ data: { id: 'i1', status: 'terminated' }, error: null });

    const res = await POST(makeRequest({ interviewId: 'i1', reason: 'Tab switched' }));

    expect(res.status).toBe(200);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does not overwrite a completed interview', async () => {
    mockSingleAi.mockResolvedValue({ data: { id: 'i1', status: 'completed' }, error: null });

    const res = await POST(makeRequest({ interviewId: 'i1', reason: 'Tab switched' }));

    expect(res.status).toBe(200);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('successfully terminates an interview when found via interview_sessions', async () => {
    mockSingleAi.mockResolvedValue({ data: null, error: { message: 'not found' } });
    mockSingleSession.mockResolvedValue({ data: { id: 's1', status: 'in_progress' }, error: null });
    mockUpdateEq.mockResolvedValue({ error: null });

    const res = await POST(makeRequest({ interviewId: 's1', reason: 'Multiple faces detected' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.terminated).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled', termination_reason: 'Multiple faces detected' }),
    );
  });
});
