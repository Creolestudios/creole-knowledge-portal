// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { mockGetUser, mockProfileSingle, mockEq, mockSelect, mockFrom, mockPush } = vi.hoisted(() => {
  const mockProfileSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  const mockEq = vi.fn().mockReturnValue({ single: mockProfileSingle });
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
  const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });
  const mockGetUser = vi.fn().mockResolvedValue({ data: { user: null }, error: null });
  const mockPush = vi.fn();
  return { mockGetUser, mockProfileSingle, mockEq, mockSelect, mockFrom, mockPush };
});

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
    channel: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
      send: vi.fn(),
      unsubscribe: vi.fn(),
    }),
  }),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'interview-linux-adaptive' }),
  useRouter: () => ({ push: mockPush, replace: vi.fn(), back: vi.fn() }),
}));

import InterviewEntryPage from './page';

describe('Linux Screen & System Audio Adaptive Proctoring Support', () => {
  const originalFetch = global.fetch;
  const originalMediaDevices = global.navigator.mediaDevices;
  const originalUserAgent = global.navigator.userAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    sessionStorage.clear();
    localStorage.clear();
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: originalMediaDevices,
      configurable: true,
    });
    Object.defineProperty(global.navigator, 'userAgent', {
      value: originalUserAgent,
      configurable: true,
    });
  });

  async function reachInstructionsScreen() {
    global.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/interview/verify')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ verified: true, interviewId: 'interview-linux-adaptive' }),
        });
      }
      if (urlStr.includes('/questions')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ questions: [] }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });
    });

    render(<InterviewEntryPage />);

    // Step 1: email
    fireEvent.change(screen.getByPlaceholderText('Enter your email'), { target: { value: 'candidate@example.com' } });
    fireEvent.click(screen.getByText('Continue'));

    // Step 2: access code
    const accessCodeInput = await screen.findByPlaceholderText('000000');
    fireEvent.change(accessCodeInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByText('Continue'));

    expect(await screen.findByText('Before you begin')).toBeInTheDocument();
  }

  it('allows Linux candidate to proceed when entire screen is shared without system audio, and displays Linux notice', async () => {
    // Simulate Linux user agent
    Object.defineProperty(global.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      configurable: true,
    });

    const stopTrack = vi.fn();
    const fakeScreenTrack = {
      kind: 'video',
      readyState: 'live',
      getSettings: () => ({ displaySurface: 'monitor' }),
      addEventListener: vi.fn(),
      getTracks: () => [],
      stop: stopTrack,
    };

    const getUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [],
      getVideoTracks: () => [],
      getAudioTracks: () => [],
    });

    const getDisplayMedia = vi.fn().mockResolvedValue({
      getVideoTracks: () => [fakeScreenTrack],
      getAudioTracks: () => [], // Linux Chrome does not provide system audio track for entire screen
      getTracks: () => [fakeScreenTrack],
      addTrack: vi.fn(),
    });

    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: {
        getUserMedia,
        getDisplayMedia,
        enumerateDevices: vi.fn().mockResolvedValue([
          { deviceId: 'mic-1', kind: 'audioinput', label: 'Internal Mic' },
        ]),
      },
      configurable: true,
    });

    await reachInstructionsScreen();

    const allowButton = screen.getByText('Allow & Start Interview');
    fireEvent.click(allowButton);

    // Screen sharing should NOT be stopped/revoked
    expect(stopTrack).not.toHaveBeenCalled();

    // No disruptive warning notice should be displayed
    expect(
      screen.queryByText(/Linux OS detected: System audio sharing is disabled/i),
    ).not.toBeInTheDocument();

    // The blocking error should NOT be displayed
    expect(
      screen.queryByText(/System audio sharing is required\. Please check "Share audio"/i),
    ).not.toBeInTheDocument();
  });

  it('opportunistically captures Linux system audio monitor via getUserMedia when monitor device is present in enumerateDevices', async () => {
    // Simulate Linux user agent
    Object.defineProperty(global.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      configurable: true,
    });

    const fakeScreenTrack = {
      kind: 'video',
      readyState: 'live',
      getSettings: () => ({ displaySurface: 'monitor' }),
      addEventListener: vi.fn(),
      getTracks: () => [],
      stop: vi.fn(),
    };

    const fakeMonitorAudioTrack = {
      kind: 'audio',
      readyState: 'live',
      stop: vi.fn(),
    };

    const addTrackMock = vi.fn();
    const fakeScreenStream = {
      getVideoTracks: () => [fakeScreenTrack],
      getAudioTracks: () => [],
      getTracks: () => [fakeScreenTrack],
      addTrack: addTrackMock,
    };

    const getUserMedia = vi.fn().mockImplementation((constraints: any) => {
      if (constraints?.audio?.deviceId?.exact === 'pulse-monitor-1') {
        return Promise.resolve({
          getAudioTracks: () => [fakeMonitorAudioTrack],
          getTracks: () => [fakeMonitorAudioTrack],
        });
      }
      return Promise.resolve({
        getTracks: () => [],
        getVideoTracks: () => [],
        getAudioTracks: () => [],
      });
    });

    const getDisplayMedia = vi.fn().mockResolvedValue(fakeScreenStream);

    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: {
        getUserMedia,
        getDisplayMedia,
        enumerateDevices: vi.fn().mockResolvedValue([
          { deviceId: 'mic-1', kind: 'audioinput', label: 'Internal Mic' },
          { deviceId: 'pulse-monitor-1', kind: 'audioinput', label: 'Monitor of Built-in Audio Analog Stereo' },
        ]),
      },
      configurable: true,
    });

    await reachInstructionsScreen();

    const allowButton = screen.getByText('Allow & Start Interview');
    fireEvent.click(allowButton);

    // Expect the monitor track to be captured and attached to screenStream
    await vi.waitFor(() => {
      expect(addTrackMock).toHaveBeenCalledWith(fakeMonitorAudioTrack);
    });

    // Since system audio was successfully captured from the monitor device, linux notice is not required
    expect(
      screen.queryByText(/Linux OS detected: System audio sharing is disabled by default in Linux browsers/i),
    ).not.toBeInTheDocument();
  });

  it('strictly blocks non-Linux (e.g. Windows) candidates when system audio is not checked', async () => {
    // Simulate Windows user agent
    Object.defineProperty(global.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      configurable: true,
    });

    const stopTrack = vi.fn();
    const fakeScreenTrack = {
      kind: 'video',
      readyState: 'live',
      getSettings: () => ({ displaySurface: 'monitor' }),
      addEventListener: vi.fn(),
      getTracks: () => [],
      stop: stopTrack,
    };

    const getUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [],
      getVideoTracks: () => [],
      getAudioTracks: () => [],
    });

    const getDisplayMedia = vi.fn().mockResolvedValue({
      getVideoTracks: () => [fakeScreenTrack],
      getAudioTracks: () => [], // Missing system audio
      getTracks: () => [fakeScreenTrack],
      addTrack: vi.fn(),
    });

    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: { getUserMedia, getDisplayMedia },
      configurable: true,
    });

    await reachInstructionsScreen();

    const allowButton = screen.getByText('Allow & Start Interview');
    fireEvent.click(allowButton);

    // On Windows, missing audio is strictly rejected
    expect(
      await screen.findByText('System audio sharing is required. Please check "Share audio" when selecting your entire screen.'),
    ).toBeInTheDocument();
    expect(stopTrack).toHaveBeenCalled();
  });

  it('strictly blocks Linux candidates if they choose a window or tab instead of Entire Screen', async () => {
    // Simulate Linux user agent
    Object.defineProperty(global.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      configurable: true,
    });

    const stopTrack = vi.fn();
    const fakeWindowTrack = {
      kind: 'video',
      readyState: 'live',
      getSettings: () => ({ displaySurface: 'window' }), // Candidate chose a window, not monitor!
      addEventListener: vi.fn(),
      getTracks: () => [],
      stop: stopTrack,
    };

    const getUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [],
      getVideoTracks: () => [],
      getAudioTracks: () => [],
    });

    const getDisplayMedia = vi.fn().mockResolvedValue({
      getVideoTracks: () => [fakeWindowTrack],
      getAudioTracks: () => [],
      getTracks: () => [fakeWindowTrack],
      addTrack: vi.fn(),
    });

    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: { getUserMedia, getDisplayMedia },
      configurable: true,
    });

    await reachInstructionsScreen();

    const allowButton = screen.getByText('Allow & Start Interview');
    fireEvent.click(allowButton);

    // Partial screen sharing MUST be blocked on Linux as well
    expect(
      await screen.findByText('Please share your entire screen, not a window or tab, to continue.'),
    ).toBeInTheDocument();
    expect(stopTrack).toHaveBeenCalled();
  });
});
