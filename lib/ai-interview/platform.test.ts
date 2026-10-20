import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isLinuxClient,
  isSystemAudioMonitorDevice,
  acquireLinuxSystemAudioMonitorStream,
} from './platform';

describe('isLinuxClient', () => {
  const originalNavigator = global.navigator;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
  });

  it('returns true when navigator.userAgentData.platform is Linux', () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        userAgentData: { platform: 'Linux' },
        userAgent: 'Mozilla/5.0 Chrome/130.0.0.0',
      },
      configurable: true,
      writable: true,
    });

    expect(isLinuxClient()).toBe(true);
  });

  it('returns false when navigator.userAgentData.platform is ChromeOS (CrOS)', () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        userAgentData: { platform: 'Chrome OS' },
        userAgent: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/130.0.0.0',
      },
      configurable: true,
      writable: true,
    });

    expect(isLinuxClient()).toBe(false);
  });

  it('returns false when navigator.userAgentData.platform is Windows', () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        userAgentData: { platform: 'Windows' },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0.0.0',
      },
      configurable: true,
      writable: true,
    });

    expect(isLinuxClient()).toBe(false);
  });

  it('returns false when navigator.userAgentData.platform is macOS', () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        userAgentData: { platform: 'macOS' },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0.0.0',
      },
      configurable: true,
      writable: true,
    });

    expect(isLinuxClient()).toBe(false);
  });

  it('returns true for Linux userAgent with X11 in test mode', () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      },
      configurable: true,
      writable: true,
    });

    expect(isLinuxClient()).toBe(true);
  });

  it('returns false for Windows userAgent in test mode', () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      },
      configurable: true,
      writable: true,
    });

    expect(isLinuxClient()).toBe(false);
  });

  it('returns false for macOS userAgent in test mode', () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      },
      configurable: true,
      writable: true,
    });

    expect(isLinuxClient()).toBe(false);
  });

  it('returns false when navigator is undefined', () => {
    // @ts-ignore
    delete global.navigator;
    expect(isLinuxClient()).toBe(false);
  });
});

describe('isSystemAudioMonitorDevice', () => {
  it('returns true for standard PulseAudio / PipeWire monitor devices', () => {
    const device = {
      deviceId: 'dev-1',
      groupId: 'grp-1',
      kind: 'audioinput',
      label: 'Monitor of Built-in Audio Analog Stereo',
      toJSON: () => {},
    } as MediaDeviceInfo;

    expect(isSystemAudioMonitorDevice(device)).toBe(true);
  });

  it('returns true for virtual loopback devices', () => {
    const device = {
      deviceId: 'dev-2',
      groupId: 'grp-2',
      kind: 'audioinput',
      label: 'PulseAudio Loopback',
      toJSON: () => {},
    } as MediaDeviceInfo;

    expect(isSystemAudioMonitorDevice(device)).toBe(true);
  });

  it('returns true for remapped virtual microphone sources', () => {
    const device = {
      deviceId: 'dev-3',
      groupId: 'grp-3',
      kind: 'audioinput',
      label: 'Virtual_Microphone',
      toJSON: () => {},
    } as MediaDeviceInfo;

    expect(isSystemAudioMonitorDevice(device)).toBe(true);
  });

  it('returns false for regular physical microphones', () => {
    const device = {
      deviceId: 'dev-4',
      groupId: 'grp-4',
      kind: 'audioinput',
      label: 'Digital Microphone (Built-in)',
      toJSON: () => {},
    } as MediaDeviceInfo;

    expect(isSystemAudioMonitorDevice(device)).toBe(false);
  });

  it('returns false for non-audioinput kinds', () => {
    const device = {
      deviceId: 'dev-5',
      groupId: 'grp-5',
      kind: 'audiooutput',
      label: 'Monitor of Built-in Audio',
      toJSON: () => {},
    } as MediaDeviceInfo;

    expect(isSystemAudioMonitorDevice(device)).toBe(false);
  });
});

describe('acquireLinuxSystemAudioMonitorStream', () => {
  const originalNavigator = global.navigator;

  afterEach(() => {
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
  });

  it('returns live stream when monitor device is present in enumerateDevices', async () => {
    const fakeStream = {
      getAudioTracks: () => [{ id: 'track-1', stop: vi.fn(), readyState: 'live' }],
    } as unknown as MediaStream;

    const mockEnumerate = vi.fn().mockResolvedValue([
      { deviceId: 'mic-1', kind: 'audioinput', label: 'Internal Mic' },
      { deviceId: 'monitor-1', kind: 'audioinput', label: 'Monitor of Built-in Audio Analog Stereo' },
    ]);
    const mockGetUserMedia = vi.fn().mockResolvedValue(fakeStream);

    Object.defineProperty(global, 'navigator', {
      value: {
        mediaDevices: {
          enumerateDevices: mockEnumerate,
          getUserMedia: mockGetUserMedia,
        },
      },
      configurable: true,
      writable: true,
    });

    const stream = await acquireLinuxSystemAudioMonitorStream();
    expect(stream).toBe(fakeStream);
    expect(mockGetUserMedia).toHaveBeenCalledWith({
      audio: {
        deviceId: { exact: 'monitor-1' },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
  });

  it('returns null when no monitor device is found in enumerateDevices', async () => {
    const mockEnumerate = vi.fn().mockResolvedValue([
      { deviceId: 'mic-1', kind: 'audioinput', label: 'Internal Mic' },
    ]);
    const mockGetUserMedia = vi.fn();

    Object.defineProperty(global, 'navigator', {
      value: {
        mediaDevices: {
          enumerateDevices: mockEnumerate,
          getUserMedia: mockGetUserMedia,
        },
      },
      configurable: true,
      writable: true,
    });

    const stream = await acquireLinuxSystemAudioMonitorStream();
    expect(stream).toBeNull();
    expect(mockGetUserMedia).not.toHaveBeenCalled();
  });
});
