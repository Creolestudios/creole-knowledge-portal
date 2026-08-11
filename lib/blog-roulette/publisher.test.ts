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

function createSupabaseMock(blog: any) {
  const state = { blog: { ...blog } };
  const calls: Call[] = [];

  const supabase = {
    from(table: string) {
      if (table === 'roulette_blogs') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: state.blog, error: null }),
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
              single: async () => ({ data: null, error: null }),
            }),
          }),
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

  it('uploads to Drive, shares, awards points, and marks the blog PUBLISHED', async () => {
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
    expect(uploadBlogAsGoogleDocMock).toHaveBeenCalledWith(
      { title: 'T', slug: 't' },
      'author@creolestudios.com',
      '<p>hi</p>',
    );
    expect(shareBlogWithMarketingMock).toHaveBeenCalledWith(
      'file-1',
      'author@creolestudios.com',
    );

    const publishedUpdate = calls.find(
      (c) => c.table === 'roulette_blogs' && c.payload.status === 'PUBLISHED',
    );
    expect(publishedUpdate?.payload).toMatchObject({
      drive_url: 'https://docs.google.com/document/d/file-1',
      drive_file_id: 'file-1',
    });

    const logInsert = calls.find((c) => c.table === 'roulette_publish_logs');
    expect(logInsert?.payload).toMatchObject({
      status: 'success',
      drive_url: 'https://docs.google.com/document/d/file-1',
      drive_file_id: 'file-1',
    });
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

    const failLog = calls.find((c) => c.table === 'roulette_publish_logs');
    expect(failLog?.payload).toMatchObject({
      status: 'failed',
      error_message: 'Drive is down',
    });
    expect(shareBlogWithMarketingMock).not.toHaveBeenCalled();
  });
});
