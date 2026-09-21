import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRefreshSession = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { refreshSession: mockRefreshSession },
  }),
}));

import { fetchWithAuthRetry } from './fetch-with-auth';

describe('fetchWithAuthRetry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockRefreshSession.mockReset();
  });

  it('returns the response directly when the status is not 401', async () => {
    const okResponse = new Response('ok', { status: 200 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse);

    const res = await fetchWithAuthRetry('/api/thing');

    expect(res).toBe(okResponse);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('refreshes the session and retries once on a 401', async () => {
    const unauthorized = new Response('nope', { status: 401 });
    const retried = new Response('ok', { status: 200 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(unauthorized).mockResolvedValueOnce(retried);
    mockRefreshSession.mockResolvedValue({ error: null });

    const res = await fetchWithAuthRetry('/api/thing', { method: 'GET' });

    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(res).toBe(retried);
  });

  it('returns the original 401 response when refreshing the session errors', async () => {
    const unauthorized = new Response('nope', { status: 401 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(unauthorized);
    mockRefreshSession.mockResolvedValue({ error: new Error('refresh failed') });

    const res = await fetchWithAuthRetry('/api/thing');

    expect(res).toBe(unauthorized);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('returns the original 401 response when refreshing the session throws', async () => {
    const unauthorized = new Response('nope', { status: 401 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(unauthorized);
    mockRefreshSession.mockRejectedValue(new Error('boom'));

    const res = await fetchWithAuthRetry('/api/thing');

    expect(res).toBe(unauthorized);
  });
});
