'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  KeyRound,
  Loader2,
  AlertCircle,
  ShieldCheck,
  Camera,
  Mic,
  MonitorUp,
  CheckCircle2,
  ListChecks,
  ShieldAlert,
} from 'lucide-react';

type Stage = 'passcode' | 'instructions' | 'permissions' | 'ready' | 'terminated';

const INSTRUCTIONS = [
  'Find a quiet, well-lit room and sit facing your camera for the full duration of the interview.',
  'Keep your webcam, microphone, and screen-share on at all times — the session cannot continue if any of them is turned off.',
  'Do not switch tabs, minimize the window, or open other applications during the interview.',
  'Ensure a stable internet connection before you begin; the session cannot be paused once started.',
  'Answer every question yourself — the use of external help or additional devices is not permitted.',
];

export default function InterviewEntryPage() {
  const params = useParams();
  const interviewId = params?.id as string;

  const [stage, setStage] = useState<Stage>('passcode');

  const [accessCode, setAccessCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [cameraGranted, setCameraGranted] = useState(false);
  const [screenGranted, setScreenGranted] = useState(false);
  const [requestingPermissions, setRequestingPermissions] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const [terminationReason, setTerminationReason] = useState<string | null>(null);

  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const terminatedRef = useRef(false);

  const stopAllMedia = () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    screenStreamRef.current = null;
  };

  const notifyTermination = (reason: string) => {
    const payload = JSON.stringify({ interviewId, reason });
    // sendBeacon survives the tab closing/hiding right after this fires — a plain
    // fetch can be cancelled mid-flight when the page is torn down at the same time.
    if (navigator.sendBeacon) {
      const sent = navigator.sendBeacon(
        '/api/interview/terminate',
        new Blob([payload], { type: 'application/json' }),
      );
      if (sent) return;
    }
    fetch('/api/interview/terminate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch((err) => console.error('[interview-entry] terminate notify failed:', err));
  };

  const terminateInterview = (reason: string) => {
    if (terminatedRef.current) return;
    terminatedRef.current = true;
    stopAllMedia();
    notifyTermination(reason);
    setTerminationReason(reason);
    setStage('terminated');
  };

  // Release any granted devices if the candidate navigates away before finishing setup.
  useEffect(() => {
    return () => {
      stopAllMedia();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/interview/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interviewId, accessCode }),
      });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? 'Verification failed');
        return;
      }

      setStage('instructions');
    } catch (err) {
      console.error('[interview-entry] verify failed:', err);
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const hasLiveCameraStream = () =>
    (cameraStreamRef.current?.getTracks().length ?? 0) > 0 &&
    cameraStreamRef.current!.getTracks().every((track) => track.readyState === 'live');

  const requestPermissions = async () => {
    setPermissionError(null);
    setRequestingPermissions(true);

    try {
      // Don't re-prompt for (and re-acquire) camera/mic on a screen-share retry —
      // the already-granted stream is still live and reusable. It's released on
      // unmount (see effect above) or when the interview terminates, never left
      // dangling indefinitely.
      if (!hasLiveCameraStream()) {
        const cameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        cameraStreamRef.current = cameraStream;
        setCameraGranted(true);
      }

      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const [videoTrack] = screenStream.getVideoTracks();
      const displaySurface = videoTrack?.getSettings().displaySurface;
      // Some browsers (Firefox, Safari) don't report displaySurface at all — only
      // hard-block when we can positively confirm a partial (window/tab) share.
      const isPartialShare = displaySurface !== undefined && displaySurface !== 'monitor';

      if (isPartialShare) {
        screenStream.getTracks().forEach((track) => track.stop());
        setScreenGranted(false);
        setPermissionError('Please share your entire screen, not a window or tab, to continue.');
        return;
      }

      screenStreamRef.current = screenStream;
      setScreenGranted(true);
      setStage('ready');
    } catch (err) {
      console.error('[interview-entry] permission request failed:', err);
      setPermissionError(
        hasLiveCameraStream()
          ? 'Screen sharing was cancelled or denied. Please share your entire screen to continue.'
          : 'Camera, microphone, and full-screen sharing are all required to start this interview.',
      );
    } finally {
      setRequestingPermissions(false);
    }
  };

  useEffect(() => {
    if (stage !== 'ready') return;

    const onVisibilityChange = () => {
      if (document.hidden) {
        terminateInterview('You switched tabs or minimized the window during the interview.');
      }
    };
    // `visibilitychange` alone isn't enough: Chrome derives `document.hidden`
    // partly from OS-level window-occlusion tracking, which doesn't reliably
    // fire when a candidate switches to a *separate browser window* (common on
    // multi-monitor setups, remote desktop/VDI, or some window managers) —
    // only same-window tab switches are guaranteed to flip it. Poll focus as a
    // backup signal, requiring two consecutive misses (~1.2s apart) before
    // terminating. The watchdog only starts counting after a grace period:
    // right after `getDisplayMedia` resolves, Chrome's native share picker
    // closing and the "you are sharing your screen" indicator bar appearing
    // cause a genuine, transient OS focus dip with no user action involved —
    // without the grace period that reads as a false "tab switch".
    const armedAt = Date.now() + 2500;
    let missedFocusChecks = 0;
    const focusWatchdog = window.setInterval(() => {
      if (Date.now() < armedAt) return;
      if (document.hidden || !document.hasFocus()) {
        missedFocusChecks += 1;
        if (missedFocusChecks >= 2) {
          terminateInterview('You switched tabs or minimized the window during the interview.');
        }
      } else {
        missedFocusChecks = 0;
      }
    }, 600);
    const onCameraEnded = () => {
      terminateInterview('Your webcam or microphone was turned off during the interview.');
    };
    const onScreenEnded = () => {
      terminateInterview('Screen sharing was stopped during the interview.');
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    cameraStreamRef.current?.getTracks().forEach((track) => {
      track.addEventListener('ended', onCameraEnded);
    });
    screenStreamRef.current?.getTracks().forEach((track) => {
      track.addEventListener('ended', onScreenEnded);
    });

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(focusWatchdog);
      cameraStreamRef.current?.getTracks().forEach((track) => {
        track.removeEventListener('ended', onCameraEnded);
      });
      screenStreamRef.current?.getTracks().forEach((track) => {
        track.removeEventListener('ended', onScreenEnded);
      });
    };
  }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps -- terminateInterview is redefined each render but only needs the latest streams/refs, not re-subscription

  if (stage === 'terminated') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#f8f9fa] px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-card border border-red-100 p-8 text-center space-y-4">
          <ShieldAlert className="w-10 h-10 text-red-500 mx-auto" />
          <h1 className="text-xl font-bold text-zinc-900">Interview terminated</h1>
          <p className="text-sm text-zinc-500">
            {terminationReason ?? 'A monitoring rule was violated.'}
          </p>
          <p className="text-xs text-zinc-400">
            This session has ended and cannot be resumed. Please contact your interviewer if you
            believe this was a mistake.
          </p>
        </div>
      </main>
    );
  }

  if (stage === 'ready') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#f8f9fa] px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-card border border-zinc-100 p-8 text-center space-y-4">
          <ShieldCheck className="w-10 h-10 text-emerald-500 mx-auto" />
          <h1 className="text-xl font-bold text-zinc-900">You&apos;re verified</h1>
          <p className="text-sm text-zinc-500">
            Your interview session will start here. This step is coming in the next phase.
          </p>
          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            Stay on this tab and keep your camera, microphone, and screen share on — switching
            tabs, minimizing the window, or stopping any of them will immediately end your
            interview.
          </p>
        </div>
      </main>
    );
  }

  if (stage === 'instructions' || stage === 'permissions') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#f8f9fa] px-4 py-10">
        <div className="max-w-lg w-full bg-white rounded-2xl shadow-card border border-zinc-100 p-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 bg-[#34c4f2]/10 rounded-xl flex items-center justify-center mx-auto">
              <ListChecks className="w-6 h-6 text-[#34c4f2]" />
            </div>
            <h1 className="text-xl font-bold text-zinc-900">Before you begin</h1>
            <p className="text-sm text-zinc-500">
              Please read the instructions below, then grant the required permissions.
            </p>
          </div>

          <ul className="space-y-3">
            {INSTRUCTIONS.map((instruction) => (
              <li key={instruction} className="flex items-start space-x-3 text-sm text-zinc-700">
                <CheckCircle2 className="w-4 h-4 text-[#34c4f2] flex-shrink-0 mt-0.5" />
                <span>{instruction}</span>
              </li>
            ))}
          </ul>

          <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-4 space-y-3">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              Required permissions
            </p>
            <div className="flex items-center justify-between text-sm text-zinc-700">
              <span className="flex items-center space-x-2">
                <Camera className="w-4 h-4" />
                <Mic className="w-4 h-4" />
                <span>Webcam &amp; microphone</span>
              </span>
              {cameraGranted ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              ) : (
                <span className="text-xs text-zinc-400">Not granted</span>
              )}
            </div>
            <div className="flex items-center justify-between text-sm text-zinc-700">
              <span className="flex items-center space-x-2">
                <MonitorUp className="w-4 h-4" />
                <span>Entire screen share</span>
              </span>
              {screenGranted ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              ) : (
                <span className="text-xs text-zinc-400">Not granted</span>
              )}
            </div>
          </div>

          {permissionError && (
            <div className="flex items-center space-x-2 p-4 text-sm text-red-600 bg-red-50 rounded-xl border border-red-100">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <p className="font-medium">{permissionError}</p>
            </div>
          )}

          <button
            id="interview-request-permissions"
            type="button"
            onClick={requestPermissions}
            disabled={requestingPermissions}
            className="w-full bg-[#34c4f2] hover:bg-[#2db0db] text-zinc-900 font-black py-4 rounded-2xl transition-all shadow-xl shadow-[#34c4f2]/30 flex items-center justify-center space-x-3 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-[0.2em] text-sm"
          >
            {requestingPermissions ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <span>Allow &amp; Start Interview</span>
            )}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#f8f9fa] px-4">
      <form
        onSubmit={handleSubmit}
        className="max-w-md w-full bg-white rounded-2xl shadow-card border border-zinc-100 p-8 space-y-6"
      >
        <div className="text-center space-y-2">
          <div className="w-12 h-12 bg-[#34c4f2]/10 rounded-xl flex items-center justify-center mx-auto">
            <KeyRound className="w-6 h-6 text-[#34c4f2]" />
          </div>
          <h1 className="text-xl font-bold text-zinc-900">Enter your passcode</h1>
          <p className="text-sm text-zinc-500">
            Enter the 6-digit passcode shared with you to start your interview.
          </p>
        </div>

        <input
          id="interview-access-code"
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={accessCode}
          onChange={(e) => setAccessCode(e.target.value.replace(/\D/g, ''))}
          placeholder="000000"
          className="w-full text-center text-2xl font-black tracking-[0.4em] py-4 bg-zinc-50 border border-zinc-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#34c4f2] text-zinc-900"
        />

        {error && (
          <div className="flex items-center space-x-2 p-4 text-sm text-red-600 bg-red-50 rounded-xl border border-red-100">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p className="font-medium">{error}</p>
          </div>
        )}

        <button
          id="interview-verify-submit"
          type="submit"
          disabled={submitting || accessCode.length !== 6}
          className="w-full bg-[#34c4f2] hover:bg-[#2db0db] text-zinc-900 font-black py-4 rounded-2xl transition-all shadow-xl shadow-[#34c4f2]/30 flex items-center justify-center space-x-3 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-[0.2em] text-sm"
        >
          {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <span>Continue</span>}
        </button>
      </form>
    </main>
  );
}
