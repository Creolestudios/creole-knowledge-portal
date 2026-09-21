import { describe, it, expect, vi, beforeEach } from 'vitest';

const { state, mockUpload } = vi.hoisted(() => {
  const state = {
    data: { path: 'stored/path.jpg' } as { path: string } | null,
    error: null as { message: string } | null,
  };

  const mockUpload = vi.fn(async () => ({ data: state.data, error: state.error }));

  return { state, mockUpload };
});

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({ upload: mockUpload }),
    },
  },
}));

import { POST } from './route';

function makeFormRequest(fields: Record<string, string | Blob>): Request {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  return new Request('http://localhost/api/interview/snapshots', {
    method: 'POST',
    body: formData,
  });
}

describe('POST /api/interview/snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.data = { path: 'stored/path.jpg' };
    state.error = null;
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await POST(makeFormRequest({ interviewId: 'abc' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe('interviewId, category, and file are required');
  });

  it('uploads the snapshot and returns the stored path', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'snap.jpg', { type: 'image/jpeg' });
    const res = await POST(makeFormRequest({ interviewId: 'abc', category: 'no_face', file }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.path).toBe('stored/path.jpg');
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });

  it('falls back to the generated filename when upload errors', async () => {
    state.data = null;
    state.error = { message: 'bucket missing' };
    const file = new File([new Uint8Array([1])], 'snap.jpg', { type: 'image/jpeg' });

    const res = await POST(makeFormRequest({ interviewId: 'abc', category: 'multi_face', file }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.path).toContain('abc/');
  });

  it('returns 500 when an unexpected error is thrown', async () => {
    const req = new Request('http://localhost/api/interview/snapshots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not form data',
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});
