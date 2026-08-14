import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: mockGenerateContent };
  },
}));

import {
  scrapeUrlContent,
  extractCleanArticle,
  rerankArticles,
  generateDescriptiveBlog,
  chunkBlogSemantically,
} from './blog-compiler';

describe('scrapeUrlContent', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns Jina Reader content when it succeeds with substantial text', async () => {
    const longText = 'x'.repeat(150);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => longText });

    const result = await scrapeUrlContent('https://example.com/post');
    expect(result).toBe(longText);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to a direct fetch when Jina Reader returns too little text', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, text: async () => 'short' })
      .mockResolvedValueOnce({ ok: true, text: async () => 'direct fetch body' });

    const result = await scrapeUrlContent('https://example.com/post');
    expect(result).toBe('direct fetch body');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('falls back to a direct fetch when Jina Reader throws', async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('jina down'))
      .mockResolvedValueOnce({ ok: true, text: async () => 'direct fetch body' });

    const result = await scrapeUrlContent('https://example.com/post');
    expect(result).toBe('direct fetch body');
  });

  it('throws when the direct fetch fallback also fails', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: false, statusText: 'Not Found' });

    await expect(scrapeUrlContent('https://example.com/post')).rejects.toThrow('Failed to fetch');
  });
});

describe('extractCleanArticle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('parses the Gemini JSON response into article metadata', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        title: 'Great Article',
        author: 'Jane Doe',
        bodyMarkdown: '# Great Article\n\nBody text.',
        tags: ['react', 'testing'],
      }),
    });

    const result = await extractCleanArticle('https://example.com', '<html>raw</html>');
    expect(result).toEqual({
      title: 'Great Article',
      author: 'Jane Doe',
      bodyMarkdown: '# Great Article\n\nBody text.',
      tags: ['react', 'testing'],
    });
  });

  it('applies sane defaults when fields are missing from the response', async () => {
    mockGenerateContent.mockResolvedValue({ text: JSON.stringify({}) });

    const result = await extractCleanArticle('https://example.com', '<html>raw</html>');
    expect(result).toEqual({
      title: 'Untitled Article',
      author: 'Unknown',
      bodyMarkdown: '',
      tags: [],
    });
  });
});

describe('rerankArticles', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null for an empty candidate list', async () => {
    expect(await rerankArticles({}, [])).toBeNull();
  });

  it('returns the sole candidate without calling Gemini when there is only one', async () => {
    const article = { title: 'Only One' };
    expect(await rerankArticles({}, [article])).toBe(article);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('selects the candidate at the index Gemini returns', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ selectedIndex: 1, reasoning: 'better fit' }),
    });
    const articles = [{ title: 'A' }, { title: 'B' }];

    const result = await rerankArticles({ current_role: 'Backend' }, articles);
    expect(result).toBe(articles[1]);
  });

  it('falls back to the first candidate when the selected index is invalid', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({ selectedIndex: 99 }),
    });
    const articles = [{ title: 'A' }, { title: 'B' }];

    const result = await rerankArticles({}, articles);
    expect(result).toBe(articles[0]);
  });
});

describe('generateDescriptiveBlog', () => {
  it('returns the raw Gemini text response', async () => {
    mockGenerateContent.mockResolvedValue({ text: '# Masterclass\n\nFull content' });

    const result = await generateDescriptiveBlog(
      { title: 'Source', bodyMarkdown: 'source body' },
      { current_role: 'Frontend', years_of_experience: 3 },
    );
    expect(result).toBe('# Masterclass\n\nFull content');
  });
});

describe('chunkBlogSemantically', () => {
  it('parses the Gemini JSON array response into blog chunks', async () => {
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify([
        { partNumber: 1, title: 'Part 1', content: 'content 1' },
        { partNumber: 2, title: 'Part 2', content: 'content 2' },
      ]),
    });

    const chunks = await chunkBlogSemantically('# Full Blog\n\nLots of content', 20);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toEqual({ partNumber: 1, title: 'Part 1', content: 'content 1' });
  });
});
