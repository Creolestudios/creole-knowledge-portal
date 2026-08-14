import { describe, it, expect, vi, beforeEach } from 'vitest';

const { filesCreateMock, permissionsCreateMock } = vi.hoisted(() => ({
  filesCreateMock: vi.fn(),
  permissionsCreateMock: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    auth: {
      JWT: vi.fn().mockImplementation(function JWT() {
        return {};
      }),
    },
    drive: vi.fn(() => ({
      files: { create: filesCreateMock },
      permissions: { create: permissionsCreateMock },
    })),
  },
}));

import { uploadBlogAsGoogleDoc, uploadBlogToDrive, shareBlogWithMarketing } from './google-drive';

describe('google-drive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DRIVE_FOLDER_ID = 'folder-123';
    process.env.DRIVE_SERVICE_ACCOUNT_KEY_JSON = JSON.stringify({
      client_email: 'svc@example.com',
      private_key: 'fake-key',
    });
    process.env.MARKETING_NOTIFY_EMAILS = 'marketing@creole.com, seo@creole.com';
  });

  describe('uploadBlogAsGoogleDoc', () => {
    it('uploads HTML content as a native Google Doc and returns file metadata', async () => {
      filesCreateMock.mockResolvedValue({
        data: {
          id: 'file-1',
          webViewLink: 'https://docs.google.com/document/d/file-1',
        },
      });

      const result = await uploadBlogAsGoogleDoc(
        { title: 'My Blog', slug: 'my-blog' },
        'author@creolestudios.com',
        '<p>Body content</p>',
      );

      expect(result).toEqual({
        fileId: 'file-1',
        webViewLink: 'https://docs.google.com/document/d/file-1',
      });
      expect(filesCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            name: 'author-my-blog',
            parents: ['folder-123'],
            mimeType: 'application/vnd.google-apps.document',
          }),
          media: expect.objectContaining({ mimeType: 'text/html' }),
        }),
      );
    });

    it('throws when DRIVE_FOLDER_ID is not configured', async () => {
      delete process.env.DRIVE_FOLDER_ID;
      await expect(
        uploadBlogAsGoogleDoc({ title: 'X', slug: null }, 'a@b.com', '<p>x</p>'),
      ).rejects.toThrow('DRIVE_FOLDER_ID');
    });

    it('throws when Drive returns no file metadata', async () => {
      filesCreateMock.mockResolvedValue({ data: {} });
      await expect(
        uploadBlogAsGoogleDoc({ title: 'X', slug: 'x' }, 'a@b.com', '<p>x</p>'),
      ).rejects.toThrow('returned no file metadata');
    });
  });

  describe('uploadBlogToDrive', () => {
    it('uploads a docx buffer and returns file metadata', async () => {
      filesCreateMock.mockResolvedValue({
        data: {
          id: 'file-2',
          webViewLink: 'https://docs.google.com/document/d/file-2',
        },
      });

      const result = await uploadBlogToDrive(
        { title: 'My Blog', slug: 'my-blog' },
        'author@creolestudios.com',
        Buffer.from('docx-bytes'),
      );

      expect(result).toEqual({
        fileId: 'file-2',
        webViewLink: 'https://docs.google.com/document/d/file-2',
      });
      expect(filesCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            name: 'author-my-blog.docx',
            parents: ['folder-123'],
          }),
        }),
      );
    });

    it('throws when credentials are not configured', async () => {
      delete process.env.DRIVE_SERVICE_ACCOUNT_KEY_JSON;
      delete process.env.DRIVE_SERVICE_ACCOUNT_KEY;
      await expect(
        uploadBlogToDrive({ title: 'X', slug: 'x' }, 'a@b.com', Buffer.from('x')),
      ).rejects.toThrow('not configured');
    });

    it('throws when the credentials JSON is malformed', async () => {
      process.env.DRIVE_SERVICE_ACCOUNT_KEY_JSON = '{ not valid json';
      await expect(
        uploadBlogToDrive({ title: 'X', slug: 'x' }, 'a@b.com', Buffer.from('x')),
      ).rejects.toThrow('Failed to parse DRIVE_SERVICE_ACCOUNT_KEY_JSON');
    });
  });

  describe('shareBlogWithMarketing', () => {
    it('shares the file with every configured marketing email', async () => {
      permissionsCreateMock.mockResolvedValue({});
      const emails = await shareBlogWithMarketing(
        'file-1',
        'author@creolestudios.com',
      );
      expect(emails).toEqual(['marketing@creole.com', 'seo@creole.com']);
      expect(permissionsCreateMock).toHaveBeenCalledTimes(2);
    });

    it('returns an empty list when no marketing emails are configured', async () => {
      process.env.MARKETING_NOTIFY_EMAILS = '';
      const emails = await shareBlogWithMarketing(
        'file-1',
        'author@creolestudios.com',
      );
      expect(emails).toEqual([]);
      expect(permissionsCreateMock).not.toHaveBeenCalled();
    });

    it('continues sharing with remaining emails when a non-auth failure occurs', async () => {
      permissionsCreateMock
        .mockRejectedValueOnce({ status: 500, message: 'Server error' })
        .mockResolvedValueOnce({});

      const emails = await shareBlogWithMarketing('file-1', 'author@creolestudios.com');
      expect(emails).toEqual(['marketing@creole.com', 'seo@creole.com']);
      expect(permissionsCreateMock).toHaveBeenCalledTimes(2);
    });

    it('throws on an authorization failure for a share', async () => {
      permissionsCreateMock.mockRejectedValueOnce({
        status: 403,
        message: 'Forbidden',
      });
      await expect(
        shareBlogWithMarketing('file-1', 'author@creolestudios.com'),
      ).rejects.toThrow('Google API authorization failure');
    });
  });
});
