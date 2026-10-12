// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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
  useParams: () => ({ id: 'interview-1' }),
  useRouter: () => ({ push: mockPush, replace: vi.fn(), back: vi.fn() }),
}));

import InterviewEntryPage from './page';

const originalFetch = global.fetch;
const originalMediaDevices = global.navigator.mediaDevices;

async function verifyPasscode() {
  render(<InterviewEntryPage />);
  
  // First step: enter email
  fireEvent.change(screen.getByPlaceholderText('Enter your email'), { target: { value: 'test@example.com' } });
  fireEvent.click(screen.getByText('Continue'));
  
  // Wait for access code input to appear
  const accessCodeInput = await screen.findByPlaceholderText('000000');
  
  // Second step: enter access code
  fireEvent.change(accessCodeInput, { target: { value: '123456' } });
  fireEvent.click(screen.getByText('Continue'));
  
  expect(await screen.findByText('Before you begin')).toBeInTheDocument();
}

describe('InterviewEntryPage', () => {
  beforeEach(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // ignore
    }
    // Prevent dangling fetches from crashing jsdom with Invalid URL
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mockProfileSingle.mockResolvedValue({ data: null, error: null });
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: originalMediaDevices,
      configurable: true,
    });
    localStorage.clear();
    sessionStorage.clear();
    // Tests below flip this; leaking it makes later renders arm while "hidden".
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });

  it('shows an error on an incorrect passcode', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ requiresAccessCode: true }),
    }).mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Incorrect passcode' }),
    }) as any;

    render(<InterviewEntryPage />);
    
    // First step: enter email
    fireEvent.change(screen.getByPlaceholderText('Enter your email'), { target: { value: 'test@example.com' } });
    fireEvent.click(screen.getByText('Continue'));
    
    const accessCodeInput = await screen.findByPlaceholderText('000000');
    fireEvent.change(accessCodeInput, { target: { value: '000000' } });
    fireEvent.click(screen.getByText('Continue'));

    expect(await screen.findByText('Incorrect passcode')).toBeInTheDocument();
  });

  it('shows the instructions screen on a correct passcode', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ requiresAccessCode: true }),
    }).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ verified: true, interviewId: 'interview-1' }),
    }).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        session: { duration_minutes: 30 },
        questions: [{ id: 'q1', question_text: 'Tell us about yourself.', category: 'hr', question_order: 1 }],
      }),
    }) as any;

    await verifyPasscode();

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/interview/verify',
      expect.objectContaining({
        body: JSON.stringify({ interviewId: 'interview-1', accessCode: '123456', email: 'test@example.com' }),
      }),
    );
    expect(screen.getByText('Entire screen share')).toBeInTheDocument();
  });

  it('bypasses access code and directly verifies if admin email is entered', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (typeof url === 'string' && url.includes('verify')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ verified: true, isAdmin: true, interviewId: 'interview-1' }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          questions: [{ id: 'q1', question_text: 'Tell us about yourself.', category: 'hr', question_order: 1 }],
        }),
      });
    }) as any;

    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [], getVideoTracks: () => [], getAudioTracks: () => [] });
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: { getUserMedia, getDisplayMedia: vi.fn() },
      configurable: true,
    });

    render(<InterviewEntryPage />);
    
    fireEvent.change(screen.getByPlaceholderText('Enter your email'), { target: { value: 'admin@example.com' } });
    fireEvent.click(screen.getByText('Continue'));

    // Should go straight to interview since it bypasses passcode and calibration
    expect(await screen.findByText('Tell us about yourself.')).toBeInTheDocument();
  });

  it('only strips non-digit characters and enforces the 6-digit length', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ requiresAccessCode: true }),
    }) as any;

    render(<InterviewEntryPage />);
    
    fireEvent.change(screen.getByPlaceholderText('Enter your email'), { target: { value: 'test@example.com' } });
    fireEvent.click(screen.getByText('Continue'));
    
    const input = await screen.findByPlaceholderText('000000') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'ab12cd' } });
    expect(input.value).toBe('12');
    expect(screen.getByText('Continue').closest('button')).toBeDisabled();
  });

  it('starts the interview once webcam, mic, and full-screen share are granted', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ requiresAccessCode: true }),
    }).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ verified: true, interviewId: 'interview-1' }),
    }).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        session: { duration_minutes: 30 },
        questions: [{ id: 'q1', question_text: 'Tell us about yourself.', category: 'hr', question_order: 1 }],
      }),
    }) as any;

    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [], getVideoTracks: () => [], getAudioTracks: () => [] });
    const getDisplayMedia = vi.fn().mockResolvedValue({
      getVideoTracks: () => [{ getSettings: () => ({ displaySurface: 'monitor' }) }],
      getTracks: () => [],
    });
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: { getUserMedia, getDisplayMedia },
      configurable: true,
    });

    await verifyPasscode();
    fireEvent.click(screen.getByText('Allow & Start Interview'));

    expect(await screen.findByText("You're verified")).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: true });
    expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({ video: expect.anything() }));
  });

  it('rejects a partial-screen share and asks for the entire screen', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ requiresAccessCode: true }),
    }).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ verified: true, interviewId: 'interview-1' }),
    }).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        session: { duration_minutes: 30 },
        questions: [{ id: 'q1', question_text: 'Tell us about yourself.', category: 'hr', question_order: 1 }],
      }),
    }) as any;

    const stop = vi.fn();
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [], getVideoTracks: () => [], getAudioTracks: () => [] });
    const getDisplayMedia = vi.fn().mockResolvedValue({
      getVideoTracks: () => [{ getSettings: () => ({ displaySurface: 'browser' }) }],
      getTracks: () => [{ stop }],
    });
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: { getUserMedia, getDisplayMedia },
      configurable: true,
    });

    await verifyPasscode();
    fireEvent.click(screen.getByText('Allow & Start Interview'));

    expect(
      await screen.findByText('Please share your entire screen, not a window or tab, to continue.'),
    ).toBeInTheDocument();
    expect(stop).toHaveBeenCalled();
  });

  it('shows an error when permissions are denied', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ requiresAccessCode: true }),
    }).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ verified: true, interviewId: 'interview-1' }),
    }) as any;

    const getUserMedia = vi.fn().mockRejectedValue(new Error('Permission denied'));
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: { getUserMedia, getDisplayMedia: vi.fn() },
      configurable: true,
    });

    await verifyPasscode();
    fireEvent.click(screen.getByText('Allow & Start Interview'));

    expect(
      await screen.findByText(
        'Camera, microphone, and full-screen sharing are all required to start this interview.',
      ),
    ).toBeInTheDocument();
  });

  it('starts the interview before monitoring status is displayed', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ requiresAccessCode: true }),
    }).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ verified: true, interviewId: 'interview-1' }),
    }).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        session: { duration_minutes: 30 },
        questions: [{ id: 'q1', question_text: 'Tell us about yourself.', category: 'hr', question_order: 1 }],
      }),
    }) as any;

    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [], getVideoTracks: () => [], getAudioTracks: () => [] });
    const getDisplayMedia = vi.fn().mockResolvedValue({
      getVideoTracks: () => [{ getSettings: () => ({ displaySurface: 'monitor' }) }],
      getTracks: () => [],
    });
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: { getUserMedia, getDisplayMedia },
      configurable: true,
    });

    await verifyPasscode();
    fireEvent.click(screen.getByText('Allow & Start Interview'));
    expect(await screen.findByText("You're verified")).toBeInTheDocument();
  });

  it('terminates the interview as soon as the tab is hidden or the window minimized', async () => {
    let verifyCallCount = 0;
    global.fetch = vi.fn().mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('verify')) {
        verifyCallCount++;
        if (verifyCallCount === 1) {
          return { ok: true, json: () => Promise.resolve({ requiresAccessCode: true }) };
        }
        return { ok: true, json: () => Promise.resolve({ verified: true, interviewId: 'interview-1' }) };
      }
      if (typeof url === 'string' && url.includes('questions')) {
        return {
          ok: true,
          json: () => Promise.resolve({
            session: { duration_minutes: 30 },
            questions: [{ id: 'q1', question_text: 'Tell us about yourself.', category: 'hr', question_order: 1 }],
          }),
        };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    }) as any;

    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [], getVideoTracks: () => [], getAudioTracks: () => [] });
    const getDisplayMedia = vi.fn().mockResolvedValue({
      getVideoTracks: () => [{ getSettings: () => ({ displaySurface: 'monitor' }) }],
      getTracks: () => [],
    });
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: { getUserMedia, getDisplayMedia },
      configurable: true,
    });

    await verifyPasscode();
    fireEvent.click(screen.getByText('Allow & Start Interview'));
    expect(await screen.findByText("You're verified")).toBeInTheDocument();

    // Hiding the tab while on the ready (Join Interview) screen does NOT terminate
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    fireEvent(document, new Event('visibilitychange'));
    expect(screen.queryByText('Interview terminated')).not.toBeInTheDocument();

    // Clicking Join Interview starts the live interview
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    fireEvent.click(screen.getByRole('button', { name: 'Join Interview' }));

    // Hiding the tab during the live interview terminates
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    fireEvent(document, new Event('visibilitychange'));

    expect(await screen.findByText('Interview terminated')).toBeInTheDocument();
  });

  it('does NOT terminate when the page only loses keyboard focus while staying visible', async () => {
    let verifyCallCount = 0;
    global.fetch = vi.fn().mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('verify')) {
        verifyCallCount++;
        if (verifyCallCount === 1) {
          return { ok: true, json: () => Promise.resolve({ requiresAccessCode: true }) };
        }
        return { ok: true, json: () => Promise.resolve({ verified: true, interviewId: 'interview-1' }) };
      }
      if (typeof url === 'string' && url.includes('questions')) {
        return {
          ok: true,
          json: () => Promise.resolve({
            session: { duration_minutes: 30 },
            questions: [{ id: 'q1', question_text: 'Tell us about yourself.', category: 'hr', question_order: 1 }],
          }),
        };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    }) as any;

    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [], getVideoTracks: () => [], getAudioTracks: () => [] });
    const getDisplayMedia = vi.fn().mockResolvedValue({
      getVideoTracks: () => [{ getSettings: () => ({ displaySurface: 'monitor' }) }],
      getTracks: () => [],
    });
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: { getUserMedia, getDisplayMedia },
      configurable: true,
    });

    await verifyPasscode();
    fireEvent.click(screen.getByText('Allow & Start Interview'));
    await screen.findByText("You're verified");

    // A running full-screen share leaves Chrome's sharing indicator holding
    // keyboard focus while the page itself stays visible.
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    fireEvent(window, new Event('blur'));
    fireEvent(document, new Event('visibilitychange'));

    await new Promise((resolve) => setTimeout(resolve, 1000));

    expect(screen.queryByText('Interview terminated')).not.toBeInTheDocument();
    expect(screen.getByText("You're verified")).toBeInTheDocument();
    hasFocus.mockRestore();
  });


  it('renders Leave button when isAdmin is true and navigates to dashboard on click', async () => {
    mockPush.mockClear();

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/verify')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ verified: true, isAdmin: true, interviewId: 'interview-1' }),
        });
      }
      if (typeof url === 'string' && url.includes('/questions')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            session: { duration_minutes: 30 },
            questions: [{ id: 'q1', question_text: 'Admin observation question', category: 'general', question_order: 1 }],
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any;

    const stopTrack = vi.fn();
    const makeTrack = () => ({
      stop: stopTrack,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getSettings: () => ({ displaySurface: 'monitor' }),
    });
    const fakeStream = {
      getTracks: () => [makeTrack()],
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

    render(<InterviewEntryPage />);
    fireEvent.change(screen.getByPlaceholderText('Enter your email'), { target: { value: 'admin@creolestudios.com' } });
    fireEvent.click(screen.getByText('Continue'));

    const leaveBtn = await screen.findByRole('button', { name: /leave/i });
    expect(leaveBtn).toBeInTheDocument();

    fireEvent.click(leaveBtn);
    expect(mockPush).toHaveBeenCalledWith('/admin/dashboard');
  });

  it('directly shows link expired screen without email/passcode form when link was previously used', () => {
    localStorage.setItem('interview_used_interview-1', 'true');
    render(<InterviewEntryPage />);
    expect(screen.getByText('Link is expired')).toBeInTheDocument();
    expect(screen.getByText(/Note: This interview link has already been used and is expired/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Enter your email')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('000000')).not.toBeInTheDocument();
  });

  it('shows Link is expired screen instead of termination screen when submitting passcode for a used/terminated link', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ requiresAccessCode: true }),
    }).mockResolvedValueOnce({
      ok: false,
      status: 410,
      json: () => Promise.resolve({
        error: 'This interview has already ended',
        note: 'Note: This interview link has already been used and is expired.',
        status: 'expired',
        expired: true,
        used: true,
        expirationReason: 'already_used',
        reasonTitle: 'Link is expired',
      }),
    }) as any;

    render(<InterviewEntryPage />);
    fireEvent.change(screen.getByPlaceholderText('Enter your email'), { target: { value: 'candidate@example.com' } });
    fireEvent.click(screen.getByText('Continue'));

    const accessCodeInput = await screen.findByPlaceholderText('000000');
    fireEvent.change(accessCodeInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByText('Continue'));

    expect(await screen.findByText('Link is expired')).toBeInTheDocument();
    expect(screen.getByText(/🔒 Single-Use Consumed/i)).toBeInTheDocument();
    expect(screen.getByText(/Note: This interview link has already been used and is expired/i)).toBeInTheDocument();
    expect(screen.queryByText('Interview terminated')).not.toBeInTheDocument();
    expect(screen.queryByText(/Session Terminated by Proctoring Guard/i)).not.toBeInTheDocument();
  });

  it('does not terminate when candidate is on ready (Join Interview) screen and skips ack modal if previously acknowledged', async () => {
    let verifyCallCount = 0;
    global.fetch = vi.fn().mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('verify')) {
        verifyCallCount++;
        if (verifyCallCount === 1) {
          return { ok: true, json: () => Promise.resolve({ requiresAccessCode: true }) };
        }
        return { ok: true, json: () => Promise.resolve({ verified: true, interviewId: 'interview-1' }) };
      }
      if (typeof url === 'string' && url.includes('questions')) {
        return {
          ok: true,
          json: () => Promise.resolve({
            session: { duration_minutes: 30 },
            questions: [{ id: 'q1', question_text: 'Tell us about yourself.', category: 'hr', question_order: 1 }],
          }),
        };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    }) as any;

    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [], getVideoTracks: () => [], getAudioTracks: () => [] });
    const getDisplayMedia = vi.fn().mockResolvedValue({
      getVideoTracks: () => [{ getSettings: () => ({ displaySurface: 'monitor' }) }],
      getTracks: () => [],
    });
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: { getUserMedia, getDisplayMedia },
      configurable: true,
    });

    sessionStorage.setItem('interview_ack_interview-1', 'true');
    await verifyPasscode();

    fireEvent.click(screen.getByText('Allow & Start Interview'));
    expect(await screen.findByText("You're verified")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Join Interview' })).toBeInTheDocument();
    expect(screen.queryByText('Acknowledgment')).not.toBeInTheDocument();

    // Hiding/refreshing the tab while in the ready lobby does not terminate the interview
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    fireEvent(document, new Event('visibilitychange'));
    expect(screen.queryByText('Interview terminated')).not.toBeInTheDocument();
  });

  it('clicking Join Interview in ready lobby transitions to calibration without setting interview_used in localStorage', async () => {
    let verifyCallCount = 0;
    global.fetch = vi.fn().mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('verify')) {
        verifyCallCount++;
        if (verifyCallCount === 1) {
          return { ok: true, json: () => Promise.resolve({ requiresAccessCode: true }) };
        }
        return { ok: true, json: () => Promise.resolve({ verified: true, interviewId: 'interview-1' }) };
      }
      if (typeof url === 'string' && url.includes('questions')) {
        return {
          ok: true,
          json: () => Promise.resolve({
            session: { duration_minutes: 30 },
            questions: [{ id: 'q1', question_text: 'Tell us about yourself.', category: 'hr', question_order: 1 }],
          }),
        };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    }) as any;

    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [], getVideoTracks: () => [], getAudioTracks: () => [] });
    const getDisplayMedia = vi.fn().mockResolvedValue({
      getVideoTracks: () => [{ getSettings: () => ({ displaySurface: 'monitor' }) }],
      getTracks: () => [],
    });
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: { getUserMedia, getDisplayMedia },
      configurable: true,
    });

    sessionStorage.setItem('interview_ack_interview-1', 'true');
    await verifyPasscode();

    fireEvent.click(screen.getByText('Allow & Start Interview'));
    expect(await screen.findByText("You're verified")).toBeInTheDocument();

    const joinBtn = screen.getByRole('button', { name: 'Join Interview' });
    fireEvent.click(joinBtn);

    // Live interview screen is reached without link expiration error
    expect(screen.queryByText('Link is expired')).not.toBeInTheDocument();
  });

  it('resumes cleanly without link expired flash when candidate reloads during calibration setup', async () => {
    sessionStorage.setItem('interview_auth_interview-1', JSON.stringify({ accessCode: '123456', email: 'test@example.com' }));
    sessionStorage.setItem('interview_ack_interview-1', 'true');

    render(<InterviewEntryPage />);

    // Link must NOT be shown as expired
    expect(screen.queryByText('Link is expired')).not.toBeInTheDocument();
    expect(screen.queryByText(/This interview link has already been used/i)).not.toBeInTheDocument();
  });

  it('follows Option B flow on refresh during calibration: permission screen -> confirm box -> join interview -> calibration', async () => {
    let verifyCallCount = 0;
    global.fetch = vi.fn().mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('verify')) {
        verifyCallCount++;
        if (verifyCallCount === 1) {
          return { ok: true, json: () => Promise.resolve({ requiresAccessCode: true }) };
        }
        return { ok: true, json: () => Promise.resolve({ verified: true, interviewId: 'interview-1' }) };
      }
      if (typeof url === 'string' && url.includes('questions')) {
        return {
          ok: true,
          json: () => Promise.resolve({
            session: { duration_minutes: 30 },
            questions: [{ id: 'q1', question_text: 'Tell us about yourself.', category: 'hr', question_order: 1 }],
          }),
        };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    }) as any;

    sessionStorage.setItem('interview_show_ack_in_test_interview-1', 'true');

    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [], getVideoTracks: () => [], getAudioTracks: () => [] });
    const getDisplayMedia = vi.fn().mockResolvedValue({
      getVideoTracks: () => [{ getSettings: () => ({ displaySurface: 'monitor' }) }],
      getTracks: () => [],
    });
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: { getUserMedia, getDisplayMedia },
      configurable: true,
    });

    await verifyPasscode();

    // 1. Candidate is on permission screen
    const allowBtn = screen.getByRole('button', { name: /Allow & Start Interview/i });
    expect(allowBtn).toBeInTheDocument();

    // 2. Candidate grants permissions -> Confirm Box (Acknowledgment modal) is shown
    fireEvent.click(allowBtn);
    expect(await screen.findByText('Acknowledgment')).toBeInTheDocument();
    const ackCheckbox = screen.getByRole('checkbox');
    expect(ackCheckbox).not.toBeChecked();

    const nextBtn = screen.getByRole('button', { name: 'Next' });
    expect(nextBtn).toBeDisabled();

    // 3. Candidate acknowledges and clicks Next -> Join Interview screen (Ready lobby) is shown
    fireEvent.click(ackCheckbox);
    expect(nextBtn).not.toBeDisabled();
    fireEvent.click(nextBtn);

    expect(await screen.findByText("You're verified")).toBeInTheDocument();
    const joinBtn = screen.getByRole('button', { name: 'Join Interview' });
    expect(joinBtn).toBeInTheDocument();

    // 4. Candidate clicks Join Interview -> transitions to calibration/interview stage without link expiration
    fireEvent.click(joinBtn);
    expect(screen.queryByText('Link is expired')).not.toBeInTheDocument();
  });

  it('displays termination screen with refresh reason when candidate reloads during live interview and does not switch to expired screen', async () => {
    sessionStorage.setItem(
      'interview_refresh_terminated_interview-1',
      'The candidate refreshed or closed the page during the live interview.'
    );
    sessionStorage.setItem('interview_live_active_interview-1', 'true');

    global.fetch = vi.fn().mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('verify')) {
        return {
          status: 410,
          ok: false,
          json: () =>
            Promise.resolve({
              error: 'This interview link has already been used and is expired',
              expired: true,
              used: true,
              expirationReason: 'already_used',
              reasonTitle: 'Link is expired',
              reasonDetail: 'For security and assessment integrity, each interview link is strictly single-use.',
            }),
        };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    }) as any;

    const { unmount } = render(<InterviewEntryPage />);

    expect(await screen.findByText('Interview terminated')).toBeInTheDocument();
    expect(
      screen.getByText('The candidate refreshed or closed the page during the live interview.')
    ).toBeInTheDocument();

    expect(screen.queryByText('Link is expired')).not.toBeInTheDocument();
    expect(screen.queryByText(/For security and assessment integrity/i)).not.toBeInTheDocument();

    expect(sessionStorage.getItem('interview_refresh_terminated_interview-1')).toBeNull();
    expect(sessionStorage.getItem('interview_live_active_interview-1')).toBeNull();

    unmount();
  });

  it('displays expired link screen when reopening or reloading after the termination screen was already viewed', async () => {
    sessionStorage.setItem(
      'interview_refresh_terminated_interview-1',
      'The candidate refreshed or closed the page during the live interview.'
    );

    global.fetch = vi.fn().mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('verify')) {
        return {
          status: 410,
          ok: false,
          json: () =>
            Promise.resolve({
              error: 'This interview link has already been used and is expired',
              expired: true,
              used: true,
              expirationReason: 'already_used',
              reasonTitle: 'Link is expired',
              reasonDetail: 'For security and assessment integrity, each interview link is strictly single-use.',
            }),
        };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    }) as any;

    const firstMount = render(<InterviewEntryPage />);
    expect(await screen.findByText('Interview terminated')).toBeInTheDocument();
    firstMount.unmount();

    const secondMount = render(<InterviewEntryPage />);
    expect(await screen.findByText('Link is expired')).toBeInTheDocument();
    expect(screen.getByText(/Note: This interview link has already been used and is expired/i)).toBeInTheDocument();
    secondMount.unmount();
  });

  it('displays expired link screen when reopening a previously used link in a fresh session without live refresh flag', async () => {
    localStorage.setItem('interview_used_interview-1', 'true');

    global.fetch = vi.fn().mockImplementation(async (url) => {
      if (typeof url === 'string' && url.includes('verify')) {
        return {
          status: 410,
          ok: false,
          json: () =>
            Promise.resolve({
              error: 'This interview link has already been used and is expired',
              expired: true,
              used: true,
              expirationReason: 'already_used',
              reasonTitle: 'Link is expired',
              reasonDetail: 'For security and assessment integrity, each interview link is strictly single-use.',
            }),
        };
      }
      return { ok: true, json: () => Promise.resolve({}) };
    }) as any;

    render(<InterviewEntryPage />);
    expect(await screen.findByText('Link is expired')).toBeInTheDocument();
    expect(screen.queryByText('Interview terminated')).not.toBeInTheDocument();
  });
});
