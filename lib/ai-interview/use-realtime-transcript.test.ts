// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRealtimeTranscript } from './use-realtime-transcript';

let mockInstances: any[] = [];

describe('useRealtimeTranscript', () => {
  let originalSpeechRecognition: any;
  let originalWebkitSpeechRecognition: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockInstances = [];
    originalSpeechRecognition = window.SpeechRecognition;
    originalWebkitSpeechRecognition = window.webkitSpeechRecognition;

    class MockSpeechRecognition {
      continuous = true;
      interimResults = true;
      maxAlternatives = 1;
      lang = 'en-US';
      start = vi.fn();
      stop = vi.fn();
      abort = vi.fn();
      onresult: any = null;
      onerror: any = null;
      onend: any = null;
      constructor() {
        mockInstances.push(this);
      }
    }

    window.SpeechRecognition = MockSpeechRecognition as any;
  });

  afterEach(() => {
    window.SpeechRecognition = originalSpeechRecognition;
    window.webkitSpeechRecognition = originalWebkitSpeechRecognition;
  });

  it('detects browser support correctly when SpeechRecognition is present', () => {
    const { result } = renderHook(() =>
      useRealtimeTranscript({
        interviewId: 'test-interview',
        currentQuestionOrd: 1,
        isCandidateTurn: false,
      })
    );

    expect(result.current.isSupported).toBe(true);
  });

  it('accumulates final transcript lines and notifies callback', () => {
    const onTranscriptLine = vi.fn();
    const { result } = renderHook(() =>
      useRealtimeTranscript({
        interviewId: 'test-interview',
        currentQuestionOrd: 1,
        isCandidateTurn: true,
        onTranscriptLine,
      })
    );

    const instance = mockInstances[0];
    expect(instance).toBeDefined();

    act(() => {
      instance.onresult?.({
        resultIndex: 0,
        results: [
          Object.assign([{ transcript: 'I designed the microservices architecture.' }], {
            isFinal: true,
            length: 1,
          }),
        ],
      } as any);
    });

    expect(result.current.accumulatedText).toBe('I designed the microservices architecture.');
    expect(onTranscriptLine).toHaveBeenCalledWith({
      text: 'I designed the microservices architecture.',
      isFinal: true,
    });
  });

  it('commits pending interim text on recognition onend', () => {
    const onTranscriptLine = vi.fn();
    const { result } = renderHook(() =>
      useRealtimeTranscript({
        interviewId: 'test-interview',
        currentQuestionOrd: 1,
        isCandidateTurn: true,
        onTranscriptLine,
      })
    );

    const instance = mockInstances[0];

    act(() => {
      // Incoming interim speech
      instance.onresult?.({
        resultIndex: 0,
        results: [
          Object.assign([{ transcript: 'Basically we used Redis for caching' }], {
            isFinal: false,
            length: 1,
          }),
        ],
      } as any);
    });

    expect(result.current.interimText).toBe('Basically we used Redis for caching');

    act(() => {
      // Browser stops after pause
      instance.onend?.();
    });

    // In-flight interim text is committed so speech isn't lost
    expect(result.current.accumulatedText).toContain('Basically we used Redis for caching');
    expect(onTranscriptLine).toHaveBeenCalledWith({
      text: 'Basically we used Redis for caching',
      isFinal: true,
    });
  });
});
