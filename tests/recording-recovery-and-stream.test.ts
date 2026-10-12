/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushAndUploadCachedRecording } from '@/lib/ai-interview/use-full-interview-recorder';
import * as storage from '@/lib/ai-interview/recording-storage';

describe('Video Recording Recovery & Streaming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns early when no cached chunks exist in IndexedDB', async () => {
    vi.spyOn(storage, 'getAllRecordingChunks').mockResolvedValue([]);
    const progressSpy = vi.fn();

    const result = await flushAndUploadCachedRecording('test-interview-1', progressSpy);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/No cached recording chunks/i);
    expect(progressSpy).not.toHaveBeenCalled();
  });

  it('recovers cached chunks and uploads via direct Google Drive session with progress reporting', async () => {
    const chunk1 = new Blob(['chunk1-content'], { type: 'video/webm' });
    const chunk2 = new Blob(['chunk2-content'], { type: 'video/webm' });
    vi.spyOn(storage, 'getAllRecordingChunks').mockResolvedValue([chunk1, chunk2]);
    const clearSpy = vi.spyOn(storage, 'clearRecordingChunks').mockResolvedValue();

    const progressReports: Array<{ progress: number; statusText: string }> = [];
    const progressCallback = (progress: number, statusText: string) => {
      progressReports.push({ progress, statusText });
    };

    // Mock fetch for /api/interview/recording/session
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/interview/recording/session')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ uploadUrl: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable' }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, fileId: 'drive-file-123', webViewLink: 'https://drive.google.com/view' }),
      });
    });
    global.fetch = fetchMock;

    // Mock XMLHttpRequest for direct PUT
    const sendSpy = vi.fn();
    class MockXHR {
      upload = {
        onprogress: null as any,
      };
      status = 200;
      responseText = JSON.stringify({ id: 'drive-file-123' });
      open = vi.fn();
      setRequestHeader = vi.fn();
      send = vi.fn(function (this: MockXHR) {
        sendSpy();
        if (this.onload) {
          (this.onload as any)();
        }
      });
      onload: any = null;
      onerror: any = null;
    }
    (global as any).XMLHttpRequest = MockXHR;

    const result = await flushAndUploadCachedRecording('test-interview-1', progressCallback);

    expect(result.success).toBe(true);
    expect(result.fileId).toBe('drive-file-123');
    expect(clearSpy).toHaveBeenCalledWith('test-interview-1');
    expect(progressReports.length).toBeGreaterThan(0);
    expect(progressReports[progressReports.length - 1].progress).toBe(100);
  });

  it('falls back to server-side upload route if direct Google Drive upload fails', async () => {
    const chunk1 = new Blob(['chunk-data'], { type: 'video/webm' });
    vi.spyOn(storage, 'getAllRecordingChunks').mockResolvedValue([chunk1]);
    const clearSpy = vi.spyOn(storage, 'clearRecordingChunks').mockResolvedValue();

    const progressReports: number[] = [];

    // Session creation returns error
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/interview/recording/session')) {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ notConfigured: true }),
        });
      }
      if (url.includes('/api/interview/recording/upload')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            fileId: 'fallback-file-999',
            webViewLink: 'https://drive.google.com/fallback',
            previewUrl: 'https://drive.google.com/preview',
          }),
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });
    global.fetch = fetchMock;

    const result = await flushAndUploadCachedRecording('test-interview-2', (prog) => progressReports.push(prog));

    expect(result.success).toBe(true);
    expect(result.fileId).toBe('fallback-file-999');
    expect(clearSpy).toHaveBeenCalledWith('test-interview-2');
    expect(progressReports).toContain(100);
  });
});
