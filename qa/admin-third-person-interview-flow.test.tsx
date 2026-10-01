// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const mockBroadcastCallbacks: Array<(msg: { payload: any }) => void> = [];
const mockSend = vi.fn().mockImplementation((msg) => {
  if (msg?.type === 'broadcast') {
    mockBroadcastCallbacks.forEach((cb) => cb(msg));
  }
  return Promise.resolve();
});

const mockChannel: any = {
  send: mockSend,
  unsubscribe: vi.fn(),
};
mockChannel.on = vi.fn().mockImplementation((_event: any, _opts: any, callback: any) => {
  mockBroadcastCallbacks.push(callback);
  return mockChannel;
});
mockChannel.subscribe = vi.fn().mockImplementation(() => mockChannel);


vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    channel: vi.fn(() => mockChannel),
  }),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'test-interview-id' }),
}));

function liveTrack(overrides: Partial<MediaStreamTrack> = {}) {
  return {
    kind: 'video',
    enabled: true,
    readyState: 'live',
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getSettings: () => ({ displaySurface: 'monitor' }),
    ...overrides,
  } as unknown as MediaStreamTrack;
}

function fakeStream(tracks: MediaStreamTrack[]) {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((track) => track.kind !== 'audio'),
    getAudioTracks: () => tracks.filter((track) => track.kind === 'audio'),
  } as unknown as MediaStream;
}

const mockRemoteStream = fakeStream([liveTrack(), liveTrack({ kind: 'audio' })]);

vi.mock('@/lib/ai-interview/use-webrtc', () => ({
  useWebRTC: vi.fn().mockImplementation((_interviewId, _stream, _role, isActive) => ({
    remoteStream: isActive ? mockRemoteStream : null,
  })),
}));

import InterviewEntryPage from '../app/interview/[id]/page';

