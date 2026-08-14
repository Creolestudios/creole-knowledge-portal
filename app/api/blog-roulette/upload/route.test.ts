import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(() => ({ auth: { getUser: mockGetUser } })),
}));

const mockUpload = vi.fn();
const mockCreateBucket = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    storage: {
      from: vi.fn().mockReturnValue({ upload: (...args: any[]) => mockUpload(...args) }),
      createBucket: (...args: any[]) => mockCreateBucket(...args),
    },
  },
}));

function makeFile(name: string, type: string, content = 'x'.repeat(10)) {
  return new File([content], name, { type });
}

function makeUploadRequest(file: File | null) {
  const form = new FormData();
  if (file) form.set('file', file);
  return new Request('http://localhost/api/blog-roulette/upload', { method: 'POST', body: form });
}

describe('POST /api/blog-roulette/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(makeUploadRequest(makeFile('a.png', 'image/png')));
    expect(res.status).toBe(401);
  });

  it('requires a file field', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const res = await POST(makeUploadRequest(null));
    expect(res.status).toBe(400);
  });

  it('rejects unsupported file types', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const res = await POST(makeUploadRequest(makeFile('a.pdf', 'application/pdf')));
    expect(res.status).toBe(400);
  });

  it('rejects files larger than the 5 MB limit', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const bigContent = 'x'.repeat(6 * 1024 * 1024);
    const res = await POST(makeUploadRequest(makeFile('big.png', 'image/png', bigContent)));
    expect(res.status).toBe(400);
  });

  it('uploads successfully and returns the public URL', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockUpload.mockResolvedValue({ error: null, data: { path: 'ignored' } });

    const res = await POST(makeUploadRequest(makeFile('cover.png', 'image/png')));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toContain('https://example.supabase.co/storage/v1/object/public/blog-images/');
  });

  it('creates the bucket on the fly and retries when it does not exist yet', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockUpload
      .mockResolvedValueOnce({ error: { message: 'bucket not found' }, data: null })
      .mockResolvedValueOnce({ error: null, data: { path: 'ok' } });
    mockCreateBucket.mockResolvedValue({ error: null });

    const res = await POST(makeUploadRequest(makeFile('cover.png', 'image/png')));
    expect(res.status).toBe(200);
    expect(mockCreateBucket).toHaveBeenCalledWith('blog-images', expect.objectContaining({ public: true }));
    expect(mockUpload).toHaveBeenCalledTimes(2);
  });

  it('returns a 500 when bucket creation fails', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockUpload.mockResolvedValue({ error: { message: 'bucket not found' }, data: null });
    mockCreateBucket.mockResolvedValue({ error: { message: 'permission denied' } });

    const res = await POST(makeUploadRequest(makeFile('cover.png', 'image/png')));
    expect(res.status).toBe(500);
  });

  it('returns a 500 on a non-bucket upload error', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockUpload.mockResolvedValue({ error: { message: 'disk full' }, data: null });

    const res = await POST(makeUploadRequest(makeFile('cover.png', 'image/png')));
    expect(res.status).toBe(500);
  });
});
