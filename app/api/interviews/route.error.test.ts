import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST, GET } from './route';

const { state, mockFrom } = vi.hoisted(() => {
  const state = {
    throwOnInsert: false,
    throwOnSelect: false,
    selectError: null as any,
  };

  const mockFrom = vi.fn(() => ({
    insert: () => {
      if (state.throwOnInsert) throw new Error('insert boom');
      return {
        select: () => ({
          single: async () => ({ data: { id: 's1' }, error: null }),
        }),
      };
    },
    select: () => ({
      order: async () => {
        if (state.throwOnSelect) throw new Error('select boom');
        return { data: null, error: state.selectError };
      },
    }),
  }));

  return { state, mockFrom };
});

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: mockFrom },
  requireAdminUser: vi.fn().mockResolvedValue({ userId: 'admin-1' }),
}));

describe('POST/GET /api/interviews error branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.throwOnInsert = false;
    state.throwOnSelect = false;
    state.selectError = null;
  });

  it('POST returns 500 when an unexpected error is thrown', async () => {
    state.throwOnInsert = true;
    const req = new Request('http://localhost/api/interviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidate_name: 'Jane' }),
    });
    const res = await POST(req as any);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('insert boom');
  });

  it('GET returns 500 when the query errors', async () => {
    state.selectError = { message: 'db down' };
    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('db down');
  });

  it('GET returns 500 when an unexpected error is thrown', async () => {
    state.throwOnSelect = true;
    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('select boom');
  });
});
