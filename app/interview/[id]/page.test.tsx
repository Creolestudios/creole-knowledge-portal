// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'interview-1' }),
}));

import InterviewEntryPage from './page';

const originalFetch = global.fetch;
const originalMediaDevices = global.navigator.mediaDevices;

async function verifyPasscode() {
  render(<InterviewEntryPage />);
  fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '123456' } });
  fireEvent.click(screen.getByText('Continue'));
  expect(await screen.findByText('Before you begin')).toBeInTheDocument();
}

describe('InterviewEntryPage', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: originalMediaDevices,
      configurable: true,
    });
  });

  it('shows an error on an incorrect passcode', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Incorrect passcode' }),
    }) as any;

    render(<InterviewEntryPage />);
    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '000000' } });
    fireEvent.click(screen.getByText('Continue'));

    expect(await screen.findByText('Incorrect passcode')).toBeInTheDocument();
  });

  it('shows the instructions screen on a correct passcode', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
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
        body: JSON.stringify({ interviewId: 'interview-1', accessCode: '123456' }),
      }),
    );
    expect(screen.getByText('Entire screen share')).toBeInTheDocument();
  });

  it('only strips non-digit characters and enforces the 6-digit length', () => {
    render(<InterviewEntryPage />);
    const input = screen.getByPlaceholderText('000000') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'ab12cd' } });
    expect(input.value).toBe('12');
    expect(screen.getByText('Continue').closest('button')).toBeDisabled();
  });

  it('starts the interview once webcam, mic, and full-screen share are granted', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ verified: true, interviewId: 'interview-1' }),
    }).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        session: { duration_minutes: 30 },
        questions: [{ id: 'q1', question_text: 'Tell us about yourself.', category: 'hr', question_order: 1 }],
      }),
    }) as any;

    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [] });
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

    expect(await screen.findByText('Tell us about yourself.')).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledWith({ video: true, audio: true });
    expect(getDisplayMedia).toHaveBeenCalledWith({ video: true });
  });

  it('rejects a partial-screen share and asks for the entire screen', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
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
    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [] });
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
    global.fetch = vi.fn().mockResolvedValue({
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
      json: () => Promise.resolve({ verified: true, interviewId: 'interview-1' }),
    }).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        session: { duration_minutes: 30 },
        questions: [{ id: 'q1', question_text: 'Tell us about yourself.', category: 'hr', question_order: 1 }],
      }),
    }) as any;

    const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [] });
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
    expect(await screen.findByText('Tell us about yourself.')).toBeInTheDocument();
  });
});
