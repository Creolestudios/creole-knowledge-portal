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
    vi.restoreAllMocks();
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

  it('triggers warning when background voice is HIGHER than the actual speaker after 8-10s continuous voice', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    let frame = 0;
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      frame++;
      for (let i = 3; i < 36; i++) {
        arr[i] = 70 + ((i * 3 + frame * 5) % 25);
      }
      arr[15] = 110; // peak energy
    });

    let currentTime = 1700000000000;
    vi.spyOn(Date, 'now').mockImplementation(() => currentTime);

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

    // Simulate 500 frames at ~16.66ms (~8.3s continuous voice)
    for (let f = 0; f < 500; f++) {
      currentTime += 16.66;
      if (rafCallback) {
        const cb = rafCallback;
        rafCallback = null;
        cb(currentTime);
      }
    }

    expect(onUnauthorizedVoiceDetected).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'Background voice detected',
      })
    );
  });

  it('triggers warning when AI voice is detected continuously during interview', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    // Flat spectral flux (< 1.8) with speech energy (> 65) simulates synthetic / AI voice
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      for (let i = 3; i < 36; i++) {
        arr[i] = 75; // constant across frames = flux 0, energy > 65
      }
    });

    let currentTime = 1700000000000;
    vi.spyOn(Date, 'now').mockImplementation(() => currentTime);

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

    // Run 500 frames (~8.3s) to satisfy continuous voice requirement
    for (let f = 0; f < 500; f++) {
      currentTime += 16.66;
      if (rafCallback) {
        const cb = rafCallback;
        rafCallback = null;
        cb(currentTime);
      }
    }

    expect(onUnauthorizedVoiceDetected).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'Background voice detected',
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

    let currentTime = 1700000000000;
    vi.spyOn(Date, 'now').mockImplementation(() => currentTime);

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

    for (let f = 0; f < 500; f++) {
      currentTime += 16.66;
      if (rafCallback) {
        const cb = rafCallback;
        rafCallback = null;
        cb(currentTime);
      }
    }

    expect(onUnauthorizedVoiceDetected).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'Background voice detected',
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

    let currentTime = 1700000000000;
    vi.spyOn(Date, 'now').mockImplementation(() => currentTime);

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

    for (let f = 0; f < 500; f++) {
      currentTime += 16.66;
      if (rafCallback) {
        const cb = rafCallback;
        rafCallback = null;
        cb(currentTime);
      }
    }

    expect(onUnauthorizedVoiceDetected).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'Background voice detected',
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

  it('does NOT trigger keyboard typing warning during loud music with percussion beats', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    let frame = 0;
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      frame++;
      // Loud music with low-mid bass/chords (bins 3-23)
      for (let i = 3; i < 24; i++) {
        arr[i] = 45;
      }
      // Percussion / drum transients spiking in high band (bins 25-110) on frames 5, 15, 25
      if (frame === 5 || frame === 15 || frame === 25) {
        for (let i = 25; i < 110; i++) {
          arr[i] = 75;
        }
      } else {
        for (let i = 25; i < 110; i++) {
          arr[i] = 20;
        }
      }
    });

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-11',
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

    // Must NOT trigger keyboard typing sounds
    const typingCalls = onUnauthorizedVoiceDetected.mock.calls.filter(
      (call) => call[0]?.reason === 'Keyboard typing sounds detected.'
    );
    expect(typingCalls).toHaveLength(0);
  });

  it('does NOT trigger keyboard typing warning during loud broadband ambient noise', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    let frame = 0;
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      frame++;
      // Loud broadband ambient noise across entire spectrum (fans, traffic, HVAC)
      for (let i = 0; i < arr.length; i++) {
        arr[i] = 42 + ((i + frame * 3) % 15);
      }
      // Periodic spikes
      if (frame === 5 || frame === 15 || frame === 25) {
        for (let i = 25; i < 110; i++) {
          arr[i] = 72;
        }
      }
    });

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-12',
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

    const typingCalls = onUnauthorizedVoiceDetected.mock.calls.filter(
      (call) => call[0]?.reason === 'Keyboard typing sounds detected.'
    );
    expect(typingCalls).toHaveLength(0);
  });

  it('does NOT trigger warning when background voice is heard for less than 8 seconds', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    let frame = 0;
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      frame++;
      for (let i = 3; i < 36; i++) {
        arr[i] = 70 + ((i * 3 + frame * 5) % 25);
      }
      arr[15] = 110;
    });

    let currentTime = 1700000000000;
    vi.spyOn(Date, 'now').mockImplementation(() => currentTime);

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-under-8s',
        stream: fakeStream,
        isAiSpeaking: false,
        isCandidateTurn: true,
        isCandidateMouthMoving: false,
        readingGracePeriodMs: 0,
        onUnauthorizedVoiceDetected,
      })
    );

    // Run only 240 frames (~4.0s, well below the 8 to 10 second requirement)
    for (let f = 0; f < 240; f++) {
      currentTime += 16.66;
      if (rafCallback) {
        const cb = rafCallback;
        rafCallback = null;
        cb(currentTime);
      }
    }

    expect(onUnauthorizedVoiceDetected).not.toHaveBeenCalled();
  });

  it('triggers a second warning after a break of 10 sec if voice continues to be heard', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    let frame = 0;
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      frame++;
      for (let i = 3; i < 36; i++) {
        arr[i] = 72 + ((i * 2 + frame * 3) % 20);
      }
      arr[15] = 105;
    });

    let currentTime = 1700000000000;
    vi.spyOn(Date, 'now').mockImplementation(() => currentTime);

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-10s-cooldown',
        stream: fakeStream,
        isAiSpeaking: false,
        isCandidateTurn: true,
        isCandidateMouthMoving: false,
        readingGracePeriodMs: 0,
        onUnauthorizedVoiceDetected,
      })
    );

    // 1. First continuous voice for 500 frames (~8.3s)
    for (let f = 0; f < 500; f++) {
      currentTime += 16.66;
      if (rafCallback) {
        const cb = rafCallback;
        rafCallback = null;
        cb(currentTime);
      }
    }

    expect(onUnauthorizedVoiceDetected).toHaveBeenCalledTimes(1);
    expect(onUnauthorizedVoiceDetected).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: 'Background voice detected' })
    );

    // 2. Voice continues during the 10-second break (e.g. 300 frames = ~5.0s into cooldown)
    for (let f = 0; f < 300; f++) {
      currentTime += 16.66;
      if (rafCallback) {
        const cb = rafCallback;
        rafCallback = null;
        cb(currentTime);
      }
    }

    // Still only 1 warning because 10-second break is active
    expect(onUnauthorizedVoiceDetected).toHaveBeenCalledTimes(1);

    // 3. Advance past the 10-second break (remaining 5.5s)
    currentTime += 5500;

    // 4. Voice continues to be heard continuously for another 8-10s (500 frames)
    for (let f = 0; f < 500; f++) {
      currentTime += 16.66;
      if (rafCallback) {
        const cb = rafCallback;
        rafCallback = null;
        cb(currentTime);
      }
    }

    // Now second warning must have triggered
    expect(onUnauthorizedVoiceDetected).toHaveBeenCalledTimes(2);
    expect(onUnauthorizedVoiceDetected).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: 'Background voice detected' })
    );
  });
});
