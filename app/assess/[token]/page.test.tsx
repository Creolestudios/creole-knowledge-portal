// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import CandidateAssessmentPage from './page';

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: 'raw-token' }),
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

function makeStream() {
  const track = makeTrack();
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
}

async function joinFromReadyLobby() {
  await waitFor(() => expect(screen.getByText("You're ready to join")).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Join Interview' }));
}

describe('CandidateAssessmentPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    // Tests below flip this; leaking it makes later renders arm while "hidden".
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });

  it('requires a 6-digit passcode before Continue is enabled', () => {
    render(<CandidateAssessmentPage />);
    const continueBtn = screen.getByRole('button', { name: 'Continue' });
    expect(continueBtn).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '654321' } });
    expect(continueBtn).not.toBeDisabled();
  });

  it('strips non-digit characters from the passcode input', () => {
    render(<CandidateAssessmentPage />);
    const input = screen.getByPlaceholderText('000000') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12a3b4' } });
    expect(input.value).toBe('1234');
  });

  it('shows a server error when the passcode is rejected', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Incorrect passcode' }),
    });

    render(<CandidateAssessmentPage />);
    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(screen.getByText('Incorrect passcode')).toBeInTheDocument());
  });

  it('advances to the instructions/permissions stage on a valid passcode', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        candidate_name: 'Jane',
        questions: [{ id: 'q1', question_text: 'Tell me about yourself', category: 'hr' }],
      }),
    });

    render(<CandidateAssessmentPage />);
    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(screen.getByText('Before you begin')).toBeInTheDocument());
    expect(screen.getByText('Webcam & microphone')).toBeInTheDocument();
  });

  it('rejects a partial-screen share and asks for the entire screen', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ candidate_name: 'Jane', questions: [] }),
    });

    const cameraStream = makeStream();
    const partialTrack = { ...makeTrack(), getSettings: () => ({ displaySurface: 'window' }) };
    const screenStream = { getTracks: () => [partialTrack], getVideoTracks: () => [partialTrack] } as unknown as MediaStream;

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue(cameraStream),
        getDisplayMedia: vi.fn().mockResolvedValue(screenStream),
      },
      configurable: true,
    });

    render(<CandidateAssessmentPage />);
    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByText('Before you begin')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Allow Camera, Mic & Screen Share'));
    await waitFor(() =>
      expect(
        screen.getByText('Please share your entire screen, not a window or tab, to continue.'),
      ).toBeInTheDocument(),
    );
    expect(partialTrack.stop).toHaveBeenCalled();
  });

  it('joins the interview once camera, mic, and full-screen share are granted', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        candidate_name: 'Jane',
        questions: [{ id: 'q1', question_text: 'Tell me about yourself', category: 'hr' }],
      }),
    });

    const cameraStream = makeStream();
    const fullTrack = { ...makeTrack(), getSettings: () => ({ displaySurface: 'monitor' }) };
    const screenStream = { getTracks: () => [fullTrack], getVideoTracks: () => [fullTrack] } as unknown as MediaStream;

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue(cameraStream),
        getDisplayMedia: vi.fn().mockResolvedValue(screenStream),
      },
      configurable: true,
    });

    render(<CandidateAssessmentPage />);
    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByText('Before you begin')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Allow Camera, Mic & Screen Share'));
    await joinFromReadyLobby();
    await waitFor(() => expect(screen.getByText('Question 1 of 1')).toBeInTheDocument());
    expect(screen.getByText('Tell me about yourself')).toBeInTheDocument();
    expect(screen.getByText('Live Video')).toBeInTheDocument();
    expect(screen.getByLabelText('You camera preview')).toBeInTheDocument();
    expect(screen.getByLabelText('Remaining time')).toBeInTheDocument();
  });

  it('shows a network-error message when passcode verification throws', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'));

    render(<CandidateAssessmentPage />);
    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() =>
      expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument(),
    );
  });

  it('shows a permission error when camera/mic access is denied', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ candidate_name: 'Jane', questions: [] }),
    });

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockRejectedValue(new Error('NotAllowedError')),
        getDisplayMedia: vi.fn(),
      },
      configurable: true,
    });

    render(<CandidateAssessmentPage />);
    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByText('Before you begin')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Allow Camera, Mic & Screen Share'));
    await waitFor(() =>
      expect(
        screen.getByText('Camera, microphone, and full-screen sharing are all required to start this interview.'),
      ).toBeInTheDocument(),
    );
  });

  async function joinInterview(question: AssessQuestionLike = { id: 'q1', question_text: 'Tell me about yourself', category: 'hr' }) {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ candidate_name: 'Jane', questions: [question] }),
    });

    const cameraStream = makeStream();
    const fullTrack = { ...makeTrack(), getSettings: () => ({ displaySurface: 'monitor' }) };
    const screenStream = { getTracks: () => [fullTrack], getVideoTracks: () => [fullTrack] } as unknown as MediaStream;

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue(cameraStream),
        getDisplayMedia: vi.fn().mockResolvedValue(screenStream),
      },
      configurable: true,
    });

    render(<CandidateAssessmentPage />);
    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByText('Before you begin')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Allow Camera, Mic & Screen Share'));
    await joinFromReadyLobby();
    await waitFor(() => expect(screen.getByText(question.question_text)).toBeInTheDocument());
  }

  it('terminates the interview as soon as the tab is switched or the window minimized', async () => {
    Object.assign(navigator, { sendBeacon: vi.fn().mockReturnValue(true) });

    await joinInterview();

    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, json: async () => ({}) });
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    fireEvent(document, new Event('visibilitychange'));

    await waitFor(() => expect(screen.getByText('Interview terminated')).toBeInTheDocument());
    expect(navigator.sendBeacon).toHaveBeenCalledWith(
      '/api/assess/raw-token/terminate',
      expect.anything(),
    );
  });

  it('does NOT terminate when the page only loses keyboard focus while staying visible', async () => {
    Object.assign(navigator, { sendBeacon: vi.fn().mockReturnValue(true) });
    await joinInterview();

    // What a running full-screen share does: Chrome's sharing indicator takes
    // focus, the interview page stays visible.
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    fireEvent(window, new Event('blur'));
    fireEvent(document, new Event('visibilitychange'));

    await new Promise((resolve) => setTimeout(resolve, 5000));

    expect(screen.queryByText('Interview terminated')).not.toBeInTheDocument();
    expect(navigator.sendBeacon).not.toHaveBeenCalled();
    hasFocus.mockRestore();
  });

  it('shows an error and does not advance when saving an answer fails', async () => {
    await joinInterview();

    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Session expired' }),
    });

    fireEvent.change(screen.getByPlaceholderText('Type your answer here...'), {
      target: { value: 'My answer' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Finish Interview/ }));

    await waitFor(() => expect(screen.getByText('Session expired')).toBeInTheDocument());
    expect(screen.getByText('Question 1 of 1')).toBeInTheDocument();
  });

  it('shows a video preview and lets the candidate mute their mic in the ready lobby', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ candidate_name: 'Jane', questions: [] }),
    });

    const track = makeTrack();
    const cameraStream = {
      getTracks: () => [track],
      getVideoTracks: () => [track],
      getAudioTracks: () => [track],
    } as unknown as MediaStream;
    const screenTrack = { ...makeTrack(), getSettings: () => ({ displaySurface: 'monitor' }) };
    const screenStream = { getTracks: () => [screenTrack], getVideoTracks: () => [screenTrack] } as unknown as MediaStream;

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue(cameraStream),
        getDisplayMedia: vi.fn().mockResolvedValue(screenStream),
      },
      configurable: true,
    });

    render(<CandidateAssessmentPage />);
    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByText('Before you begin')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Allow Camera, Mic & Screen Share'));

    await waitFor(() => expect(screen.getByText("You're ready to join")).toBeInTheDocument());
    expect(screen.getByLabelText('You camera preview')).toBeInTheDocument();

    const micButton = document.getElementById('meeting-toggle-mic') as HTMLButtonElement;
    expect(micButton.getAttribute('aria-pressed')).toBe('true');
    expect(track.enabled).toBe(true);

    fireEvent.click(micButton);
    expect(track.enabled).toBe(false);
    expect(micButton.getAttribute('aria-pressed')).toBe('false');
  });

  it('opens the device settings panel from the ready lobby and switches cameras', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ candidate_name: 'Jane', questions: [] }),
    });

    const cameraStream = makeStream();
    const screenTrack = { ...makeTrack(), getSettings: () => ({ displaySurface: 'monitor' }) };
    const screenStream = { getTracks: () => [screenTrack], getVideoTracks: () => [screenTrack] } as unknown as MediaStream;
    const newCameraStream = makeStream();

    const getUserMedia = vi.fn().mockResolvedValueOnce(cameraStream).mockResolvedValueOnce(newCameraStream);
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia,
        getDisplayMedia: vi.fn().mockResolvedValue(screenStream),
        enumerateDevices: vi.fn().mockResolvedValue([
          { kind: 'videoinput', deviceId: 'cam-1', label: 'Front Camera' },
          { kind: 'videoinput', deviceId: 'cam-2', label: 'Back Camera' },
          { kind: 'audioinput', deviceId: 'mic-1', label: 'Default Mic' },
        ]),
      },
      configurable: true,
    });

    render(<CandidateAssessmentPage />);
    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(screen.getByText('Before you begin')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Allow Camera, Mic & Screen Share'));
    await waitFor(() => expect(screen.getByText("You're ready to join")).toBeInTheDocument());

    fireEvent.click(document.getElementById('meeting-open-settings')!);
    await waitFor(() => expect(document.getElementById('device-settings-panel')).toBeInTheDocument());

    fireEvent.change(document.getElementById('device-settings-camera-select')!, { target: { value: 'cam-2' } });
    fireEvent.click(document.getElementById('device-settings-apply')!);

    await waitFor(() => expect(document.getElementById('device-settings-panel')).not.toBeInTheDocument());
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia).toHaveBeenLastCalledWith(
      expect.objectContaining({ video: { deviceId: { exact: 'cam-2' } } }),
    );
  });

  it('completes the interview after the last question is answered successfully', async () => {
    await joinInterview();

    (fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ saved: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ completed: true }) });

    fireEvent.change(screen.getByPlaceholderText('Type your answer here...'), {
      target: { value: 'My answer' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Finish Interview/ }));

    await waitFor(() => expect(screen.getByText('Interview complete')).toBeInTheDocument());
    expect(screen.getByText(/Jane/)).toBeInTheDocument();
  });
});

interface AssessQuestionLike {
  id: string;
  question_text: string;
  category: string;
}
