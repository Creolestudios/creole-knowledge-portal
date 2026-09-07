import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  CAMERA_REQUIRED_MESSAGE,
  CAMERA_UNSUPPORTED_MESSAGE,
  ENTIRE_SCREEN_REQUIRED_MESSAGE,
  SCREEN_SHARE_UNSUPPORTED_MESSAGE,
  isEntireScreenTrack,
  requestCameraAccess,
  requestEntireScreenShare,
  stopMediaStream,
  stopScreenShare,
} from './proctor';

function fakeTrack(surface?: string) {
  return {
    getSettings: () => (surface ? { displaySurface: surface } : {}),
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
}

function fakeStream(track: MediaStreamTrack) {
  return {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
}

describe('quiz proctor screen share', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('accepts a monitor share and rejects a window share', async () => {
    const monitor = fakeTrack('monitor');
    const getDisplayMedia = vi.fn().mockResolvedValue(fakeStream(monitor));
    vi.stubGlobal('navigator', {
      mediaDevices: { getDisplayMedia },
    });

    const stream = await requestEntireScreenShare();
    expect(stream.getVideoTracks()[0]).toBe(monitor);

    const windowTrack = fakeTrack('window');
    getDisplayMedia.mockResolvedValue(fakeStream(windowTrack));
    await expect(requestEntireScreenShare()).rejects.toThrow(ENTIRE_SCREEN_REQUIRED_MESSAGE);
    expect(windowTrack.stop).toHaveBeenCalled();
  });

  it('treats a missing displaySurface as entire-screen (browser cannot report it)', () => {
    expect(isEntireScreenTrack(fakeTrack(undefined))).toBe(true);
    expect(isEntireScreenTrack(fakeTrack('browser'))).toBe(false);
  });

  it('throws when getDisplayMedia is unavailable', async () => {
    vi.stubGlobal('navigator', { mediaDevices: {} });
    await expect(requestEntireScreenShare()).rejects.toThrow(SCREEN_SHARE_UNSUPPORTED_MESSAGE);
  });

  it('stops all tracks on stopScreenShare / stopMediaStream', () => {
    const track = fakeTrack('monitor');
    stopScreenShare(fakeStream(track));
    expect(track.stop).toHaveBeenCalled();

    const cam = fakeTrack();
    stopMediaStream(fakeStream(cam));
    expect(cam.stop).toHaveBeenCalled();
  });
});

describe('quiz proctor camera', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests camera via getUserMedia', async () => {
    const track = fakeTrack();
    const getUserMedia = vi.fn().mockResolvedValue(fakeStream(track));
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia },
    });

    const stream = await requestCameraAccess();
    expect(stream.getVideoTracks()[0]).toBe(track);
    expect(getUserMedia).toHaveBeenCalled();
  });

  it('throws when getUserMedia is unavailable', async () => {
    vi.stubGlobal('navigator', { mediaDevices: {} });
    await expect(requestCameraAccess()).rejects.toThrow(CAMERA_UNSUPPORTED_MESSAGE);
  });

  it('throws a clear message when the user denies the camera', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockRejectedValue(new Error('Permission denied')),
      },
    });
    await expect(requestCameraAccess()).rejects.toThrow(CAMERA_REQUIRED_MESSAGE);
  });
});
