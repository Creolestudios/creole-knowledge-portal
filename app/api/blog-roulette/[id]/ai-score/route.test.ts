import { describe, it, expect, vi } from 'vitest';

const { mockUpdateEq } = vi.hoisted(() => ({ mockUpdateEq: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    from: vi.fn().mockReturnValue({
      update: vi.fn().mockReturnValue({ eq: mockUpdateEq }),
    }),
  }),
}));

const mockRequireUserAndBlog = vi.fn();
vi.mock('@/lib/blog-roulette/route-helpers', () => ({
  requireUserAndBlog: (...args: any[]) => mockRequireUserAndBlog(...args),
}));

const mockDetectAiScore = vi.fn();
vi.mock('@/lib/blog-roulette/ai-detection', () => ({
  detectAiScore: (...args: any[]) => mockDetectAiScore(...args),
}));

import { POST } from './route';

function ctx(id = 'blog-1') {
  return { params: Promise.resolve({ id }) };
}

function reqWithBody(body: unknown) {
  return new Request('http://x', { method: 'POST', body: JSON.stringify(body) });
}

describe('POST /api/blog-roulette/[id]/ai-score', () => {
  it('returns the auth helper error response as-is', async () => {
    const errorResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    mockRequireUserAndBlog.mockResolvedValue({ error: errorResponse });

    const res = await POST(reqWithBody({ body_html: '<p>x</p>' }), ctx());
    expect(res).toBe(errorResponse);
  });

  it('short-circuits with a zero score when the content is too short', async () => {
    mockRequireUserAndBlog.mockResolvedValue({ user: { id: 'u1' }, blog: { author_id: 'u1' } });

    const res = await POST(reqWithBody({ body_html: '<p>short</p>' }), ctx());
    const body = await res.json();
    expect(body.score).toBe(0);
    expect(mockDetectAiScore).not.toHaveBeenCalled();
  });

  it('scores sufficiently long content and persists it to the blog row', async () => {
    mockRequireUserAndBlog.mockResolvedValue({ user: { id: 'u1' }, blog: { author_id: 'u1' } });
    mockDetectAiScore.mockResolvedValue({ score: 42, signals: ['some signal'] });

    const longHtml = `<p>${'word '.repeat(50)}</p>`;
    const res = await POST(reqWithBody({ body_html: longHtml }), ctx('blog-1'));

    const body = await res.json();
    expect(body).toEqual({ score: 42, signals: ['some signal'] });
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'blog-1');
  });
});
