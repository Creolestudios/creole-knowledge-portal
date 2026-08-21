import { describe, it, expect, vi, beforeEach } from 'vitest';

const { uploadBlogAsGoogleDocMock, shareBlogWithMarketingMock } = vi.hoisted(
  () => ({
    uploadBlogAsGoogleDocMock: vi.fn(),
    shareBlogWithMarketingMock: vi.fn(),
  }),
);

vi.mock('./google-drive', () => ({
  uploadBlogAsGoogleDoc: uploadBlogAsGoogleDocMock,
  shareBlogWithMarketing: shareBlogWithMarketingMock,
}));

import { runPublishPipeline } from './publisher';

type Call = { table: string; type: 'update' | 'insert'; payload: any };

function createSupabaseMock(blog: any, existingLeaderboardEntry: any = null) {
  const state = { blog: blog ? { ...blog } : null };
  const calls: Call[] = [];

  const supabase = {
    from(table: string) {
      if (table === 'roulette_blogs') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: state.blog,
                error: state.blog ? null : { message: 'Blog not found' },
              }),
            }),
          }),
          update: (payload: any) => {
            calls.push({ table, type: 'update', payload });
            state.blog = { ...state.blog, ...payload };
            return { eq: async () => ({ data: null, error: null }) };
          },
        };
      }
      if (table === 'roulette_leaderboard') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: existingLeaderboardEntry, error: null }),
            }),
          }),
          update: (payload: any) => {
            calls.push({ table, type: 'update', payload });
            return { eq: async () => ({ data: null, error: null }) };
          },
          insert: async (payload: any) => {
            calls.push({ table, type: 'insert', payload });
            return { data: null, error: null };
          },
        };
      }
      // roulette_publish_logs
      return {
        insert: async (payload: any) => {
          calls.push({ table, type: 'insert', payload });
          return { data: null, error: null };
        },
      };
    },
  };

  return { supabase, calls };
}

describe('runPublishPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uploads to Drive, shares, awards points to new leaderboard entry, and marks blog PUBLISHED', async () => {
    uploadBlogAsGoogleDocMock.mockResolvedValue({
      fileId: 'file-1',
      webViewLink: 'https://docs.google.com/document/d/file-1',
    });
    shareBlogWithMarketingMock.mockResolvedValue(['marketing@creole.com']);

    const blog = {
      id: 'blog-1',
      title: 'T',
      slug: 't',
      body_html: '<p>hi</p>',
      author_id: 'user-1',
    };
    const { supabase, calls } = createSupabaseMock(blog);

    const result = await runPublishPipeline(
      'blog-1',
      supabase,
      'author@creolestudios.com',
    );

    expect(result).toEqual({
      success: true,
      fileId: 'file-1',
      webViewLink: 'https://docs.google.com/document/d/file-1',
    });
  });

  it('updates existing leaderboard entry with new points and badges', async () => {
    uploadBlogAsGoogleDocMock.mockResolvedValue({
      fileId: 'file-1',
      webViewLink: 'https://docs.google.com/document/d/file-1',
    });
    shareBlogWithMarketingMock.mockResolvedValue(['marketing@creole.com']);

    const blog = {
      id: 'blog-1',
      title: 'T',
      slug: 't',
      body_html: '<p>hi</p>',
      author_id: 'user-1',
    };
    const existingEntry = { user_id: 'user-1', points: 200, badges: ['Early Adopter'] };
    const { supabase, calls } = createSupabaseMock(blog, existingEntry);

    await runPublishPipeline('blog-1', supabase, 'author@creolestudios.com');

    const leaderboardUpdate = calls.find((c) => c.table === 'roulette_leaderboard' && c.type === 'update');
    expect(leaderboardUpdate?.payload.points).toBe(300);
    expect(leaderboardUpdate?.payload.badges).toContain('Knowledge Badge');
  });

  it('throws an error if blog is not found', async () => {
    const { supabase } = createSupabaseMock(null);
    await expect(
      runPublishPipeline('missing-blog', supabase, 'author@creolestudios.com')
    ).rejects.toThrow('Blog not found');
  });

  it('rolls back to PUBLISH_FAILED and logs the error when Drive upload fails', async () => {
    uploadBlogAsGoogleDocMock.mockRejectedValue(new Error('Drive is down'));

    const blog = {
      id: 'blog-2',
      title: 'T2',
      slug: 't2',
      body_html: '<p>hi</p>',
      author_id: 'user-2',
    };
    const { supabase, calls } = createSupabaseMock(blog);

    await expect(
      runPublishPipeline('blog-2', supabase, 'author@creolestudios.com'),
    ).rejects.toThrow('Drive is down');

    const failedUpdate = calls.find(
      (c) =>
        c.table === 'roulette_blogs' && c.payload.status === 'PUBLISH_FAILED',
    );
    expect(failedUpdate).toBeTruthy();
  });
});
