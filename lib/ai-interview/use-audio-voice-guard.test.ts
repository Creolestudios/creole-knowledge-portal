// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useAudioVoiceGuard } from './use-audio-voice-guard';

describe('useAudioVoiceGuard', () => {
  let mockGetByteFrequencyData: ReturnType<typeof vi.fn>;
  let rafCallback: FrameRequestCallback | null = null;
  let rafIdCounter = 1;

  beforeEach(() => {
    vi.clearAllMocks();
    rafCallback = null;

    vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
      rafCallback = cb;
      return rafIdCounter++;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      arr.fill(0);
    });

    class MockAnalyser {
      fftSize = 512;
      smoothingTimeConstant = 0.8;
      frequencyBinCount = 256;
      getByteFrequencyData = mockGetByteFrequencyData;
    }

    class MockAudioContext {
      state = 'running';
      resume = vi.fn().mockResolvedValue(undefined);
      close = vi.fn().mockResolvedValue(undefined);
      createAnalyser = vi.fn(() => new MockAnalyser());
      createMediaStreamSource = vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
      }));
    }

    vi.stubGlobal('AudioContext', MockAudioContext);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }))));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const fakeStream = {
    getAudioTracks: () => [{ kind: 'audio' }],
  } as unknown as MediaStream;

  it('does NOT trigger warning for lower background voices below speaker level', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    // Fill with low energy background noise (e.g. 25, well below default speaker baseline 45)
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      for (let i = 3; i < 36; i++) {
        arr[i] = 25;
      }
    });

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-1',
        stream: fakeStream,
        isAiSpeaking: false,
        isCandidateTurn: true,
        isCandidateMouthMoving: false,
        onUnauthorizedVoiceDetected,
      })
    );

    // Simulate 40 audio frames
    for (let f = 0; f < 40; f++) {
      if (rafCallback) {
        const cb = rafCallback;
        rafCallback = null;
        cb(performance.now());
      }
    }

    expect(onUnauthorizedVoiceDetected).not.toHaveBeenCalled();
  });

  it('triggers warning when background voice is HIGHER than the actual speaker', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    // Fill with louder energy (e.g. 80, higher than speaker baseline 45) and varied spectral flux
    let frame = 0;
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      frame++;
      for (let i = 3; i < 36; i++) {
        arr[i] = (frame % 2 === 0 ? 80 : 60);
      }
      arr[15] = 95; // peak energy
    });

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-2',
        stream: fakeStream,
        isAiSpeaking: false,
        isCandidateTurn: true,
        isCandidateMouthMoving: false,
        onUnauthorizedVoiceDetected,
      })
    );

    // Run enough frames for sustained speech
    for (let f = 0; f < 30; f++) {
      if (rafCallback) {
        const cb = rafCallback;
        rafCallback = null;
        cb(performance.now());
      }
    }

    expect(onUnauthorizedVoiceDetected).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'Background voice louder than candidate detected.',
      })
    );
  });

  it('triggers warning when AI voice is detected during interview', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    // Flat spectral flux (< 2.0) with speech energy (> 35) simulates synthetic / AI voice
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      for (let i = 3; i < 36; i++) {
        arr[i] = 50; // perfectly constant across frames = flux 0
      }
    });

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-3',
        stream: fakeStream,
        isAiSpeaking: false,
        isCandidateTurn: true,
        isCandidateMouthMoving: false,
        onUnauthorizedVoiceDetected,
      })
    );

    // Run 60 frames to exceed AI detection frame threshold
    for (let f = 0; f < 60; f++) {
      if (rafCallback) {
        const cb = rafCallback;
        rafCallback = null;
        cb(performance.now());
      }
    }

    expect(onUnauthorizedVoiceDetected).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'AI voice detected during interview. Only natural candidate voice is allowed.',
      })
    );
  });

  it('suppresses detection completely while AI interviewer is speaking', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    // Even with very loud noise/voices, when AI is speaking, no warning should trigger
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      arr.fill(100);
    });

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-4',
        stream: fakeStream,
        isAiSpeaking: true, // System AI speaking
        isCandidateTurn: true,
        isCandidateMouthMoving: false,
        onUnauthorizedVoiceDetected,
      })
    );

    for (let f = 0; f < 30; f++) {
      if (rafCallback) {
        const cb = rafCallback;
        rafCallback = null;
        cb(performance.now());
      }
    }

    expect(onUnauthorizedVoiceDetected).not.toHaveBeenCalled();
  });
});
