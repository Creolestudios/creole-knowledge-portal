// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import CandidateAssessmentPage from './page';

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: 'raw-token-linux' }),
}));

function makeTrack() {
  return {
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    readyState: 'live',
    enabled: true,
    getSettings: () => ({ deviceId: 'default' }),
  };
}

function makeCameraStream() {
  const track = makeTrack();
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
}

describe('CandidateAssessmentPage - Linux Screen & System Audio Adaptive Support', () => {
  const originalUserAgent = global.navigator.userAgent;
  const originalMediaDevices = global.navigator.mediaDevices;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.defineProperty(global.navigator, 'userAgent', {
      value: originalUserAgent,
      configurable: true,
    });
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: originalMediaDevices,
      configurable: true,
    });
  });

  async function reachInstructions() {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        candidate_name: 'Linux Candidate',
        questions: [{ id: 'q1', question_text: 'Tell me about yourself', category: 'hr' }],
      }),
    });

    render(<CandidateAssessmentPage />);
    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByText('Before you begin')).toBeInTheDocument());
  }

  it('allows Linux candidate to grant screen share without system audio track and shows adaptive notice', async () => {
    // Simulate Linux browser
    Object.defineProperty(global.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0',
      configurable: true,
    });

    const stopTrack = vi.fn();
    const fullTrack = {
      ...makeTrack(),
      getSettings: () => ({ displaySurface: 'monitor' }),
      stop: stopTrack,
    };

    const screenStream = {
      getTracks: () => [fullTrack],
      getVideoTracks: () => [fullTrack],
      getAudioTracks: () => [], // Linux Chrome entire screen has no audio track
      addTrack: vi.fn(),
    } as unknown as MediaStream;

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue(makeCameraStream()),
        getDisplayMedia: vi.fn().mockResolvedValue(screenStream),
        enumerateDevices: vi.fn().mockResolvedValue([
          { deviceId: 'mic-1', kind: 'audioinput', label: 'Internal Mic' },
        ]),
      },
      configurable: true,
    });

    await reachInstructions();

    fireEvent.click(screen.getByText('Allow Camera, Mic & Screen Share'));

    // Should not stop the track on Linux
    expect(stopTrack).not.toHaveBeenCalled();

    // No disruptive warning notice should be displayed
    expect(
      screen.queryByText(/Linux OS detected: System audio sharing is disabled/i),
    ).not.toBeInTheDocument();

    // Should NOT show the blocking error
    expect(
      screen.queryByText(/System audio sharing is required\. Please check "Share audio"/i),
    ).not.toBeInTheDocument();
  });

  it('opportunistically captures system audio monitor via getUserMedia when monitor device is available on Linux', async () => {
    // Simulate Linux browser
    Object.defineProperty(global.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0',
      configurable: true,
    });

    const fullTrack = {
      ...makeTrack(),
      getSettings: () => ({ displaySurface: 'monitor' }),
      stop: vi.fn(),
    };

    const fakeMonitorAudioTrack = {
      kind: 'audio',
      readyState: 'live',
      stop: vi.fn(),
    };

    const addTrackMock = vi.fn();
    const screenStream = {
      getTracks: () => [fullTrack],
      getVideoTracks: () => [fullTrack],
      getAudioTracks: () => [],
      addTrack: addTrackMock,
    } as unknown as MediaStream;

    const getUserMedia = vi.fn().mockImplementation((constraints: any) => {
      if (constraints?.audio?.deviceId?.exact === 'pulse-monitor-1') {
        return Promise.resolve({
          getAudioTracks: () => [fakeMonitorAudioTrack],
          getTracks: () => [fakeMonitorAudioTrack],
        });
      }
      return Promise.resolve(makeCameraStream());
    });

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia,
        getDisplayMedia: vi.fn().mockResolvedValue(screenStream),
        enumerateDevices: vi.fn().mockResolvedValue([
          { deviceId: 'mic-1', kind: 'audioinput', label: 'Internal Mic' },
          { deviceId: 'pulse-monitor-1', kind: 'audioinput', label: 'Monitor of Built-in Audio Analog Stereo' },
        ]),
      },
      configurable: true,
    });

    await reachInstructions();

    fireEvent.click(screen.getByText('Allow Camera, Mic & Screen Share'));

    // Should attach the monitor track to screenStream
    await waitFor(() => {
      expect(addTrackMock).toHaveBeenCalledWith(fakeMonitorAudioTrack);
    });

    // Notice should not be active since direct monitor stream was captured
    expect(
      screen.queryByText(/Linux OS detected: System audio sharing is disabled by default in Linux browsers/i),
    ).not.toBeInTheDocument();
  });

  it('strictly rejects non-Linux (e.g. Windows) candidate when system audio track is missing', async () => {
    // Simulate Windows browser
    Object.defineProperty(global.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0',
      configurable: true,
    });

    const stopTrack = vi.fn();
    const fullTrack = {
      ...makeTrack(),
      getSettings: () => ({ displaySurface: 'monitor' }),
      stop: stopTrack,
    };

    const screenStream = {
      getTracks: () => [fullTrack],
      getVideoTracks: () => [fullTrack],
      getAudioTracks: () => [], // Missing system audio
      addTrack: vi.fn(),
    } as unknown as MediaStream;

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue(makeCameraStream()),
        getDisplayMedia: vi.fn().mockResolvedValue(screenStream),
        enumerateDevices: vi.fn().mockResolvedValue([]),
      },
      configurable: true,
    });

    await reachInstructions();

    fireEvent.click(screen.getByText('Allow Camera, Mic & Screen Share'));

    // Blocking error MUST be displayed
    expect(
      await screen.findByText('System audio sharing is required. Please check "Share audio" when selecting your entire screen.'),
    ).toBeInTheDocument();
    expect(stopTrack).toHaveBeenCalled();
  });
});
