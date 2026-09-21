'use client';

import { useEffect, useRef, type RefObject } from 'react';

export const PROCTORING_REASONS = {
  pageHidden: 'You switched tabs or minimized the window during the interview.',
  cameraEnded: 'Your webcam or microphone was turned off during the interview.',
  screenShareEnded: 'Screen sharing was stopped during the interview.',
} as const;

interface UseProctoringWatchdogArgs {
  /** Arm the watchdog only while the candidate is actually in the interview. */
  active: boolean;
  cameraStreamRef: RefObject<MediaStream | null>;
  screenStreamRef: RefObject<MediaStream | null>;
  onViolation: (reason: string) => void;
}

/**
 * Watches for the candidate leaving the interview (tab switch / window
 * minimize) or killing one of the required media streams.
 *
 * Detection deliberately relies on the Page Visibility API alone. `document`
 * focus is NOT a usable signal here: with a full-screen share running, Chrome's
 * "you are sharing your screen" indicator takes keyboard focus, so
 * `document.hasFocus()` reports false while the page is still fully visible in
 * front of the candidate. Polling it terminated healthy sessions seconds after
 * joining. Clicking the address bar, a permission bubble or devtools has the
 * same effect. `visibilityState`, by contrast, flips to 'hidden' for exactly
 * the two cases we want — a tab switch and a window minimize — and for neither
 * of the focus cases above.
 */
export function useProctoringWatchdog({
  active,
  cameraStreamRef,
  screenStreamRef,
  onViolation,
}: UseProctoringWatchdogArgs) {
  // The pages rebuild `onViolation` on every render; holding it in a ref keeps
  // the effect subscribed once per session instead of re-binding every track
  // listener each time the candidate types an answer.
  const onViolationRef = useRef(onViolation);
  useEffect(() => {
    onViolationRef.current = onViolation;
  });

  useEffect(() => {
    if (!active) return;

    const report = (reason: string) => onViolationRef.current(reason);

    const onVisibilityChange = () => {
      if (document.hidden) report(PROCTORING_REASONS.pageHidden);
    };
    const onCameraEnded = () => report(PROCTORING_REASONS.cameraEnded);
    const onScreenShareEnded = () => report(PROCTORING_REASONS.screenShareEnded);

    // Captured once so cleanup detaches from the same tracks it attached to —
    // terminating nulls the stream refs, so re-reading them here would silently
    // skip removal.
    const cameraTracks = cameraStreamRef.current?.getTracks() ?? [];
    const screenTracks = screenStreamRef.current?.getTracks() ?? [];

    document.addEventListener('visibilitychange', onVisibilityChange);
    cameraTracks.forEach((track) => track.addEventListener('ended', onCameraEnded));
    screenTracks.forEach((track) => track.addEventListener('ended', onScreenShareEnded));

    // The candidate may already have left between joining and this effect running.
    if (document.hidden) report(PROCTORING_REASONS.pageHidden);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      cameraTracks.forEach((track) => track.removeEventListener('ended', onCameraEnded));
      screenTracks.forEach((track) => track.removeEventListener('ended', onScreenShareEnded));
    };
  }, [active, cameraStreamRef, screenStreamRef]);
}
