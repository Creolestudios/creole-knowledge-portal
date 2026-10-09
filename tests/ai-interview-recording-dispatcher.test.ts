import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

vi.mock('@/lib/ai-interview/google-drive-recorder', () => ({
  deleteDriveFile: vi.fn(),
  getDriveClient: vi.fn(),
}));

import { dispatchRecordingRetentionCleanup } from '@/lib/ai-interview/recording-retention-dispatcher';
import * as driveRecorder from '@/lib/ai-interview/google-drive-recorder';

describe('Recording Retention Dispatcher (90-Day Cleanup)', () => {
  const ninetyOneDaysAgoMs = Date.now() - 91 * 24 * 60 * 60 * 1000;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs dryRun without calling deleteDriveFile or updating database', async () => {
    const mockEvents = [
      {
        id: 'ev-old-1',
        session_id: 'sess-old-1',
        ts_ms: ninetyOneDaysAgoMs,
        meta: { fileId: 'drive-file-123' },
      },
    ];

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lt: vi.fn().mockResolvedValue({ data: mockEvents, error: null }),
      update: vi.fn().mockReturnThis(),
    });

    const result = await dispatchRecordingRetentionCleanup({
      retentionDays: 90,
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.totalFound).toBe(1);
    expect(result.items[0].status).toBe('would_purge');
    expect(driveRecorder.deleteDriveFile).not.toHaveBeenCalled();
  });

  it('deletes expired files from Google Drive and updates database status to purged', async () => {
    const mockEvents = [
      {
        id: 'ev-old-1',
        session_id: 'sess-old-1',
        ts_ms: ninetyOneDaysAgoMs,
        meta: { fileId: 'drive-file-123', webViewLink: 'https://drive.google.com/...' },
      },
    ];

    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lt: vi.fn().mockResolvedValue({ data: mockEvents, error: null }),
      update: updateMock,
    });

    vi.mocked(driveRecorder.deleteDriveFile).mockResolvedValue({
      success: true,
      alreadyDeleted: false,
    });

    const result = await dispatchRecordingRetentionCleanup({
      retentionDays: 90,
      dryRun: false,
    });

    expect(driveRecorder.deleteDriveFile).toHaveBeenCalledWith('drive-file-123');
    expect(updateMock).toHaveBeenCalled();
    expect(result.deletedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.items[0].status).toBe('purged');
  });

  it('skips recordings that are already marked as purged', async () => {
    const mockEvents = [
      {
        id: 'ev-already-purged',
        session_id: 'sess-1',
        ts_ms: ninetyOneDaysAgoMs,
        meta: { fileId: 'drive-file-abc', status: 'purged' },
      },
    ];

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      lt: vi.fn().mockResolvedValue({ data: mockEvents, error: null }),
      update: vi.fn().mockReturnThis(),
    });

    const result = await dispatchRecordingRetentionCleanup({
      retentionDays: 90,
      dryRun: false,
    });

    expect(driveRecorder.deleteDriveFile).not.toHaveBeenCalled();
    expect(result.totalFound).toBe(0);
  });
});
