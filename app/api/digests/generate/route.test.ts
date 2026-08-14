import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(() => ({ auth: { getUser: mockGetUser } })),
}));

vi.mock('@/lib/dev/mock-user', () => ({
  mockUserFromCookie: vi.fn().mockReturnValue(null),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn().mockReturnValue(undefined) }),
}));

const mockRerankArticles = vi.fn();
const mockScrapeUrlContent = vi.fn();
const mockExtractCleanArticle = vi.fn();
const mockGenerateDescriptiveBlog = vi.fn();
const mockCalculateReadingTime = vi.fn();
const mockChunkBlogSemantically = vi.fn();

vi.mock('@/lib/synthesis/blog-compiler', () => ({
  scrapeUrlContent: (...args: any[]) => mockScrapeUrlContent(...args),
  extractCleanArticle: (...args: any[]) => mockExtractCleanArticle(...args),
  rerankArticles: (...args: any[]) => mockRerankArticles(...args),
  generateDescriptiveBlog: (...args: any[]) => mockGenerateDescriptiveBlog(...args),
  calculateReadingTime: (...args: any[]) => mockCalculateReadingTime(...args),
  chunkBlogSemantically: (...args: any[]) => mockChunkBlogSemantically(...args),
}));

const mockGenerateQuizForBlog = vi.fn();
vi.mock('@/lib/ai/quiz-generator', () => ({
  generateQuizForBlog: (...args: any[]) => mockGenerateQuizForBlog(...args),
}));

let tableResponses: Record<string, any[]>;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      const chain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        delete: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        then: vi.fn((resolve) => {
          const queue = tableResponses[table] ?? [];
          const res = queue.length > 0 ? queue.shift() : { data: null, error: null };
          resolve(res);
        }),
      };
      return chain;
    }),
  },
}));

function mockRequest(body: unknown) {
  return new Request('http://localhost/api/digests/generate', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/digests/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tableResponses = {};
    global.fetch = vi.fn().mockResolvedValue({ ok: false }); // no external candidates by default
  });

  it('returns 400 when no user id can be resolved', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(mockRequest({}));
    expect(res.status).toBe(400);
  });

  it('returns 404 when the user profile does not exist', async () => {
    tableResponses = { user_profiles: [{ data: null, error: { message: 'not found' } }] };
    const res = await POST(mockRequest({ userId: 'user-1' }));
    expect(res.status).toBe(404);
  });

  it('returns a 500 when no article candidates could be sourced from any feed', async () => {
    tableResponses = {
      user_profiles: [{ data: { user_id: 'user-1' }, error: null }],
      blog_sources: [{ data: [], error: null }],
    };
    const res = await POST(mockRequest({ userId: 'user-1' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain('No articles found');
  });

  it('generates a digest series from admin-curated sources end to end', async () => {
    tableResponses = {
      user_profiles: [{ data: { user_id: 'user-1' }, error: null }],
      blog_sources: [{ data: [{ url: 'https://example.com/feed' }], error: null }],
      blogs: [
        { error: null }, // delete previous series
        {
          data: { id: 'blog-part-1', content: 'Part 1 content' },
          error: null,
        }, // insert part 1
      ],
      daily_30_curation: [{ error: null }, { error: null }],
    };

    // Admin source scrape succeeds with a page title
    (global.fetch as any) = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><title>Cool Article</title></html>',
    });

    mockRerankArticles.mockResolvedValue({
      title: 'Highlights from example.com',
      url: 'https://example.com/feed',
      source: 'Admin Curation',
      summary: 'Curated content',
      tags: ['curation'],
    });
    mockScrapeUrlContent.mockResolvedValue('full scraped article text');
    mockExtractCleanArticle.mockResolvedValue({
      title: 'Cool Article',
      author: 'Jane',
      bodyMarkdown: 'body',
      tags: ['tech'],
    });
    mockGenerateDescriptiveBlog.mockResolvedValue('# Full descriptive blog');
    mockCalculateReadingTime.mockReturnValue(20);
    mockChunkBlogSemantically.mockResolvedValue([
      { partNumber: 1, title: 'Day 1', content: 'Part 1 content' },
    ]);
    mockGenerateQuizForBlog.mockResolvedValue(undefined);

    const res = await POST(mockRequest({ userId: 'user-1' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.blog.id).toBe('blog-part-1');
    expect(body.meta.totalParts).toBe(1);
    expect(mockGenerateQuizForBlog).toHaveBeenCalledWith('blog-part-1', 'Part 1 content');
  });

  it('still returns the digest when quiz generation fails (best-effort)', async () => {
    tableResponses = {
      user_profiles: [{ data: { user_id: 'user-1' }, error: null }],
      blog_sources: [{ data: [{ url: 'https://example.com/feed' }], error: null }],
      blogs: [
        { error: null },
        { data: { id: 'blog-part-1', content: 'Part 1 content' }, error: null },
      ],
      daily_30_curation: [{ error: null }, { error: null }],
    };
    // Admin source scrape throws -> route's catch pushes a fallback candidate.
    (global.fetch as any) = vi.fn().mockRejectedValue(new Error('network unreachable'));

    mockRerankArticles.mockResolvedValue({
      title: 'Fallback Source',
      url: 'https://example.com/feed',
      source: 'Admin Curation',
      summary: 'Curated content',
      tags: [],
    });
    mockScrapeUrlContent.mockRejectedValue(new Error('scrape failed'));
    mockExtractCleanArticle.mockResolvedValue({ title: 'T', author: 'A', bodyMarkdown: 'b', tags: [] });
    mockGenerateDescriptiveBlog.mockResolvedValue('# blog');
    mockCalculateReadingTime.mockReturnValue(15);
    mockChunkBlogSemantically.mockResolvedValue([{ partNumber: 1, title: 'Day 1', content: 'c' }]);
    mockGenerateQuizForBlog.mockRejectedValue(new Error('quiz gen failed'));

    const res = await POST(mockRequest({ userId: 'user-1' }));
    expect(res.status).toBe(200);
  });
});
