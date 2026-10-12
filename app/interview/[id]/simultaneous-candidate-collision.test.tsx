// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const { mockGetUser, mockProfileSingle, mockEq, mockSelect, mockFrom, mockPush, mockSend, mockChannelOn } = vi.hoisted(() => {
  const mockProfileSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  const mockEq = vi.fn().mockReturnValue({ single: mockProfileSingle });
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
  const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });
  const mockGetUser = vi.fn().mockResolvedValue({ data: { user: null }, error: null });
  const mockPush = vi.fn();
  const mockSend = vi.fn();
  const mockChannelOn = vi.fn();
  return { mockGetUser, mockProfileSingle, mockEq, mockSelect, mockFrom, mockPush, mockSend, mockChannelOn };
});

let broadcastCallback: ((data: { payload: any }) => void) | null = null;
let subscribeCallback: ((status: string) => void) | null = null;

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
    channel: vi.fn().mockReturnValue({
      on: vi.fn((event: string, opts: any, callback: any) => {
        mockChannelOn(event, opts, callback);
        if (opts?.event === 'state-sync') {
          broadcastCallback = callback;
        }
        return {
          subscribe: vi.fn((cb?: (status: string) => void) => {
            subscribeCallback = cb || null;
            if (cb) cb('SUBSCRIBED');
            return {
              send: mockSend,
              unsubscribe: vi.fn(),
            };
          }),
          send: mockSend,
          unsubscribe: vi.fn(),
        };
      }),
      subscribe: vi.fn((cb?: (status: string) => void) => {
        subscribeCallback = cb || null;
        if (cb) cb('SUBSCRIBED');
        return {
          send: mockSend,
          unsubscribe: vi.fn(),
        };
      }),
      send: mockSend,
      unsubscribe: vi.fn(),
    }),
  }),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'interview-simultaneous' }),
  useRouter: () => ({ push: mockPush, replace: vi.fn(), back: vi.fn() }),
}));

import InterviewEntryPage from './page';

