import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({}),
}));

const mockRequireUserAndBlog = vi.fn();
vi.mock('@/lib/blog-roulette/route-helpers', () => ({
  requireUserAndBlog: (...args: any[]) => mockRequireUserAndBlog(...args),
}));

const mockRunPublishPipeline = vi.fn();
vi.mock('@/lib/blog-roulette/publisher', () => ({
  runPublishPipeline: (...args: any[]) => mockRunPublishPipeline(...args),
}));

const mockRequireAdminUser = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  requireAdminUser: () => mockRequireAdminUser(),
}));

import { POST } from './route';

function ctx(id = 'blog-1') {
  return { params: Promise.resolve({ id }) };
}

describe('POST /api/blog-roulette/[id]/publish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the auth helper error response as-is', async () => {
    const errorResponse = new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    mockRequireUserAndBlog.mockResolvedValue({ error: errorResponse });

    const res = await POST(new Request('http://x'), ctx());
    expect(res).toBe(errorResponse);
  });

  it('forbids publishing when the caller is neither the author nor the admin', async () => {
    mockRequireUserAndBlog.mockResolvedValue({
      user: { id: 'someone-else', email: 'random@example.com' },
      blog: { author_id: 'author-1', status: 'PASSED' },
    });
    mockRequireAdminUser.mockResolvedValue(null);

    const res = await POST(new Request('http://x'), ctx());
    expect(res.status).toBe(403);
  });

  it('rejects publishing when the blog status is not eligible', async () => {
    mockRequireUserAndBlog.mockResolvedValue({
      user: { id: 'author-1', email: 'author@creolestudios.com' },
      blog: { author_id: 'author-1', status: 'DRAFT' },
    });
    mockRequireAdminUser.mockResolvedValue(null);

    const res = await POST(new Request('http://x'), ctx());
    expect(res.status).toBe(409);
  });

  it('runs the publish pipeline and returns its result for the author', async () => {
    mockRequireUserAndBlog.mockResolvedValue({
      user: { id: 'author-1', email: 'author@creolestudios.com' },
      blog: { author_id: 'author-1', status: 'PASSED' },
    });
    mockRequireAdminUser.mockResolvedValue(null);
    mockRunPublishPipeline.mockResolvedValue({ url: 'https://example.com/post' });

    const res = await POST(new Request('http://x'), ctx('blog-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, url: 'https://example.com/post' });
    expect(mockRunPublishPipeline).toHaveBeenCalledWith('blog-1', {}, 'author@creolestudios.com');
  });

  it('allows the admin to publish on behalf of another author', async () => {
    mockRequireUserAndBlog.mockResolvedValue({
      user: { id: 'admin-1', email: 'admin@creolestudios.com' },
      blog: { author_id: 'author-1', status: 'PASSED' },
    });
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-1' });
    mockRunPublishPipeline.mockResolvedValue({ url: 'https://example.com/post' });

    const res = await POST(new Request('http://x'), ctx('blog-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, url: 'https://example.com/post' });
    expect(mockRunPublishPipeline).toHaveBeenCalledWith('blog-1', {}, 'admin@creolestudios.com');
  });

  it('returns a 500 when the publish pipeline throws', async () => {
    mockRequireUserAndBlog.mockResolvedValue({
      user: { id: 'author-1', email: 'author@creolestudios.com' },
      blog: { author_id: 'author-1', status: 'PUBLISH_FAILED' },
    });
    mockRequireAdminUser.mockResolvedValue(null);
    mockRunPublishPipeline.mockRejectedValue(new Error('Drive upload failed'));

    const res = await POST(new Request('http://x'), ctx());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Drive upload failed');
  });
});
