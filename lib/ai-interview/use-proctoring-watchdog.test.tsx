// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { useProctoringWatchdog, PROCTORING_REASONS } from './use-proctoring-watchdog';

function trackStub() {
  const listeners = new Map<string, () => void>();
  return {
    kind: 'video',
    readyState: 'live',
    stop: vi.fn(),
    addEventListener: (event: string, cb: () => void) => listeners.set(event, cb),
    removeEventListener: (event: string) => listeners.delete(event),
    fire: (event: string) => listeners.get(event)?.(),
    hasListener: (event: string) => listeners.has(event),
  };
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
}

interface HarnessProps {
  active: boolean;
  cameraTracks?: ReturnType<typeof trackStub>[];
  screenTracks?: ReturnType<typeof trackStub>[];
  onViolation: (reason: string) => void;
}

function Harness({ active, cameraTracks = [], screenTracks = [], onViolation }: HarnessProps) {
  const cameraStreamRef = useRef({ getTracks: () => cameraTracks } as unknown as MediaStream);
  const screenStreamRef = useRef({ getTracks: () => screenTracks } as unknown as MediaStream);
  useProctoringWatchdog({ active, cameraStreamRef, screenStreamRef, onViolation });
  return null;
}

afterEach(() => {
  cleanup();
  setHidden(false);
});

describe('useProctoringWatchdog', () => {
  it('reports a violation when the page becomes hidden', () => {
    const onViolation = vi.fn();
    render(<Harness active onViolation={onViolation} />);

    setHidden(true);
    fireEvent(document, new Event('visibilitychange'));

    expect(onViolation).toHaveBeenCalledWith(PROCTORING_REASONS.pageHidden);
  });

  it('ignores a visibilitychange that leaves the page visible', () => {
    const onViolation = vi.fn();
    render(<Harness active onViolation={onViolation} />);

    setHidden(false);
    fireEvent(document, new Event('visibilitychange'));

    expect(onViolation).not.toHaveBeenCalled();
  });

  it('does nothing while inactive', () => {
    const onViolation = vi.fn();
    render(<Harness active={false} onViolation={onViolation} />);

    setHidden(true);
    fireEvent(document, new Event('visibilitychange'));

    expect(onViolation).not.toHaveBeenCalled();
  });

  it('reports immediately when the page is already hidden as it arms', () => {
    const onViolation = vi.fn();
    setHidden(true);

    render(<Harness active onViolation={onViolation} />);

    expect(onViolation).toHaveBeenCalledWith(PROCTORING_REASONS.pageHidden);
  });

  it('reports the camera and screen-share tracks ending separately', () => {
    const onViolation = vi.fn();
    const cameraTrack = trackStub();
    const screenTrack = trackStub();
    render(
      <Harness
        active
        cameraTracks={[cameraTrack]}
        screenTracks={[screenTrack]}
        onViolation={onViolation}
      />,
    );

    cameraTrack.fire('ended');
    expect(onViolation).toHaveBeenCalledWith(PROCTORING_REASONS.cameraEnded);

    screenTrack.fire('ended');
    expect(onViolation).toHaveBeenCalledWith(PROCTORING_REASONS.screenShareEnded);
  });

  it('detaches every listener on unmount', () => {
    const cameraTrack = trackStub();
    const screenTrack = trackStub();
    const onViolation = vi.fn();
    const { unmount } = render(
      <Harness
        active
        cameraTracks={[cameraTrack]}
        screenTracks={[screenTrack]}
        onViolation={onViolation}
      />,
    );

    unmount();

    expect(cameraTrack.hasListener('ended')).toBe(false);
    expect(screenTrack.hasListener('ended')).toBe(false);

    setHidden(true);
    fireEvent(document, new Event('visibilitychange'));
    expect(onViolation).not.toHaveBeenCalled();
  });
});
