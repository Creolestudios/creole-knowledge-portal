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
  return new Request('http://localhost/api/interview/terminate', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/interview/terminate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires interviewId and reason', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it('returns 404 when the interview does not exist', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'not found' } });
    const res = await POST(makeRequest({ interviewId: 'i1', reason: 'Tab switched' }));
    expect(res.status).toBe(404);
  });

  it('marks an in_progress interview as terminated with the reason and timestamp', async () => {
    mockSingle.mockResolvedValue({ data: { id: 'i1', status: 'in_progress' }, error: null });
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
    mockSingle.mockResolvedValue({ data: { id: 'i1', status: 'terminated' }, error: null });

    const res = await POST(makeRequest({ interviewId: 'i1', reason: 'Tab switched' }));

    expect(res.status).toBe(200);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does not overwrite a completed interview', async () => {
    mockSingle.mockResolvedValue({ data: { id: 'i1', status: 'completed' }, error: null });

    const res = await POST(makeRequest({ interviewId: 'i1', reason: 'Tab switched' }));

    expect(res.status).toBe(200);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
