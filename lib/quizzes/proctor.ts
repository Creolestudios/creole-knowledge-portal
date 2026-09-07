/**
 * Client-only quiz monitoring helpers (screen share + camera locks).
 * Does not change scoring, evaluation, or attempt limits.
 *
 * Policy (enforced in QuizRunner):
 * - Setup: entire screen → camera → instructions → start
 * - Stop screen OR camera mid-quiz → warning + halt until restored
 * - Leave tab once → auto-submit via existing finish API
 */

export const ENTIRE_SCREEN_REQUIRED_MESSAGE =
  'Please share your entire screen (not a window or browser tab) to start the quiz.';

export const SCREEN_SHARE_UNSUPPORTED_MESSAGE =
  'Screen sharing is not supported in this browser. Please use a desktop browser to take the quiz.';

export const CAMERA_REQUIRED_MESSAGE =
  'Camera access is required to take the quiz. Please allow camera permission and try again.';

export const CAMERA_UNSUPPORTED_MESSAGE =
  'Camera access is not supported in this browser. Please use a desktop browser with a webcam.';

type DisplaySurface = 'monitor' | 'window' | 'browser' | string;

function stopStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

export function isEntireScreenTrack(track: MediaStreamTrack): boolean {
  const surface = (track.getSettings() as { displaySurface?: DisplaySurface }).displaySurface;
  // Some browsers omit displaySurface; only reject when we know it is not a monitor.
  if (!surface) return true;
  return surface === 'monitor';
}

/**
 * Prompt the user to share their display. Rejects window/tab shares when the
 * browser reports displaySurface.
 */
export async function requestEntireScreenShare(): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
    throw new Error(SCREEN_SHARE_UNSUPPORTED_MESSAGE);
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      frameRate: 5,
      // Chrome/Edge hint — user can still pick a window; we verify below.
      displaySurface: 'monitor',
    } as MediaTrackConstraints,
    audio: false,
  });

  const track = stream.getVideoTracks()[0];
  if (!track || !isEntireScreenTrack(track)) {
    stopStream(stream);
    throw new Error(ENTIRE_SCREEN_REQUIRED_MESSAGE);
  }

  return stream;
}

/** Prompt for webcam (video only). Used as a live lock — not recorded in this step. */
export async function requestCameraAccess(): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error(CAMERA_UNSUPPORTED_MESSAGE);
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' },
      audio: false,
    });
  } catch {
    throw new Error(CAMERA_REQUIRED_MESSAGE);
  }
}

export function stopMediaStream(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  stopStream(stream);
}

export function stopScreenShare(stream: MediaStream | null | undefined): void {
  stopMediaStream(stream);
}
