// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { useAudioVoiceGuard } from './use-audio-voice-guard';

describe('useAudioVoiceGuard', () => {
  let mockGetByteFrequencyData: ReturnType<typeof vi.fn>;
  let rafCallback: FrameRequestCallback | null = null;
  let rafIdCounter = 1;
  const originalNavigator = global.navigator;

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
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
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

  it('does NOT trigger internal sound warning for acoustic room music on microphone stream', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    // High harmonic tonality across musical band (bins 5 to 65) with sustained peak in room mic
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      for (let i = 5; i < 65; i++) {
        arr[i] = 38;
      }
      arr[25] = 120; // High tonality peak
    });

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-room-music-only',
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

    expect(onUnauthorizedVoiceDetected).not.toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'Internal sound / music detected. Please stop all media playback.',
      })
    );
  });

  it('triggers background music warning for room music on microphone', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    // High harmonic tonality across musical band (bins 5 to 65) with sustained peak
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      for (let i = 5; i < 65; i++) {
        arr[i] = 40;
      }
      arr[45] = 130; // High tonality peak in music band
    });

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-room-music-playback',
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
        reason: 'Background music detected',
      })
    );
  });

  it('triggers background voice warning for external AI voice on microphone', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    // Synthetic AI voice while candidate is silent: avgSpeechEnergy >= 65, peak >= 75, flat flux < 1.8
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      for (let i = 3; i < 36; i++) {
        arr[i] = 68;
      }
      arr[10] = 80; // Peak
    });

    let currentTime = 1700000000000;
    vi.spyOn(Date, 'now').mockImplementation(() => currentTime);

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-external-ai-voice',
        stream: fakeStream,
        isAiSpeaking: false,
        isCandidateTurn: true,
        isCandidateMouthMoving: false,
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

  it('triggers background voice warning for external speech / dialogue on microphone', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    // External speech / dialogue: vocal formant concentration (avg ~40, peak ~60), flux > 1.2
    let toggle = 0;
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      toggle = (toggle + 1) % 2;
      for (let i = 3; i < 36; i++) {
        arr[i] = 40 + toggle * 6;
      }
      arr[12] = 60; // Speech formant peak
    });

    let currentTime = 1700000000000;
    vi.spyOn(Date, 'now').mockImplementation(() => currentTime);

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-external-speech-dialogue',
        stream: fakeStream,
        isAiSpeaking: false,
        isCandidateTurn: true,
        isCandidateMouthMoving: false,
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

  it('triggers background music warning for room media / video soundtrack on microphone', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    // Video media: harmonic low-mid energy and music energy with peak at bin 45
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      for (let i = 5; i < 65; i++) {
        arr[i] = 36;
      }
      arr[45] = 95; // Music peak (tonality >= 2.5)
    });

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-room-soundtrack',
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
        reason: 'Background music detected',
      })
    );
  });

  it('triggers internal sound warning when device audio playback is detected on systemAudioStream', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      // System audio track active media playback
      arr.fill(32);
    });

    const fakeSysStream = {
      getAudioTracks: () => [{ kind: 'audio', readyState: 'live' }],
    } as unknown as MediaStream;

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-device-media',
        stream: fakeStream,
        systemAudioStream: fakeSysStream,
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
        reason: 'Internal sound / music detected. Please stop all media playback.',
      })
    );
  });

  it('triggers internal sound warning on systemAudioStream even when Bluetooth headset is active', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      arr.fill(28);
    });

    const fakeSysStream = {
      getAudioTracks: () => [{ kind: 'audio', readyState: 'live' }],
    } as unknown as MediaStream;

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-device-media-bluetooth',
        stream: fakeStream,
        systemAudioStream: fakeSysStream,
        isAiSpeaking: false,
        isCandidateTurn: true,
        isCandidateMouthMoving: false,
        isHeadset: true,
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
        reason: 'Internal sound / music detected. Please stop all media playback.',
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

  it('triggers warning when background speech is detected even while music is playing', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    let frame = 0;
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      frame++;
      // High harmonic tonality across musical band (bins 5 to 65)
      for (let i = 5; i < 65; i++) {
        arr[i] = 40;
      }
      arr[25] = 120; // Music tonality peak

      // Simultaneously, human speech formants are active in bins 3 to 36 with speech fluctuation
      for (let i = 3; i < 36; i++) {
        arr[i] = 65 + ((i * 2 + frame * 3) % 20);
      }
      arr[15] = 100; // Human speech formant peak
    });

    let currentTime = 1700000000000;
    vi.spyOn(Date, 'now').mockImplementation(() => currentTime);

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-voice-with-music',
        stream: fakeStream,
        isAiSpeaking: false,
        isCandidateTurn: true,
        isCandidateMouthMoving: false, // User mouth is silent, external voice speaking!
        readingGracePeriodMs: 0,
        onUnauthorizedVoiceDetected,
      })
    );

    // Run for 500 frames (~8.3s continuous)
    for (let f = 0; f < 500; f++) {
      currentTime += 16.66;
      if (rafCallback) {
        const cb = rafCallback;
        rafCallback = null;
        cb(currentTime);
      }
    }

    // Voice detection must NOT be blocked by music!
    expect(onUnauthorizedVoiceDetected).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'Background voice detected',
      })
    );
  });

  it('triggers warning when pen clicking sounds are detected', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    let frame = 0;
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      frame++;
      // Pen clicks: sharp high-frequency transient spike (bins 35-110) on frames 5 and 15, low bass body (< 20)
      if (frame === 5 || frame === 15) {
        for (let i = 35; i < 110; i++) {
          arr[i] = 60;
        }
      } else {
        arr.fill(10);
      }
    });

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-pen-clicking',
        stream: fakeStream,
        isAiSpeaking: false,
        isCandidateTurn: true,
        isCandidateMouthMoving: false,
        readingGracePeriodMs: 0,
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

    expect(onUnauthorizedVoiceDetected).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'Pen clicking / writing sounds detected.',
      })
    );
  });

  it('does NOT trigger warning for mild background sounds and ambient murmurs below elevated threshold', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    let frame = 0;
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      frame++;
      // Mild murmurs / faint noises (energy 35, peak 48, which previously triggered but must now be ignored)
      for (let i = 3; i < 36; i++) {
        arr[i] = 35 + ((i + frame) % 5);
      }
      arr[15] = 48; // Peak below 62 threshold
    });

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-mild-sounds',
        stream: fakeStream,
        isAiSpeaking: false,
        isCandidateTurn: true,
        isCandidateMouthMoving: false,
        readingGracePeriodMs: 0,
        onUnauthorizedVoiceDetected,
      })
    );

    // Run for 500 frames (~8.3s)
    let currentTime = 1700000000000;
    for (let f = 0; f < 500; f++) {
      currentTime += 16.66;
      if (rafCallback) {
        const cb = rafCallback;
        rafCallback = null;
        cb(currentTime);
      }
    }

    expect(onUnauthorizedVoiceDetected).not.toHaveBeenCalled();
  });

  it('does NOT trigger internal sound warning for sustained ambient noise on microphone', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    // Ambient noise / drone: broadband energy without musical tonality or speech formants
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      for (let i = 3; i < 36; i++) {
        arr[i] = 30;
      }
      arr[15] = 40;
    });

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-ambient-noise-no-internal',
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

    expect(onUnauthorizedVoiceDetected).not.toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'Internal sound / music detected. Please stop all media playback.',
      })
    );
  });

  it('triggers warning when alternating dialogue and soundtrack play in room', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    let frame = 0;
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      frame++;
      // Alternate between speech frame and soundtrack frame
      if (frame % 2 === 0) {
        for (let i = 3; i < 36; i++) {
          arr[i] = 36;
        }
        arr[12] = 52; // Speech formant peak
      } else {
        for (let i = 5; i < 65; i++) {
          arr[i] = 36;
        }
        arr[45] = 95; // Music tonality peak
      }
    });

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-alternating-media',
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

    expect(onUnauthorizedVoiceDetected).toHaveBeenCalled();
  });

  it('triggers background music warning when loud music plays while candidate is speaking', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    // Candidate speaking (mouth moving, avgSpeech >= 38) while loud music/soundtrack is playing in background
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      for (let i = 3; i < 36; i++) {
        arr[i] = 42;
      }
      for (let i = 5; i < 65; i++) {
        arr[i] = 34;
      }
      arr[45] = 95; // Music tonality >= 2.5
    });

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-music-while-speaking',
        stream: fakeStream,
        isAiSpeaking: false,
        isCandidateTurn: true,
        isCandidateMouthMoving: true, // Candidate mouth is moving!
        readingGracePeriodMs: 0,
        onUnauthorizedVoiceDetected,
      })
    );

    for (let f = 0; f < 55; f++) {
      if (rafCallback) {
        const cb = rafCallback;
        rafCallback = null;
        cb(performance.now());
      }
    }

    expect(onUnauthorizedVoiceDetected).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'Background music detected',
      })
    );
  });

  it('triggers device voice warning when human speech/voice is active on systemAudioStream for 10s', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    let frame = 0;
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      frame++;
      // Formant energy concentration in speech band on digital system stream
      for (let i = 3; i < 36; i++) {
        arr[i] = 30 + ((i + frame) % 10);
      }
      arr[12] = 75; // Strong vocal formant peak
    });

    const fakeSysStream = {
      getAudioTracks: () => [{ kind: 'audio', readyState: 'live' }],
    } as unknown as MediaStream;

    let currentTime = 1700000000000;
    vi.spyOn(Date, 'now').mockImplementation(() => currentTime);

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-device-voice-10s',
        stream: fakeStream,
        systemAudioStream: fakeSysStream,
        isAiSpeaking: false,
        isCandidateTurn: true,
        isCandidateMouthMoving: false,
        continuousSystemVoiceMs: 10000,
        onUnauthorizedVoiceDetected,
      })
    );

    // 620 frames at ~16.66ms = ~10,330ms (exceeds 10 seconds continuous requirement)
    for (let f = 0; f < 620; f++) {
      currentTime += 16.66;
      if (rafCallback) {
        const cb = rafCallback;
        rafCallback = null;
        cb(currentTime);
      }
    }

    expect(onUnauthorizedVoiceDetected).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'Device voice detected. Voice is playing from within the computer.',
      })
    );
  });

  it('does NOT trigger device voice warning if voice on systemAudioStream is heard for less than 10 seconds', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    let frame = 0;
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      frame++;
      for (let i = 3; i < 36; i++) {
        arr[i] = 30 + ((i + frame) % 10);
      }
      arr[12] = 75;
    });

    const fakeSysStream = {
      getAudioTracks: () => [{ kind: 'audio', readyState: 'live' }],
    } as unknown as MediaStream;

    let currentTime = 1700000000000;
    vi.spyOn(Date, 'now').mockImplementation(() => currentTime);

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-device-voice-short',
        stream: fakeStream,
        systemAudioStream: fakeSysStream,
        isAiSpeaking: false,
        isCandidateTurn: true,
        isCandidateMouthMoving: false,
        continuousSystemVoiceMs: 10000,
        onUnauthorizedVoiceDetected,
      })
    );

    // 300 frames at ~16.66ms = 5,000ms (5 seconds, well below 10 seconds)
    for (let f = 0; f < 300; f++) {
      currentTime += 16.66;
      if (rafCallback) {
        const cb = rafCallback;
        rafCallback = null;
        cb(currentTime);
      }
    }

    expect(onUnauthorizedVoiceDetected).not.toHaveBeenCalledWith(
      expect.objectContaining({
        reason: expect.stringContaining('Device voice detected'),
      })
    );
  });

  it('suppresses background voice warning when system voice is actively playing on device', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    // Both microphone and system audio receive speech data (simulating laptop speakers playing voice into room mic)
    let frame = 0;
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      frame++;
      for (let i = 3; i < 36; i++) {
        arr[i] = 50 + ((i + frame) % 10);
      }
      arr[14] = 85;
    });

    const fakeSysStream = {
      getAudioTracks: () => [{ kind: 'audio', readyState: 'live' }],
    } as unknown as MediaStream;

    let currentTime = 1700000000000;
    vi.spyOn(Date, 'now').mockImplementation(() => currentTime);

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-no-bg-voice-during-device-voice',
        stream: fakeStream,
        systemAudioStream: fakeSysStream,
        isAiSpeaking: false,
        isCandidateTurn: true,
        isCandidateMouthMoving: false,
        continuousVoiceMs: 10000,
        continuousSystemVoiceMs: 10000,
        onUnauthorizedVoiceDetected,
      })
    );

    // Run for 300 frames (~5s)
    for (let f = 0; f < 300; f++) {
      currentTime += 16.66;
      if (rafCallback) {
        const cb = rafCallback;
        rafCallback = null;
        cb(currentTime);
      }
    }

    // Microphone must NEVER have triggered "Background voice detected" for device voice!
    expect(onUnauthorizedVoiceDetected).not.toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'Background voice detected',
      })
    );
  });

  it('triggers background voice warning after 10 seconds of continuous voice on microphone', () => {
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
        interviewId: 'test-bg-voice-10s',
        stream: fakeStream,
        systemAudioStream: null, // Silent / no system stream
        isAiSpeaking: false,
        isCandidateTurn: true,
        isCandidateMouthMoving: false,
        continuousVoiceMs: 10000,
        onUnauthorizedVoiceDetected,
      })
    );

    // 620 frames at ~16.66ms = ~10,330ms (exceeds 10s)
    for (let f = 0; f < 620; f++) {
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
        durationMs: expect.any(Number),
      })
    );
  });

  it('does NOT trigger background voice warning if heard for less than 10 seconds when continuousVoiceMs is 10000', () => {
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
        interviewId: 'test-bg-voice-under-10s',
        stream: fakeStream,
        systemAudioStream: null,
        isAiSpeaking: false,
        isCandidateTurn: true,
        isCandidateMouthMoving: false,
        continuousVoiceMs: 10000,
        onUnauthorizedVoiceDetected,
      })
    );

    // 400 frames at ~16.66ms = ~6,664ms (under 10s requirement)
    for (let f = 0; f < 400; f++) {
      currentTime += 16.66;
      if (rafCallback) {
        const cb = rafCallback;
        rafCallback = null;
        cb(currentTime);
      }
    }

    expect(onUnauthorizedVoiceDetected).not.toHaveBeenCalled();
  });

  it('triggers device voice warning for acoustic speaker bleed on microphone when systemAudioStream is unavailable', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    let frame = 0;
    // Acoustic speaker bleed: low fundamental bass (bins 1-2 = 10), high mid speech (bins 6-24 = 55), high formant peak
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      frame++;
      arr[1] = 10;
      arr[2] = 10;
      for (let i = 3; i < 36; i++) {
        arr[i] = 48 + ((i * 3 + frame * 5) % 18);
      }
      arr[14] = 95; // Formant peak energy
    });

    let currentTime = 1700000000000;
    vi.spyOn(Date, 'now').mockImplementation(() => currentTime);

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-acoustic-speaker-bleed',
        stream: fakeStream,
        systemAudioStream: null, // No system audio stream (e.g. Linux Entire Screen share)
        isAiSpeaking: false,
        isCandidateTurn: true,
        isCandidateMouthMoving: false,
        continuousSystemVoiceMs: 10000,
        onUnauthorizedVoiceDetected,
      })
    );

    // 620 frames at ~16.66ms = ~10,329ms (over 10s requirement)
    for (let f = 0; f < 620; f++) {
      currentTime += 16.66;
      if (rafCallback) {
        const cb = rafCallback;
        rafCallback = null;
        cb(currentTime);
      }
    }

    expect(onUnauthorizedVoiceDetected).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'Device voice detected. Voice is playing from within the computer.',
        durationMs: expect.any(Number),
      })
    );
    expect(onUnauthorizedVoiceDetected).not.toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'Background voice detected',
      })
    );
  });

  it('does NOT trigger device voice warning for acoustic speaker bleed if heard for less than 10 seconds', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    let frame = 0;
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      frame++;
      arr[1] = 10;
      arr[2] = 10;
      for (let i = 3; i < 36; i++) {
        arr[i] = 48 + ((i * 3 + frame * 5) % 18);
      }
      arr[14] = 95;
    });

    let currentTime = 1700000000000;
    vi.spyOn(Date, 'now').mockImplementation(() => currentTime);

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-acoustic-speaker-bleed-under-10s',
        stream: fakeStream,
        systemAudioStream: null,
        isAiSpeaking: false,
        isCandidateTurn: true,
        isCandidateMouthMoving: false,
        continuousSystemVoiceMs: 10000,
        onUnauthorizedVoiceDetected,
      })
    );

    // 400 frames at ~16.66ms = ~6,664ms (under 10s requirement)
    for (let f = 0; f < 400; f++) {
      currentTime += 16.66;
      if (rafCallback) {
        const cb = rafCallback;
        rafCallback = null;
        cb(currentTime);
      }
    }

    expect(onUnauthorizedVoiceDetected).not.toHaveBeenCalled();
  });

  it('triggers device voice warning for acoustic speaker bleed with chassis resonance (fundamentalBassEnergy = 35) without false background voice', () => {
    const onUnauthorizedVoiceDetected = vi.fn();

    let frame = 0;
    // Real laptop speaker bleed: chassis conduction causes bass bins 1-2 to reach ~35, while mid-speech formants are ~50
    mockGetByteFrequencyData = vi.fn((arr: Uint8Array) => {
      frame++;
      arr[1] = 35;
      arr[2] = 35;
      for (let i = 3; i < 36; i++) {
        arr[i] = 48 + ((i * 3 + frame * 5) % 18);
      }
      arr[14] = 95; // Formant peak energy
    });

    let currentTime = 1700000000000;
    vi.spyOn(Date, 'now').mockImplementation(() => currentTime);

    renderHook(() =>
      useAudioVoiceGuard({
        interviewId: 'test-acoustic-chassis-resonance',
        stream: fakeStream,
        systemAudioStream: null,
        isAiSpeaking: false,
        isCandidateTurn: true,
        isCandidateMouthMoving: false,
        continuousSystemVoiceMs: 10000,
        continuousVoiceMs: 10000,
        onUnauthorizedVoiceDetected,
      })
    );

    // 620 frames at ~16.66ms = ~10,329ms
    for (let f = 0; f < 620; f++) {
      currentTime += 16.66;
      if (rafCallback) {
        const cb = rafCallback;
        rafCallback = null;
        cb(currentTime);
      }
    }

    expect(onUnauthorizedVoiceDetected).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'Device voice detected. Voice is playing from within the computer.',
      })
    );
    expect(onUnauthorizedVoiceDetected).not.toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'Background voice detected',
      })
    );
  });
});

