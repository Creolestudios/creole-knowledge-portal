import { describe, it, expect, vi, beforeEach } from 'vitest';

const { state, mockFrom, mockChannel, mockSubscribe, mockSend, mockRemoveChannel } = vi.hoisted(() => {
  const state = {
    eventData: { id: 'evt-1' } as unknown,
    error: null as { message: string } | null,
  };

  const mockSubscribe = vi.fn().mockResolvedValue(undefined);
  const mockSend = vi.fn().mockResolvedValue(undefined);
  const mockRemoveChannel = vi.fn();

  const mockChannel = vi.fn(() => ({
    subscribe: mockSubscribe,
    send: mockSend,
  }));

  const mockFrom = vi.fn(() => ({
    insert: () => ({
      select: () => ({
        single: async () => ({ data: state.eventData, error: state.error }),
      }),
    }),
  }));

  return { state, mockFrom, mockChannel, mockSubscribe, mockSend, mockRemoveChannel };
});

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: mockFrom,
    channel: mockChannel,
    removeChannel: mockRemoveChannel,
  },
}));

import { POST } from './route';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/interview/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/interview/events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.eventData = { id: 'evt-1' };
    state.error = null;
  });

  it('returns 400 when interviewId or category is missing', async () => {
    const res = await POST(makeRequest({ interviewId: 'abc' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('interviewId and category are required');
  });

  it('inserts the event and broadcasts it over realtime', async () => {
    const res = await POST(
      makeRequest({ interviewId: 'abc', category: 'gaze_away', severity: 'warning', confidence: 0.8 }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.event).toEqual({ id: 'evt-1' });
    expect(mockChannel).toHaveBeenCalledWith('interview-monitor:abc');
    expect(mockSubscribe).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'broadcast',
        event: 'proctoring_event',
        payload: expect.objectContaining({ interviewId: 'abc', category: 'gaze_away' }),
      }),
    );
    expect(mockRemoveChannel).toHaveBeenCalledTimes(1);
  });

  it('still returns success when the DB insert errors', async () => {
    state.error = { message: 'insert failed' };
    state.eventData = null;

    const res = await POST(makeRequest({ interviewId: 'abc', category: 'no_face' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.event).toBeNull();
  });

  it('still returns success when the realtime broadcast throws', async () => {
    mockSubscribe.mockRejectedValueOnce(new Error('realtime down'));

    const res = await POST(makeRequest({ interviewId: 'abc', category: 'multi_face' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('returns 400 when the body is not valid JSON', async () => {
    const req = new Request('http://localhost/api/interview/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
