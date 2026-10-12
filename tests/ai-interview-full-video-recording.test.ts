// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as createSessionRoute } from '../app/api/interview/recording/session/route';
import { POST as completeRecordingRoute } from '../app/api/interview/recording/complete/route';
import { GET as getAdminInterviewsRoute } from '../app/api/admin/ai-interviews/route';
import {
  getDriveCredentials,
  createDriveResumableUploadSession,
  finalizeDriveFile,
} from '../lib/ai-interview/google-drive-recorder';

const mockInsert = vi.fn().mockResolvedValue({ data: {}, error: null });
const mockEventsSelect = vi.fn().mockReturnValue({
  in: vi.fn().mockReturnValue({
    or: vi.fn().mockResolvedValue({
      data: [
        {
          session_id: 'session-full-rec-1',
          meta: {
            fileId: 'google-drive-file-12345',
            webViewLink: 'https://drive.google.com/file/d/google-drive-file-12345/view',
            previewUrl: 'https://drive.google.com/file/d/google-drive-file-12345/preview',
          },
        },
      ],
      error: null,
    }),
  }),
});

vi.mock('@/lib/supabase/admin', () => ({
  requireAdminUser: vi.fn().mockResolvedValue({ userId: 'admin-user-1', email: 'hr@example.com' }),
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'interview_sessions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'session-full-rec-1', candidate_name: 'Jordan Belfort' },
                error: null,
              }),
              order: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue({
                    data: [
                      {
                        id: 'session-full-rec-1',
                        candidate_name: 'Jordan Belfort',
                        candidate_email: 'jordan@example.com',
                        parsed_jd: { jobTitle: 'Senior Systems Architect' },
                        status: 'completed',
                        created_at: '2026-10-07T10:00:00Z',
                        interview_invites: [{ status: 'completed', expires_at: null }],
                      },
                    ],
                    error: null,
                  }),
                })),
              })),
            })),
          })),
        };
      }
      if (table === 'interview_events') {
        return {
          insert: mockInsert,
          select: mockEventsSelect,
        };
      }
      return {
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) })) })),
        insert: mockInsert,
      };
    }),
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

describe('Full Video Recording Architecture E2E Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Step 1 & 2: Backend issues a resumable Google Drive upload session without Vercel payload bottlenecks', async () => {
    vi.mocked(getDriveCredentials).mockReturnValue({
      client_email: 'drive-service@creole.iam.gserviceaccount.com',
      private_key: 'mock-private-key',
    });

    vi.mocked(createDriveResumableUploadSession).mockResolvedValue({
      uploadUrl: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=resumable_drive_tok_99',
      fileName: 'interview_jordan_belfort_session-full-rec-1_2026-10-07.webm',
    });

    const sessionReq = new Request('http://localhost/api/interview/recording/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        interviewId: 'session-full-rec-1',
        fileSize: 45000000, // 45 MB whole video
        mimeType: 'video/webm',
      }),
    });

    const res = await createSessionRoute(sessionReq);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.uploadUrl).toContain('resumable_drive_tok_99');
    expect(json.fileName).toContain('interview_jordan_belfort');
  });

  it('Step 3: When frontend finishes uploading whole video to Drive, complete endpoint secures permissions and logs event', async () => {
    vi.mocked(getDriveCredentials).mockReturnValue({
      client_email: 'drive-service@creole.iam.gserviceaccount.com',
      private_key: 'mock-private-key',
    });

    vi.mocked(finalizeDriveFile).mockResolvedValue({
      fileId: 'google-drive-file-12345',
      webViewLink: 'https://drive.google.com/file/d/google-drive-file-12345/view',
      previewUrl: 'https://drive.google.com/file/d/google-drive-file-12345/preview',
    });

    const completeReq = new Request('http://localhost/api/interview/recording/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        interviewId: 'session-full-rec-1',
        fileId: 'google-drive-file-12345',
        fileName: 'interview_jordan_belfort.webm',
      }),
    });

    const res = await completeRecordingRoute(completeReq);
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(json.fileId).toBe('google-drive-file-12345');
    expect(json.previewUrl).toBe('https://drive.google.com/file/d/google-drive-file-12345/preview');

    // Confirm stored in interview_events with category full_recording
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: 'session-full-rec-1',
        category: 'full_recording',
        event_type: 'full_recording',
        severity: 'info',
        meta: expect.objectContaining({
          fileId: 'google-drive-file-12345',
          webViewLink: 'https://drive.google.com/file/d/google-drive-file-12345/view',
          previewUrl: 'https://drive.google.com/file/d/google-drive-file-12345/preview',
        }),
      })
    );
  });

  it('Step 4: HR dashboard surfaces the Google Drive recording link in interview summaries', async () => {
    const res = await getAdminInterviewsRoute();
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(Array.isArray(json.interviews)).toBe(true);
    expect(json.interviews.length).toBe(1);
    const firstInterview = json.interviews[0];
    expect(firstInterview.id).toBe('session-full-rec-1');
    expect(firstInterview.recording_url).toBe(
      'https://drive.google.com/file/d/google-drive-file-12345/view'
    );
  });
});
