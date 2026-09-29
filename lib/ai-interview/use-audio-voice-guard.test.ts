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

    // Fill with louder energy (e.g. 70-95, higher than speaker baseline 45) and continuous spectral flux
    let frame = 0;
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      frame++;
      for (let i = 3; i < 36; i++) {
        arr[i] = 70 + ((i * 3 + frame * 5) % 25);
      }
      arr[15] = 110; // peak energy
    });

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-2',
        stream: fakeStream,
        isAiSpeaking: false,
        isCandidateTurn: true,
        isCandidateMouthMoving: false,
        readingGracePeriodMs: 0,
        onUnauthorizedVoiceDetected,
      })
    );

    // Run enough frames for warmup (25 frames) + sustained speech (>= 80 frames)
    for (let f = 0; f < 95; f++) {
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

    // Flat spectral flux (< 2.0) with speech energy (> 50) simulates synthetic / AI voice
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      for (let i = 3; i < 36; i++) {
        arr[i] = 75; // perfectly constant across frames = flux 0, energy > 50
      }
    });

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-3',
        stream: fakeStream,
        isAiSpeaking: false,
        isCandidateTurn: true,
        isCandidateMouthMoving: false,
        readingGracePeriodMs: 0,
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

  it('triggers warning when secondary voice is present while user is speaking (dual speaker)', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    let frame = 0;
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      frame++;
      for (let i = 3; i < 36; i++) {
        arr[i] = 60 + ((i * 2 + frame * 3) % 15);
      }
      // Primary speaker formant peak
      arr[10] = 78;
      // Secondary speaker distinct formant peak (frequency separation >= 5 bins, energy >= 75)
      arr[20] = 85;
    });

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-5',
        stream: fakeStream,
        isAiSpeaking: false,
        isCandidateTurn: true,
        isCandidateMouthMoving: true, // User is speaking!
        readingGracePeriodMs: 0,
        onUnauthorizedVoiceDetected,
      })
    );

    for (let f = 0; f < 95; f++) {
      if (rafCallback) {
        const cb = rafCallback;
        rafCallback = null;
        cb(performance.now());
      }
    }

    expect(onUnauthorizedVoiceDetected).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: expect.stringMatching(/Background voice louder than speaker detected\.|Secondary voice detected while speaking\./),
      })
    );
  });

  it('triggers warning when user is not speaking but background speech is detected', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    let frame = 0;
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      frame++;
      for (let i = 3; i < 36; i++) {
        arr[i] = 62 + ((i + frame * 4) % 18);
      }
      arr[12] = 82;
    });

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-6',
        stream: fakeStream,
        isAiSpeaking: false,
        isCandidateTurn: true,
        isCandidateMouthMoving: false, // User is silent!
        readingGracePeriodMs: 0,
        onUnauthorizedVoiceDetected,
      })
    );

    for (let f = 0; f < 95; f++) {
      if (rafCallback) {
        const cb = rafCallback;
        rafCallback = null;
        cb(performance.now());
      }
    }

    expect(onUnauthorizedVoiceDetected).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: expect.stringMatching(/Background voice detected while candidate was silent\.|Background voice louder than candidate detected\./),
      })
    );
  });

  it('does NOT trigger warning when user is speaking naturally alone', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    let frame = 0;
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      frame++;
      for (let i = 3; i < 36; i++) {
        arr[i] = 40 + ((i + frame) % 10);
      }
      arr[12] = 65; // Single speaker peak, no secondary peak
    });

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-7',
        stream: fakeStream,
        isAiSpeaking: false,
        isCandidateTurn: true,
        isCandidateMouthMoving: true, // Mouth moves matching speech
        readingGracePeriodMs: 0,
        onUnauthorizedVoiceDetected,
      })
    );

    for (let f = 0; f < 50; f++) {
      if (rafCallback) {
        const cb = rafCallback;
        rafCallback = null;
        cb(performance.now());
      }
    }

    expect(onUnauthorizedVoiceDetected).not.toHaveBeenCalled();
  });

  it('triggers warning when background music is detected', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    // High harmonic tonality across musical band (bins 5 to 65) with sustained peak
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      for (let i = 5; i < 65; i++) {
        arr[i] = 38;
      }
      arr[25] = 120; // High tonality peak (120 / ~39 > 3.0)
    });

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-8',
        stream: fakeStream,
        isAiSpeaking: false,
        isCandidateTurn: true,
        isCandidateMouthMoving: false,
        readingGracePeriodMs: 0,
        onUnauthorizedVoiceDetected,
      })
    );

    for (let f = 0; f < 45; f++) {
      if (rafCallback) {
        const cb = rafCallback;
        rafCallback = null;
        cb(performance.now());
      }
    }

    expect(onUnauthorizedVoiceDetected).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'Background music detected.',
      })
    );
  });

  it('triggers warning when keyboard typing sounds are detected', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    let frame = 0;
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      frame++;
      // High-frequency transient spikes on frames 5, 15, and 25 (simulating keystrokes)
      if (frame === 5 || frame === 15 || frame === 25) {
        for (let i = 25; i < 110; i++) {
          arr[i] = 70;
        }
      } else {
        arr.fill(10);
      }
    });

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-9',
        stream: fakeStream,
        isAiSpeaking: false,
        isCandidateTurn: true,
        isCandidateMouthMoving: false,
        readingGracePeriodMs: 0,
        onUnauthorizedVoiceDetected,
      })
    );

    for (let f = 0; f < 35; f++) {
      if (rafCallback) {
        const cb = rafCallback;
        rafCallback = null;
        cb(performance.now());
      }
    }

    expect(onUnauthorizedVoiceDetected).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'Keyboard typing sounds detected.',
      })
    );
  });

  it('does NOT trigger keyboard typing warning when there is no sound or low ambient noise', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    let frame = 0;
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      frame++;
      // Silence or normal background ambient room noise with mild fluctuations (15-30)
      for (let i = 0; i < arr.length; i++) {
        arr[i] = 15 + ((i + frame) % 15);
      }
    });

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-10',
        stream: fakeStream,
        isAiSpeaking: false,
        isCandidateTurn: true,
        isCandidateMouthMoving: false,
        readingGracePeriodMs: 0,
        onUnauthorizedVoiceDetected,
      })
    );

    for (let f = 0; f < 50; f++) {
      if (rafCallback) {
        const cb = rafCallback;
        rafCallback = null;
        cb(performance.now());
      }
    }

    expect(onUnauthorizedVoiceDetected).not.toHaveBeenCalled();
  });
});
