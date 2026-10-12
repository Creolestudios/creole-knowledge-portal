// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useAnswerRecorder } from './use-answer-recorder';

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static supportedTypes = ['audio/webm'];
  static isTypeSupported = (type: string) => FakeMediaRecorder.supportedTypes.includes(type);

  mimeType: string;
  state: 'inactive' | 'recording' = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(
    public stream: { getAudioTracks: () => unknown[] },
    options: { mimeType: string }
  ) {
    this.mimeType = options.mimeType;
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    this.state = 'recording';
  }

  stop = () => {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['spoken-audio'], { type: this.mimeType }) });
    this.onstop?.();
  };
}

class FakeMediaStream {
  constructor(private tracks: unknown[] = []) {}
  getAudioTracks() {
    return this.tracks;
  }
}

const audioTrack = { kind: 'audio' };
const streamWithAudio = { getAudioTracks: () => [audioTrack] } as unknown as MediaStream;

const mockFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true })));

beforeEach(() => {
  vi.clearAllMocks();
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.supportedTypes = ['audio/webm'];
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('MediaStream', FakeMediaStream);
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useAnswerRecorder', () => {
  it('records only the audio tracks of the existing interview stream', () => {
    const { result } = renderHook(() => useAnswerRecorder('sess-1', streamWithAudio));

    act(() => result.current.startRecording('q1'));

    expect(result.current.status).toBe('recording');
    expect(FakeMediaRecorder.instances).toHaveLength(1);

    const recorder = FakeMediaRecorder.instances[0];
    expect(recorder.state).toBe('recording');
    expect(recorder.stream.getAudioTracks()).toEqual([audioTrack]);
  });

  it('uploads the recorded answer against its question when the interview moves on', async () => {
    const { result } = renderHook(() => useAnswerRecorder('sess-1', streamWithAudio));

    act(() => result.current.startRecording('q1'));
    await act(async () => {
      await result.current.stopAndUpload();
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/interview/sess-1/answers');
    expect(init.method).toBe('POST');

    const body = init.body as FormData;
    expect(body.get('questionId')).toBe('q1');
    expect(Number(body.get('endedAtMs'))).toBeGreaterThanOrEqual(Number(body.get('startedAtMs')));
    expect((body.get('file') as Blob).size).toBeGreaterThan(0);

    expect(result.current.status).toBe('idle');
  });

  it('does nothing when asked to stop while no answer is being recorded', async () => {
    const { result } = renderHook(() => useAnswerRecorder('sess-1', streamWithAudio));

    await act(async () => {
      await result.current.stopAndUpload();
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('discards the recording without uploading when the interview is cancelled', () => {
    const { result } = renderHook(() => useAnswerRecorder('sess-1', streamWithAudio));

    act(() => result.current.startRecording('q1'));
    act(() => result.current.cancelRecording());

    expect(FakeMediaRecorder.instances[0].state).toBe('inactive');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('reports unsupported instead of throwing when the browser cannot record audio', () => {
    FakeMediaRecorder.supportedTypes = [];
    const { result } = renderHook(() => useAnswerRecorder('sess-1', streamWithAudio));

    act(() => result.current.startRecording('q1'));

    expect(result.current.status).toBe('unsupported');
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it('does not start recording when the stream has no microphone track', () => {
    const silentStream = { getAudioTracks: () => [] } as unknown as MediaStream;
    const { result } = renderHook(() => useAnswerRecorder('sess-1', silentStream));

    act(() => result.current.startRecording('q1'));

    expect(FakeMediaRecorder.instances).toHaveLength(0);
    expect(result.current.status).toBe('idle');
  });
});
