// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import InterviewEntryPage from './page';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'session-123' }),
  useRouter: () => ({ push: mockPush }),
}));

let mockBroadcastCallback: ((event: { payload: any }) => void) | null = null;
const mockChannel = {
  on: vi.fn((_type: string, _filter: any, cb: any) => {
    mockBroadcastCallback = cb;
    return mockChannel;
  }),
  subscribe: vi.fn((cb?: (status: string) => void) => {
    if (cb) cb('SUBSCRIBED');
    return mockChannel;
  }),
  unsubscribe: vi.fn(),
  send: vi.fn(),
};

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    channel: () => mockChannel,
  }),
}));

let mockRemoteStream: MediaStream | null = null;
vi.mock('@/lib/ai-interview/use-webrtc', () => ({
  useWebRTC: () => ({
    remoteStream: mockRemoteStream,
    leave: vi.fn(),
  }),
}));

describe('Third-Party Admin Joining & Proctoring Synchronization Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPush.mockClear();
    mockRemoteStream = null;
    mockBroadcastCallback = null;
    localStorage.clear();
    sessionStorage.clear();

    const makeTrack = () => ({
      stop: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getSettings: () => ({ deviceId: 'default' }),
      enabled: true,
      readyState: 'live',
    });
    const fakeStream = {
      getTracks: () => [makeTrack(), makeTrack()],
      getVideoTracks: () => [makeTrack()],
      getAudioTracks: () => [makeTrack()],
    };
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue(fakeStream),
        getDisplayMedia: vi.fn().mockResolvedValue(fakeStream),
      },
      configurable: true,
    });
  });

  const setupAdminInInterview = async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/verify')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ verified: true, isAdmin: true, interviewId: 'session-123', status: 'in_progress', inProgress: true }),
        });
      }
      if (typeof url === 'string' && url.includes('/questions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            session: { duration_minutes: 30 },
            questions: [
              { id: 'q1', question_text: 'Admin observation question', category: 'system_design', question_order: 1 },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any;

    render(<InterviewEntryPage />);
    fireEvent.change(screen.getByPlaceholderText('Enter your email'), {
      target: { value: 'admin@creolestudios.com' },
    });
    fireEvent.click(screen.getByText('Continue'));

    // Wait until admin enters interview stage
    await screen.findByText('Admin observation question');
  };

  it('displays real-time live warning toast on admin screen with identical reason and count when candidate triggers warning-alert', async () => {
    await setupAdminInInterview();

    expect(mockBroadcastCallback).not.toBeNull();

    // Candidate broadcasts warning 2
    act(() => {
      mockBroadcastCallback!({
        payload: {
          type: 'warning-alert',
          count: 2,
          reason: 'Unauthorized object detected: Cell phone',
          category: 'cell_phone',
          ts: Date.now(),
        },
      });
    });

    // Admin displays exact warning toast matching user screen
    expect(await screen.findByText('Warning 2 / 3')).toBeInTheDocument();
    expect(screen.getAllByText('Unauthorized object detected: Cell phone').length).toBeGreaterThanOrEqual(1);
  });

  it('synchronizes candidate completion immediately onto admin screen with Return to Dashboard button', async () => {
    await setupAdminInInterview();

    expect(mockBroadcastCallback).not.toBeNull();

    // Candidate broadcasts completed
    act(() => {
      mockBroadcastCallback!({
        payload: {
          type: 'completed',
        },
      });
    });

    // Admin transitions to completed screen
    expect(await screen.findByText('Interview complete')).toBeInTheDocument();
    expect(screen.getByText(/The candidate has completed the interview and submitted all assessment responses/i)).toBeInTheDocument();

    const returnBtn = screen.getByRole('button', { name: /return to admin dashboard/i });
    expect(returnBtn).toBeInTheDocument();

    fireEvent.click(returnBtn);
    expect(mockPush).toHaveBeenCalledWith('/admin/dashboard');
  });

  it('synchronizes candidate termination immediately onto admin screen with identical termination reason and Return to Dashboard button', async () => {
    await setupAdminInInterview();

    expect(mockBroadcastCallback).not.toBeNull();

    // Candidate broadcasts terminate
    act(() => {
      mockBroadcastCallback!({
        payload: {
          type: 'terminate',
          reason: 'Three proctoring warnings issued. Session auto-terminated.',
        },
      });
    });

    // Admin transitions to terminated screen
    expect(await screen.findByText('Interview terminated')).toBeInTheDocument();
    expect(screen.getByText('Three proctoring warnings issued. Session auto-terminated.')).toBeInTheDocument();

    const returnBtn = screen.getByRole('button', { name: /return to admin dashboard/i });
    expect(returnBtn).toBeInTheDocument();

    fireEvent.click(returnBtn);
    expect(mockPush).toHaveBeenCalledWith('/admin/dashboard');
  });

  it('arranges admin video above candidate video without overlapping PiP when remoteStream is connected', async () => {
    const makeFakeTrack = () => ({
      stop: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      enabled: true,
      readyState: 'live',
    });
    mockRemoteStream = {
      getTracks: () => [makeFakeTrack()],
      getVideoTracks: () => [makeFakeTrack()],
      getAudioTracks: () => [makeFakeTrack()],
    } as any;

    await setupAdminInInterview();

    // Check that both admin video tile and candidate video tile are rendered
    expect(screen.getByLabelText(/you \(admin\) camera preview/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/candidate camera preview/i)).toBeInTheDocument();

    // Verify there is no absolute overlapping PiP wrapper (e.g. absolute bottom-4 right-4 w-1/3)
    const adminTile = screen.getByLabelText(/you \(admin\) camera preview/i);
    expect(adminTile.parentElement?.className).not.toContain('absolute bottom-4 right-4');
  });

  it('provides an Exit button in MeetingControlBar and a Leave button in the header allowing admin to exit', async () => {
    await setupAdminInInterview();

    // Header leave button
    const headerLeaveBtn = screen.getByRole('button', { name: /^leave$/i });
    expect(headerLeaveBtn).toBeInTheDocument();

    // Meeting control bar exit button
    const controlExitBtn = screen.getByRole('button', { name: /^exit$/i });
    expect(controlExitBtn).toBeInTheDocument();

    fireEvent.click(controlExitBtn);
    expect(mockPush).toHaveBeenCalledWith('/admin/dashboard');
  });

  it('vanishes admin video window from candidate screen when admin leaves the meeting', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/verify')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ verified: true, isAdmin: false, interviewId: 'session-123' }),
        });
      }
      if (typeof url === 'string' && url.includes('/questions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            session: { duration_minutes: 30 },
            questions: [
              { id: 'q1', question_text: 'Candidate live question', category: 'algorithms', question_order: 1 },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any;

    const makeFakeTrack = () => ({
      stop: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getSettings: () => ({ deviceId: 'default' }),
      enabled: true,
      readyState: 'live',
    });
    mockRemoteStream = {
      getTracks: () => [makeFakeTrack()],
      getVideoTracks: () => [makeFakeTrack()],
      getAudioTracks: () => [makeFakeTrack()],
    } as any;

    render(<InterviewEntryPage />);
    const codeInput = screen.getByPlaceholderText('000000');
    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByText('Before you begin')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /allow & start interview/i }));

    expect(await screen.findByText("You're verified")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /join interview/i }));

    expect(await screen.findByText('Candidate live question')).toBeInTheDocument();

    // Admin joins
    act(() => {
      mockBroadcastCallback?.({
        payload: { type: 'admin-joined', senderRole: 'admin' },
      });
    });

    // Dual video tile is visible: Interviewer tile exists
    expect(screen.getByLabelText(/interviewer camera preview/i)).toBeInTheDocument();

    // Admin leaves the meeting
    act(() => {
      mockBroadcastCallback?.({
        payload: { type: 'admin-left', senderRole: 'admin' },
      });
    });

    // Admin video window MUST vanish from candidate screen!
    expect(screen.queryByLabelText(/interviewer camera preview/i)).not.toBeInTheDocument();
    // Only candidate's own preview remains
    expect(screen.getByLabelText(/you camera preview/i)).toBeInTheDocument();
  });

  it('shows Interview Not Started Yet page when admin joins before interview is started (pending or inProgress: false)', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/verify')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            verified: true,
            isAdmin: true,
            interviewId: 'session-123',
            status: 'pending',
            inProgress: false,
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any;

    render(<InterviewEntryPage />);
    fireEvent.change(screen.getByPlaceholderText('Enter your email'), {
      target: { value: 'admin@creolestudios.com' },
    });
    fireEvent.click(screen.getByText('Continue'));

    // Admin should see "Interview Not Started Yet" page
    expect(await screen.findByText('Interview Not Started Yet')).toBeInTheDocument();
    expect(screen.getByText(/Waiting for Candidate/i)).toBeInTheDocument();
    expect(screen.getByText(/The candidate has not accessed the link or started the interview yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Check Status \/ Refresh/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Return to Admin Dashboard/i })).toBeInTheDocument();
  });

  it('allows admin on Not Started page to return to admin dashboard', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/verify')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            verified: true,
            isAdmin: true,
            interviewId: 'session-123',
            status: 'pending',
            inProgress: false,
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any;

    render(<InterviewEntryPage />);
    fireEvent.change(screen.getByPlaceholderText('Enter your email'), {
      target: { value: 'admin@creolestudios.com' },
    });
    fireEvent.click(screen.getByText('Continue'));

    const returnBtn = await screen.findByRole('button', { name: /Return to Admin Dashboard/i });
    fireEvent.click(returnBtn);

    expect(mockPush).toHaveBeenCalledWith('/admin/dashboard');
  });

  it('automatically connects admin to live interview when candidate broadcast is received', async () => {
    let currentStatus = 'pending';
    let currentInProgress = false;

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/verify')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            verified: true,
            isAdmin: true,
            interviewId: 'session-123',
            status: currentStatus,
            inProgress: currentInProgress,
          }),
        });
      }
      if (typeof url === 'string' && url.includes('/questions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            session: { duration_minutes: 30 },
            questions: [
              { id: 'q1', question_text: 'Admin observation question', category: 'system_design', question_order: 1 },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any;

    render(<InterviewEntryPage />);
    fireEvent.change(screen.getByPlaceholderText('Enter your email'), {
      target: { value: 'admin@creolestudios.com' },
    });
    fireEvent.click(screen.getByText('Continue'));

    expect(await screen.findByText('Interview Not Started Yet')).toBeInTheDocument();

    // Now candidate joins/starts and sends broadcast event
    currentStatus = 'in_progress';
    currentInProgress = true;

    await act(async () => {
      mockBroadcastCallback?.({
        payload: {
          type: 'candidate-presence',
          senderRole: 'candidate',
          deviceId: 'cand_123',
          enteredAt: Date.now(),
        },
      });
    });

    // Admin should automatically transition to the live interview
    expect(await screen.findByText('Admin observation question')).toBeInTheDocument();
  });

  it('transitions admin to live interview when clicking Check Status / Refresh after candidate started', async () => {
    let currentStatus = 'pending';
    let currentInProgress = false;

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/verify')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            verified: true,
            isAdmin: true,
            interviewId: 'session-123',
            status: currentStatus,
            inProgress: currentInProgress,
          }),
        });
      }
      if (typeof url === 'string' && url.includes('/questions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            session: { duration_minutes: 30 },
            questions: [
              { id: 'q1', question_text: 'Live candidate interview question', category: 'coding', question_order: 1 },
            ],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any;

    render(<InterviewEntryPage />);
    fireEvent.change(screen.getByPlaceholderText('Enter your email'), {
      target: { value: 'admin@creolestudios.com' },
    });
    fireEvent.click(screen.getByText('Continue'));

    const refreshBtn = await screen.findByRole('button', { name: /Check Status \/ Refresh/i });
    expect(refreshBtn).toBeInTheDocument();

    // Candidate starts now
    currentStatus = 'in_progress';
    currentInProgress = true;

    await act(async () => {
      fireEvent.click(refreshBtn);
    });

    // Admin should connect to the live interview
    expect(await screen.findByText('Live candidate interview question')).toBeInTheDocument();
  });
});

