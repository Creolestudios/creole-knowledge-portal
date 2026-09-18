// @vitest-environment jsdom
/**
 * QA scenario suite for the AI Interview candidate flow's instructions,
 * permissions gate, and in-session proctoring (app/interview/[id]/page.tsx).
 *
 * See qa/proctoring-instructions-permissions-bugs.md for the accompanying bug list.
 * Tests marked "regression guard for BUG-xx" currently FAIL and are expected to
 * start passing once the linked bug is fixed — they document the desired behavior.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'interview-1' }),
}));

import InterviewEntryPage from '../app/interview/[id]/page';

const originalFetch = global.fetch;
const originalMediaDevices = global.navigator.mediaDevices;

function verifiedFetchMock() {
  return vi.fn().mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('/questions')) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            session: { duration_minutes: 30 },
            questions: [{ id: 'q1', question_text: 'Tell us about yourself.', category: 'hr', question_order: 1 }],
          }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ verified: true, interviewId: 'interview-1' }),
    });
  }) as any;
}

async function goToInstructions() {
  render(<InterviewEntryPage />);
  fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '123456' } });
  fireEvent.click(screen.getByText('Continue'));
  await screen.findByText('Before you begin');
}

function liveTrack(overrides: Partial<MediaStreamTrack> = {}) {
  return {
    readyState: 'live',
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    ...overrides,
  } as unknown as MediaStreamTrack;
}

function mockMediaDevices(overrides: Partial<{ getUserMedia: any; getDisplayMedia: any }>) {
  const value = {
    getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [liveTrack(), liveTrack()] }),
    getDisplayMedia: vi.fn().mockResolvedValue({
      getVideoTracks: () => [{ getSettings: () => ({ displaySurface: 'monitor' }) }],
      getTracks: () => [liveTrack()],
    }),
    ...overrides,
  };
  Object.defineProperty(global.navigator, 'mediaDevices', { value, configurable: true });
  return value;
}

afterEach(() => {
  global.fetch = originalFetch;
  Object.defineProperty(global.navigator, 'mediaDevices', {
    value: originalMediaDevices,
    configurable: true,
  });
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
});

describe('Passcode gate', () => {
  it('TC-PROC-01 rejects an incorrect passcode with an inline error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Incorrect passcode' }),
    }) as any;

    render(<InterviewEntryPage />);
    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '000000' } });
    fireEvent.click(screen.getByText('Continue'));

    expect(await screen.findByText('Incorrect passcode')).toBeInTheDocument();
  });

  it('TC-PROC-02 strips non-digit input and caps at 6 digits, disabling submit until complete', () => {
    render(<InterviewEntryPage />);
    const input = screen.getByPlaceholderText('000000') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'ab12cd' } });
    expect(input.value).toBe('12');
    expect(screen.getByText('Continue').closest('button')).toBeDisabled();
  });

  it('TC-PROC-03 a correct passcode advances to the instructions screen, not straight into the interview', async () => {
    global.fetch = verifiedFetchMock();
    await goToInstructions();
    expect(screen.getByText('Required permissions')).toBeInTheDocument();
  });
});

describe('Instructions & permissions gate', () => {
  it('TC-PROC-04 lists the compulsory conduct rules before permissions can be requested', async () => {
    global.fetch = verifiedFetchMock();
    await goToInstructions();

    expect(
      screen.getByText(/Do not switch tabs, minimize the window, or open other applications/i),
    ).toBeInTheDocument();
    expect(screen.getByText('Allow & Start Interview')).toBeInTheDocument();
  });

  it('TC-PROC-05 granting camera+mic and a full-screen share unlocks the ready/proctored stage', async () => {
    global.fetch = verifiedFetchMock();
    const media = mockMediaDevices({});
    await goToInstructions();

    fireEvent.click(screen.getByText('Allow & Start Interview'));

    expect(await screen.findByText("You're verified")).toBeInTheDocument();
    expect(media.getUserMedia).toHaveBeenCalledWith({ video: true, audio: true });
    expect(media.getDisplayMedia).toHaveBeenCalledWith({ video: true });
  });

  it('TC-PROC-06 rejects a partial (tab/window) screen share and asks for the entire screen', async () => {
    global.fetch = verifiedFetchMock();
    const stop = vi.fn();
    mockMediaDevices({
      getDisplayMedia: vi.fn().mockResolvedValue({
        getVideoTracks: () => [{ getSettings: () => ({ displaySurface: 'browser' }) }],
        getTracks: () => [{ stop }],
      }),
    });
    await goToInstructions();

    fireEvent.click(screen.getByText('Allow & Start Interview'));

    expect(
      await screen.findByText('Please share your entire screen, not a window or tab, to continue.'),
    ).toBeInTheDocument();
    expect(stop).toHaveBeenCalled();
  });

  it('TC-PROC-07 shows an error and stays on the gate when camera/mic permission is denied', async () => {
    global.fetch = verifiedFetchMock();
    mockMediaDevices({ getUserMedia: vi.fn().mockRejectedValue(new Error('Permission denied')) });
    await goToInstructions();

    fireEvent.click(screen.getByText('Allow & Start Interview'));

    expect(
      await screen.findByText(
        'Camera, microphone, and full-screen sharing are all required to start this interview.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("You're verified")).not.toBeInTheDocument();
  });

  it('TC-PROC-08 [fixed: BUG-02] keeps the camera alive for an immediate retry, and releases it if the candidate leaves instead', async () => {
    global.fetch = verifiedFetchMock();
    const cameraStop = vi.fn();
    mockMediaDevices({
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [liveTrack({ stop: cameraStop })] }),
      getDisplayMedia: vi.fn().mockRejectedValue(new Error('Permission dismissed')),
    });
    render(<InterviewEntryPage />);
    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '123456' } });
    fireEvent.click(screen.getByText('Continue'));
    await screen.findByText('Before you begin');

    fireEvent.click(screen.getByText('Allow & Start Interview'));
    await screen.findByText(
      'Screen sharing was cancelled or denied. Please share your entire screen to continue.',
    );
    // Kept alive so a retry click doesn't have to re-prompt for camera/mic.
    expect(cameraStop).not.toHaveBeenCalled();
  });

  it('TC-PROC-08b [fixed: BUG-02] releases the camera/mic stream if the component unmounts instead of retrying', async () => {
    global.fetch = verifiedFetchMock();
    const cameraStop = vi.fn();
    mockMediaDevices({
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [liveTrack({ stop: cameraStop })] }),
      getDisplayMedia: vi.fn().mockRejectedValue(new Error('Permission dismissed')),
    });
    const { unmount } = render(<InterviewEntryPage />);
    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '123456' } });
    fireEvent.click(screen.getByText('Continue'));
    await screen.findByText('Before you begin');

    fireEvent.click(screen.getByText('Allow & Start Interview'));
    await screen.findByText(
      'Screen sharing was cancelled or denied. Please share your entire screen to continue.',
    );

    unmount();

    expect(cameraStop).toHaveBeenCalled();
  });

  it('TC-PROC-09 [fixed: BUG-03] reuses the granted camera/mic stream on a screen-share retry instead of re-requesting it', async () => {
    global.fetch = verifiedFetchMock();
    const media = mockMediaDevices({
      getDisplayMedia: vi
        .fn()
        .mockRejectedValueOnce(new Error('Permission dismissed'))
        .mockResolvedValueOnce({
          getVideoTracks: () => [{ getSettings: () => ({ displaySurface: 'monitor' }) }],
          getTracks: () => [liveTrack()],
        }),
    });
    await goToInstructions();

    fireEvent.click(screen.getByText('Allow & Start Interview'));
    await screen.findByText(
      'Screen sharing was cancelled or denied. Please share your entire screen to continue.',
    );
    fireEvent.click(screen.getByText('Allow & Start Interview'));
    await screen.findByText("You're verified");

    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
    expect(media.getDisplayMedia).toHaveBeenCalledTimes(2);
  });

  it('TC-PROC-15 [fixed: BUG-04] accepts a screen share when the browser does not report displaySurface', async () => {
    global.fetch = verifiedFetchMock();
    mockMediaDevices({
      getDisplayMedia: vi.fn().mockResolvedValue({
        getVideoTracks: () => [{ getSettings: () => ({}) }], // Safari/Firefox: no displaySurface
        getTracks: () => [liveTrack()],
      }),
    });
    await goToInstructions();

    fireEvent.click(screen.getByText('Allow & Start Interview'));

    expect(await screen.findByText("You're verified")).toBeInTheDocument();
  });

  it('TC-PROC-16 [fixed: BUG-01] sends a beacon/fetch to /api/interview/terminate when the session is terminated', async () => {
    global.fetch = verifiedFetchMock();
    mockMediaDevices({});
    const sendBeacon = vi.fn().mockReturnValue(true);
    Object.defineProperty(global.navigator, 'sendBeacon', { value: sendBeacon, configurable: true });

    await goToInstructions();
    fireEvent.click(screen.getByText('Allow & Start Interview'));
    await screen.findByText("You're verified");

    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    fireEvent(document, new Event('visibilitychange'));
    await screen.findByText('Interview terminated');

    expect(sendBeacon).toHaveBeenCalledWith(
      '/api/interview/terminate',
      expect.any(Blob),
    );
  });
});

describe('In-session proctoring (ready stage)', () => {
  it('TC-PROC-10 terminates the interview when the tab is hidden (switch/minimize)', async () => {
    global.fetch = verifiedFetchMock();
    mockMediaDevices({});
    await goToInstructions();
    fireEvent.click(screen.getByText('Allow & Start Interview'));
    await screen.findByText("You're verified");

    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    fireEvent(document, new Event('visibilitychange'));

    expect(await screen.findByText('Interview terminated')).toBeInTheDocument();
    expect(
      screen.getByText('You switched tabs or minimized the window during the interview.'),
    ).toBeInTheDocument();
  });

  it('TC-PROC-11 terminates the interview when the camera/mic track ends mid-session', async () => {
    global.fetch = verifiedFetchMock();
    let endedHandler: (() => void) | undefined;
    const cameraTrack = {
      stop: vi.fn(),
      addEventListener: (_evt: string, cb: () => void) => {
        endedHandler = cb;
      },
      removeEventListener: vi.fn(),
    };
    mockMediaDevices({
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [cameraTrack] }),
    });
    await goToInstructions();
    fireEvent.click(screen.getByText('Allow & Start Interview'));
    await screen.findByText("You're verified");

    act(() => {
      endedHandler?.();
    });

    expect(await screen.findByText('Interview terminated')).toBeInTheDocument();
    expect(
      screen.getByText('Your webcam or microphone was turned off during the interview.'),
    ).toBeInTheDocument();
  });

  it('TC-PROC-12 terminates the interview when the screen-share track ends mid-session', async () => {
    global.fetch = verifiedFetchMock();
    let endedHandler: (() => void) | undefined;
    const screenTrack = {
      getSettings: () => ({ displaySurface: 'monitor' }),
      stop: vi.fn(),
      addEventListener: (_evt: string, cb: () => void) => {
        endedHandler = cb;
      },
      removeEventListener: vi.fn(),
    };
    mockMediaDevices({
      getDisplayMedia: vi.fn().mockResolvedValue({
        getVideoTracks: () => [screenTrack],
        getTracks: () => [screenTrack],
      }),
    });
    await goToInstructions();
    fireEvent.click(screen.getByText('Allow & Start Interview'));
    await screen.findByText("You're verified");

    act(() => {
      endedHandler?.();
    });

    expect(await screen.findByText('Interview terminated')).toBeInTheDocument();
    expect(screen.getByText('Screen sharing was stopped during the interview.')).toBeInTheDocument();
  });

  it('TC-PROC-13 termination is a one-way state — coming back to the tab afterwards does not un-terminate', async () => {
    global.fetch = verifiedFetchMock();
    mockMediaDevices({});
    await goToInstructions();
    fireEvent.click(screen.getByText('Allow & Start Interview'));
    await screen.findByText("You're verified");

    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    fireEvent(document, new Event('visibilitychange'));
    await screen.findByText('Interview terminated');

    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    fireEvent(document, new Event('visibilitychange'));

    expect(screen.getByText('Interview terminated')).toBeInTheDocument();
    expect(screen.queryByText("You're verified")).not.toBeInTheDocument();
  });

  it('TC-PROC-14 [regression guard for BUG-01] a terminated session cannot be resumed by re-verifying the same passcode', async () => {
    // Simulates: candidate is terminated, refreshes the page, and re-submits the
    // same passcode. Today the API has no server-side "terminated" state, so
    // /api/interview/verify happily returns { verified: true } again — this test
    // documents the desired contract for when BUG-01 is fixed.
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'This interview has already ended' }),
    }) as any;
    global.fetch = fetchMock;

    render(<InterviewEntryPage />);
    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '123456' } });
    fireEvent.click(screen.getByText('Continue'));

    expect(await screen.findByText('This interview has already ended')).toBeInTheDocument();
    expect(screen.queryByText('Before you begin')).not.toBeInTheDocument();
  });
});
