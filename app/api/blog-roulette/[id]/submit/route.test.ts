import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [] }) }),
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({}) }),
    }),
  }),
}));

const mockRequireUserAndBlog = vi.fn();
vi.mock('@/lib/blog-roulette/route-helpers', () => ({
  requireUserAndBlog: (...args: any[]) => mockRequireUserAndBlog(...args),
}));

import { POST } from './route';

function ctx(id = 'blog-1') {
  return { params: Promise.resolve({ id }) };
}

describe('POST /api/blog-roulette/[id]/submit', () => {
  it('returns the auth helper error response as-is (e.g. 401/404)', async () => {
    const errorResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    mockRequireUserAndBlog.mockResolvedValue({ error: errorResponse });

    const res = await POST(new Request('http://x'), ctx());
    expect(res).toBe(errorResponse);
  });

  it('rejects submission when the blog is not in DRAFT status', async () => {
    mockRequireUserAndBlog.mockResolvedValue({
      user: { id: 'u1' },
      blog: { status: 'SUBMITTED' },
    });

    const res = await POST(new Request('http://x'), ctx());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('Blog already submitted');
  });

  it('returns a 422 checkpoint failure when the draft does not meet publish requirements', async () => {
    mockRequireUserAndBlog.mockResolvedValue({
      user: { id: 'u1' },
      blog: {
        status: 'DRAFT',
        body_html: '<p>too short</p>',
        word_count: 10,
        seo_title: null,
        meta_description: null,
        tldr: null,
        cover_image_url: null,
        ai_score: null,
      },
    });

    const res = await POST(new Request('http://x'), ctx());
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('Checkpoint failed');
    expect(body.result.passed).toBe(false);
  });
});
