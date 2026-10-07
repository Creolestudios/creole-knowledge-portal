import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { google } from 'googleapis';
import {
  getDriveCredentials,
  createDriveResumableUploadSession,
  finalizeDriveFile,
  getRecordingFolderId,
} from './google-drive-recorder';

describe('google-drive-recorder', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('getDriveCredentials', () => {
    it('returns null when no drive credentials are set', () => {
      delete process.env.DRIVE_SERVICE_ACCOUNT_KEY_JSON;
      delete process.env.DRIVE_SERVICE_ACCOUNT_KEY;
      delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
      delete process.env.GOOGLE_PRIVATE_KEY;

      expect(getDriveCredentials()).toBeNull();
    });

    it('parses credentials from JSON string in DRIVE_SERVICE_ACCOUNT_KEY_JSON', () => {
      process.env.DRIVE_SERVICE_ACCOUNT_KEY_JSON = JSON.stringify({
        client_email: 'service@project.iam.gserviceaccount.com',
        private_key: '-----BEGIN PRIVATE KEY-----\\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASC\\n-----END PRIVATE KEY-----\\n',
        project_id: 'test-project',
      });

      const creds = getDriveCredentials();
      expect(creds).not.toBeNull();
      expect(creds?.client_email).toBe('service@project.iam.gserviceaccount.com');
      expect(creds?.private_key).toContain('\n');
    });

    it('parses credentials from separate environment variables', () => {
      delete process.env.DRIVE_SERVICE_ACCOUNT_KEY_JSON;
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'admin@service.iam.gserviceaccount.com';
      process.env.GOOGLE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----\n';

      const creds = getDriveCredentials();
      expect(creds).not.toBeNull();
      expect(creds?.client_email).toBe('admin@service.iam.gserviceaccount.com');
    });
  });

  describe('getRecordingFolderId', () => {
    it('resolves recording folder id in order of precedence', () => {
      process.env.DRIVE_FOLDER_ID = 'generic-folder';
      expect(getRecordingFolderId()).toBe('generic-folder');

      process.env.INTERVIEW_RECORDING_DRIVE_FOLDER_ID = 'special-interview-folder';
      expect(getRecordingFolderId()).toBe('special-interview-folder');
    });
  });

  describe('createDriveResumableUploadSession', () => {
    it('throws when credentials are missing', async () => {
      delete process.env.DRIVE_SERVICE_ACCOUNT_KEY_JSON;
      delete process.env.DRIVE_SERVICE_ACCOUNT_KEY;
      delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
      delete process.env.GOOGLE_PRIVATE_KEY;

      await expect(
        createDriveResumableUploadSession({ interviewId: 'iv-123' })
      ).rejects.toThrow('Google Drive service account credentials are missing.');
    });

    it('successfully initiates session and returns location URL', async () => {
      process.env.DRIVE_SERVICE_ACCOUNT_KEY_JSON = JSON.stringify({
        client_email: 'test@example.com',
        private_key: 'fake-key',
      });

      // Mock getAccessToken on JWT
      vi.spyOn(google.auth.JWT.prototype, 'getAccessToken').mockResolvedValue({
        token: 'mock-oauth-token',
        res: null as any,
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({
          Location: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=mock_session_123',
        }),
      });
      global.fetch = mockFetch;

      const result = await createDriveResumableUploadSession({
        interviewId: 'interview-xyz-789',
        candidateName: 'Jane Doe',
        fileSize: 1048576,
      });

      expect(result.uploadUrl).toBe(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=mock_session_123'
      );
      expect(result.fileName).toContain('interview_jane_doe');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-oauth-token',
            'X-Upload-Content-Length': '1048576',
            'X-Upload-Content-Type': 'video/webm',
          }),
        })
      );
    });
  });

  describe('finalizeDriveFile', () => {
    it('creates permission and fetches file webViewLink and previewUrl', async () => {
      process.env.DRIVE_SERVICE_ACCOUNT_KEY_JSON = JSON.stringify({
        client_email: 'test@example.com',
        private_key: 'fake-key',
      });

      const mockCreate = vi.fn().mockResolvedValue({ data: {} });
      const mockGet = vi.fn().mockResolvedValue({
        data: {
          id: 'file-xyz-123',
          name: 'interview_recording.webm',
          webViewLink: 'https://drive.google.com/file/d/file-xyz-123/view',
          webContentLink: 'https://drive.google.com/uc?id=file-xyz-123&export=download',
        },
      });

      vi.spyOn(google, 'drive').mockReturnValue({
        permissions: { create: mockCreate },
        files: { get: mockGet },
      } as any);

      const result = await finalizeDriveFile('file-xyz-123');

      expect(result.fileId).toBe('file-xyz-123');
      expect(result.webViewLink).toBe('https://drive.google.com/file/d/file-xyz-123/view');
      expect(result.previewUrl).toBe('https://drive.google.com/file/d/file-xyz-123/preview');
      expect(result.webContentLink).toBe('https://drive.google.com/uc?id=file-xyz-123&export=download');
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: 'file-xyz-123',
          requestBody: { role: 'reader', type: 'anyone' },
        })
      );
    });
  });
});