describe('Simultaneous Candidate Collision Handling (QA Test Suite)', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    broadcastCallback = null;
    subscribeCallback = null;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    sessionStorage.clear();
    localStorage.clear();
  });

  it('Door 1: Rejects second candidate arriving 1-2 ms later during passcode submission with 409 conflict', async () => {
    // Simulate that another user clicked 1-2 ms earlier, so server returned 409 CONCURRENT_SESSION_DETECTED
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/interview/verify') && init?.method === 'POST') {
        return Promise.resolve({
          status: 409,
          ok: false,
          json: () => Promise.resolve({
            error: 'An active interview session is already in progress on another device. Simultaneous access to the same interview link is prohibited.',
            concurrent: true,
            code: 'CONCURRENT_SESSION_DETECTED',
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });

    render(<InterviewEntryPage />);

    // Enter 6 digit passcode
    const codeInput = screen.getByPlaceholderText('000000');
    fireEvent.change(codeInput, { target: { value: '123456' } });

    const submitBtn = screen.getByRole('button', { name: /continue/i });
    fireEvent.click(submitBtn);

    // Verify error banner is shown to user 2
    expect(await screen.findByText(/An active interview session is already in progress on another device/i)).toBeInTheDocument();
    // User 2 remains blocked on passcode screen
    expect(screen.getByPlaceholderText('000000')).toBeInTheDocument();
  });

  it('Door 2: Legitimate candidate 1 (earlier enteredAt) rejects candidate 2 (later enteredAt) and remains in the interview', async () => {
    sessionStorage.setItem('interview_device_id', 'device-user-1');

    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/interview/verify') && init?.method === 'POST') {
        return Promise.resolve({
          status: 200,
          ok: true,
          json: () => Promise.resolve({
            verified: true,
            isAdmin: false,
            interviewId: 'interview-simultaneous',
          }),
        });
      }
      if (url.includes('/questions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            questions: [
              { id: 'q-1', question_text: 'Explain React state', category: 'frontend', question_order: 1, time_limit_sec: 120 },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const mockTrack = {
      stop: vi.fn(),
      kind: 'video',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getSettings: () => ({ displaySurface: 'monitor', deviceId: 'default' }),
      enabled: true,
      readyState: 'live',
    };
    const mockStream = {
      getTracks: () => [mockTrack],
      getVideoTracks: () => [mockTrack],
      getAudioTracks: () => [mockTrack],
    };
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream),
        getDisplayMedia: vi.fn().mockResolvedValue(mockStream),
      },
      configurable: true,
    });

    render(<InterviewEntryPage />);

    // Passcode entry
    const codeInput = screen.getByPlaceholderText('000000');
    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    // Permissions gate
    expect(await screen.findByText('Before you begin')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /allow & start interview/i }));

    // Ready screen
    expect(await screen.findByText("You're verified")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /join interview/i }));

    // Now User 1 reaches the interview stage
    expect(await screen.findByText('Explain React state')).toBeInTheDocument();

    // Now Candidate 2 joins 20ms later and broadcasts candidate-presence
    act(() => {
      broadcastCallback?.({
        payload: {
          type: 'candidate-presence',
          senderRole: 'candidate',
          deviceId: 'device-user-2',
          enteredAt: Date.now() + 5000, // Arrived later than user 1
        },
      });
    });

    // Candidate 1 must send candidate-presence-reject targeting Candidate 2
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
      type: 'broadcast',
      event: 'state-sync',
      payload: expect.objectContaining({
        type: 'candidate-presence-reject',
        rejectDeviceId: 'device-user-2',
        activeDeviceId: 'device-user-1',
      }),
    }));

    // Candidate 1 must STILL be in the interview room, NOT terminated!
    expect(screen.getByText('Explain React state')).toBeInTheDocument();
    expect(screen.queryByText(/Session Terminated/i)).not.toBeInTheDocument();
  });

  it('Door 2: Candidate 2 receiving candidate-presence-reject terminates immediately with duplicate device warning', async () => {
    sessionStorage.setItem('interview_device_id', 'device-user-2');

    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/interview/verify') && init?.method === 'POST') {
        return Promise.resolve({
          status: 200,
          ok: true,
          json: () => Promise.resolve({
            verified: true,
            isAdmin: false,
            interviewId: 'interview-simultaneous',
          }),
        });
      }
      if (url.includes('/questions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            questions: [
              { id: 'q-1', question_text: 'Explain React state', category: 'frontend', question_order: 1, time_limit_sec: 120 },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const mockTrack = {
      stop: vi.fn(),
      kind: 'video',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getSettings: () => ({ displaySurface: 'monitor', deviceId: 'default' }),
      enabled: true,
      readyState: 'live',
    };
    const mockStream = {
      getTracks: () => [mockTrack],
      getVideoTracks: () => [mockTrack],
      getAudioTracks: () => [mockTrack],
    };
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream),
        getDisplayMedia: vi.fn().mockResolvedValue(mockStream),
      },
      configurable: true,
    });

    render(<InterviewEntryPage />);

    const codeInput = screen.getByPlaceholderText('000000');
    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByText('Before you begin')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /allow & start interview/i }));

    expect(await screen.findByText("You're verified")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /join interview/i }));

    expect(await screen.findByText('Explain React state')).toBeInTheDocument();

    // User 2 receives candidate-presence-reject targeting device-user-2
    act(() => {
      broadcastCallback?.({
        payload: {
          type: 'candidate-presence-reject',
          senderRole: 'candidate',
          rejectDeviceId: 'device-user-2',
          activeDeviceId: 'device-user-1',
        },
      });
    });

    // User 2 must terminate immediately!
    expect(await screen.findByText('Interview terminated')).toBeInTheDocument();
    expect(screen.getByText(/An active interview session is already in progress on another device/i)).toBeInTheDocument();
  });
});
