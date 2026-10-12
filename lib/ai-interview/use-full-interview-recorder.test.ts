// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFullInterviewRecorder } from './use-full-interview-recorder';

describe('useFullInterviewRecorder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with default idle state', () => {
    const { result } = renderHook(() =>
      useFullInterviewRecorder({
        interviewId: 'test-interview-1',
        cameraStream: null,
        screenStream: null,
      })
    );

    expect(result.current.isRecording).toBe(false);
    expect(result.current.isUploading).toBe(false);
    expect(result.current.uploadProgress).toBe(0);
    expect(result.current.uploadStatusText).toBe('');
  });

  it('returns error when stopAndUploadRecording is called without an active recorder', async () => {
    const { result } = renderHook(() =>
      useFullInterviewRecorder({
        interviewId: 'test-interview-1',
        cameraStream: null,
        screenStream: null,
      })
    );

    let res: any;
    await act(async () => {
      res = await result.current.stopAndUploadRecording();
    });

    expect(res.success).toBe(false);
    expect(res.error).toBe('No active recorder');
  });

  it('accepts remoteStream and updates dynamically when admin joins and leaves', () => {
    const mockAudioTrack = { kind: 'audio', stop: vi.fn(), enabled: true };
    const mockAdminStream = {
      getAudioTracks: () => [mockAudioTrack],
      getVideoTracks: () => [],
    } as unknown as MediaStream;

    const { rerender } = renderHook(
      ({ remoteStream }) =>
        useFullInterviewRecorder({
          interviewId: 'test-interview-1',
          cameraStream: null,
          screenStream: null,
          remoteStream,
        }),
      {
        initialProps: { remoteStream: null as MediaStream | null },
      }
    );

    // Admin joins
    expect(() => {
      rerender({ remoteStream: mockAdminStream });
    }).not.toThrow();

    // Admin leaves
    expect(() => {
      rerender({ remoteStream: null });
    }).not.toThrow();
  });
});