describe('Admin Third-Person Joining & Live Proctoring Flow', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockBroadcastCallbacks.length = 0;
    vi.clearAllMocks();

    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue(
          fakeStream([liveTrack(), liveTrack({ kind: 'audio' })])
        ),
        getDisplayMedia: vi.fn().mockResolvedValue(
          fakeStream([liveTrack(), liveTrack({ kind: 'audio' })])
        ),
      },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
  });

  it('allows admin to join in-progress interview, see candidate stream and hear remote audio', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/verify')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ verified: true, isAdmin: true, interviewId: 'test-interview-id' }),
        });
      }
      if (typeof url === 'string' && url.includes('/questions')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              questions: [{ id: 'q1', question_text: 'Describe your React experience.', category: 'technical', time_limit_sec: 120 }],
              session: { duration_minutes: 20 },
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<InterviewEntryPage />);

    // Admin enters email
    const emailInput = screen.getByPlaceholderText('Enter your email');
    fireEvent.change(emailInput, { target: { value: 'admin@creole.com' } });

    const continueBtn = screen.getByText('Continue');
    fireEvent.click(continueBtn);

    // Admin bypasses candidate instructions/permissions and directly enters interview room
    expect(await screen.findByText('Candidate')).toBeInTheDocument();
    expect(screen.getByText('You (Admin)')).toBeInTheDocument();
    expect(screen.getByText('Live Proctoring & User Events')).toBeInTheDocument();
  });

  it('displays candidate live spoken voice to admin in real-time', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/verify')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ verified: true, isAdmin: true, interviewId: 'test-interview-id' }),
        });
      }
      if (typeof url === 'string' && url.includes('/questions')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              questions: [{ id: 'q1', question_text: 'Describe your React experience.', category: 'technical', time_limit_sec: 120 }],
              session: { duration_minutes: 20 },
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<InterviewEntryPage />);
    fireEvent.change(screen.getByPlaceholderText('Enter your email'), { target: { value: 'admin@creole.com' } });
    fireEvent.click(screen.getByText('Continue'));

    await screen.findByText('Candidate');

    // Simulate candidate speaking broadcast
    act(() => {
      mockBroadcastCallbacks.forEach((cb) =>
        cb({
          payload: {
            type: 'candidate-speech',
            text: 'I have 5 years of full stack development experience',
            isSpeaking: true,
          },
        })
      );
    });

    expect(await screen.findByText('Live Candidate Voice:')).toBeInTheDocument();
    expect(screen.getByText('I have 5 years of full stack development experience')).toBeInTheDocument();
  });

  it('streams candidate proctoring events live to admin activity feed', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/verify')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ verified: true, isAdmin: true, interviewId: 'test-interview-id' }),
        });
      }
      if (typeof url === 'string' && url.includes('/questions')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              questions: [{ id: 'q1', question_text: 'Describe your React experience.', category: 'technical', time_limit_sec: 120 }],
              session: { duration_minutes: 20 },
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<InterviewEntryPage />);
    fireEvent.change(screen.getByPlaceholderText('Enter your email'), { target: { value: 'admin@creole.com' } });
    fireEvent.click(screen.getByText('Continue'));

    await screen.findByText('Live Proctoring & User Events');

    // Simulate proctoring violations from candidate
    act(() => {
      mockBroadcastCallbacks.forEach((cb) =>
        cb({
          payload: {
            type: 'proctoring-event',
            category: 'unauthorized_voice',
            meta: { reason: 'Background voice detected' },
            ts: Date.now(),
          },
        })
      );
    });

    expect(await screen.findByText('unauthorized voice')).toBeInTheDocument();
    expect(screen.getByText('Background voice detected')).toBeInTheDocument();
    expect(screen.getByText('1 recorded')).toBeInTheDocument();
  });

  it('notifies admin with warning banner and auto-closes screen on interview termination', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/verify')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ verified: true, isAdmin: true, interviewId: 'test-interview-id' }),
        });
      }
      if (typeof url === 'string' && url.includes('/questions')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              questions: [{ id: 'q1', question_text: 'Describe your React experience.', category: 'technical', time_limit_sec: 120 }],
              session: { duration_minutes: 20 },
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<InterviewEntryPage />);
    fireEvent.change(screen.getByPlaceholderText('Enter your email'), { target: { value: 'admin@creole.com' } });
    fireEvent.click(screen.getByText('Continue'));

    expect(await screen.findByText('Candidate')).toBeInTheDocument();

    vi.useFakeTimers();

    // Simulate interview termination broadcast
    act(() => {
      mockBroadcastCallbacks.forEach((cb) =>
        cb({
          payload: {
            type: 'terminate',
            reason: 'Excessive proctoring violations',
          },
        })
      );
    });

    // Warning alert banner shown to admin
    expect(screen.getByText('Interview Terminated: Excessive proctoring violations')).toBeInTheDocument();
    expect(screen.getByText('Closing interview screen automatically...')).toBeInTheDocument();

    // Fast forward countdown timer to auto-close screen
    act(() => {
      vi.advanceTimersByTime(2600);
    });

    expect(screen.getByText('Interview terminated')).toBeInTheDocument();
    expect(screen.getByText('Excessive proctoring violations')).toBeInTheDocument();

    vi.useRealTimers();
  });

  it('notifies admin with banner and auto-closes screen on interview completion', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/verify')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ verified: true, isAdmin: true, interviewId: 'test-interview-id' }),
        });
      }
      if (typeof url === 'string' && url.includes('/questions')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              questions: [{ id: 'q1', question_text: 'Describe your React experience.', category: 'technical', time_limit_sec: 120 }],
              session: { duration_minutes: 20 },
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<InterviewEntryPage />);
    fireEvent.change(screen.getByPlaceholderText('Enter your email'), { target: { value: 'admin@creole.com' } });
    fireEvent.click(screen.getByText('Continue'));

    expect(await screen.findByText('Candidate')).toBeInTheDocument();

    vi.useFakeTimers();

    // Simulate interview completion broadcast
    act(() => {
      mockBroadcastCallbacks.forEach((cb) =>
        cb({
          payload: {
            type: 'completed',
          },
        })
      );
    });

    expect(screen.getByText('Interview Completed: The candidate has submitted all answers.')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2600);
    });

    expect(screen.getByText(/interview complete/i)).toBeInTheDocument();

    vi.useRealTimers();
  });

  it('prevents second-time access to terminated or completed interview link', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('/verify')) {
        return Promise.resolve({
          status: 410,
          ok: false,
          json: () => Promise.resolve({ error: 'This interview was terminated due to violations', status: 'terminated' }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    render(<InterviewEntryPage />);

    // Candidate attempts to enter passcode on terminated interview
    const codeInput = screen.getByPlaceholderText('000000');
    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByText('Continue'));

    // Automatically redirected to ended screen
    expect(await screen.findByText('Interview terminated')).toBeInTheDocument();
    expect(screen.getByText('This interview was terminated due to violations')).toBeInTheDocument();
  });
});
