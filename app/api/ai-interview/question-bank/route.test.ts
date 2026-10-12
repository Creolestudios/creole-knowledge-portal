import { describe, it, expect, vi, beforeEach } from 'vitest';

const { state, mockFrom } = vi.hoisted(() => {
  const state = {
    data: [] as unknown[],
    error: null as { message: string } | null,
    throwOnQuery: false,
  };

  const mockFrom = vi.fn(() => ({
    select: () => ({
      eq: () => ({
        order: () => ({
          order: async () => {
            if (state.throwOnQuery) throw new Error('query boom');
            return { data: state.data, error: state.error };
          },
        }),
      }),
    }),
  }));

  return { state, mockFrom };
});

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: mockFrom },
}));

import { GET } from './route';

describe('GET /api/ai-interview/question-bank', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.data = [];
    state.error = null;
    state.throwOnQuery = false;
  });

  it('returns the active question bank rows ordered by category', async () => {
    state.data = [{ id: 'q1', category: 'technical' }];
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.questions).toEqual([{ id: 'q1', category: 'technical' }]);
  });

  it('returns an empty array when no data is returned', async () => {
    state.data = null as unknown as unknown[];
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.questions).toEqual([]);
  });

  it('returns 500 when the query errors', async () => {
    state.error = { message: 'db down' };
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('db down');
  });

  it('returns 500 when the query throws', async () => {
    state.throwOnQuery = true;
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('query boom');
  });
});
