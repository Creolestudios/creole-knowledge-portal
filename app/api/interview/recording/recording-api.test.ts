import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as sessionHandler } from './session/route';
import { POST as completeHandler } from './complete/route';

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: 'session-123', candidate_name: 'Alex Mercer' },
            error: null,
          }),
        })),
      })),
      insert: vi.fn(() => Promise.resolve({ data: {}, error: null })),
    })),
    channel: vi.fn(() => ({
      subscribe: vi.fn().mockResolvedValue({}),
      send: vi.fn().mockResolvedValue({}),
      unsubscribe: vi.fn().mockResolvedValue({}),
    })),
  },
}));

vi.mock('@/lib/ai-interview/invite-token', () => ({
  resolveInterviewSessionId: vi.fn().mockImplementation((id: string) => Promise.resolve(id)),
}));

vi.mock('@/lib/ai-interview/google-drive-recorder', () => ({
  getDriveCredentials: vi.fn(),
  createDriveResumableUploadSession: vi.fn(),
  finalizeDriveFile: vi.fn(),
}));

import {
  getDriveCredentials,
  createDriveResumableUploadSession,
  finalizeDriveFile,
} from '@/lib/ai-interview/google-drive-recorder';

describe('Recording API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/interview/recording/session', () => {
    it('returns 400 if interviewId is missing', async () => {
      const req = new Request('http://localhost/api/interview/recording/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const res = await sessionHandler(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('interviewId is required');
    });

    it('returns notConfigured if drive credentials are not set', async () => {
      vi.mocked(getDriveCredentials).mockReturnValue(null);

      const req = new Request('http://localhost/api/interview/recording/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interviewId: 'session-123' }),
      });

      const res = await sessionHandler(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.notConfigured).toBe(true);
    });

    it('returns uploadUrl and fileName when configured', async () => {
      vi.mocked(getDriveCredentials).mockReturnValue({
        client_email: 'service@example.com',
        private_key: 'fake-key',
      });
      vi.mocked(createDriveResumableUploadSession).mockResolvedValue({
        uploadUrl: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=mock_123',
        fileName: 'interview_alex_mercer.webm',
      });

      const req = new Request('http://localhost/api/interview/recording/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interviewId: 'session-123', fileSize: 5000000 }),
      });

      const res = await sessionHandler(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.uploadUrl).toContain('mock_123');
      expect(json.fileName).toBe('interview_alex_mercer.webm');
    });
  });

  describe('POST /api/interview/recording/complete', () => {
    it('returns 400 if interviewId or fileId is missing', async () => {
      const req = new Request('http://localhost/api/interview/recording/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interviewId: 'session-123' }),
      });

      const res = await completeHandler(req);
      expect(res.status).toBe(400);
    });

    it('finalizes drive file and returns preview link', async () => {
      vi.mocked(getDriveCredentials).mockReturnValue({
        client_email: 'service@example.com',
        private_key: 'fake-key',
      });
      vi.mocked(finalizeDriveFile).mockResolvedValue({
        fileId: 'drive-file-abc',
        webViewLink: 'https://drive.google.com/file/d/drive-file-abc/view',
        previewUrl: 'https://drive.google.com/file/d/drive-file-abc/preview',
      });

      const req = new Request('http://localhost/api/interview/recording/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interviewId: 'session-123', fileId: 'drive-file-abc' }),
      });

      const res = await completeHandler(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.fileId).toBe('drive-file-abc');
      expect(json.previewUrl).toBe('https://drive.google.com/file/d/drive-file-abc/preview');
    });
  });
});
