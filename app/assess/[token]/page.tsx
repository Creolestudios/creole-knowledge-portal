'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  KeyRound,
  Loader2,
  AlertCircle,
  Camera,
  Mic,
  MonitorUp,
  CheckCircle2,
  ListChecks,
  ShieldAlert,
  ArrowRight,
} from 'lucide-react';
import { MeetingVideoTile } from '@/components/ai-interview/meeting-video-tile';
import { MeetingControlBar } from '@/components/ai-interview/meeting-control-bar';
import { DeviceSettingsPanel } from '@/components/ai-interview/device-settings-panel';
import { useProctoringWatchdog } from '@/lib/ai-interview/use-proctoring-watchdog';

type Stage = 'passcode' | 'instructions' | 'permissions' | 'ready' | 'interview' | 'completed' | 'terminated';

interface AssessQuestion {
  id: string;
  question_text: string;
  question_type: string;
  category: string;
  difficulty: string;
  question_order: number;
  time_limit_sec: number;
  is_mandatory_hr: boolean;
}

import { ProctoringInstructions } from '@/components/ai-interview/proctoring-instructions';
import { TerminatedInterview } from '@/components/ai-interview/terminated-interview';

export default function CandidateAssessmentPage() {
  const params = useParams();
  const token = params?.token as string;

  const [stage, setStage] = useState<Stage>('passcode');

  const [passcode, setPasscode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [questions, setQuestions] = useState<AssessQuestion[]>([]);
  const [candidateName, setCandidateName] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answerText, setAnswerText] = useState('');
  const [savingAnswer, setSavingAnswer] = useState(false);
  const questionStartedAtRef = useRef<number>(0);
  const firstKeystrokeAtRef = useRef<number | null>(null);

  const [cameraGranted, setCameraGranted] = useState(false);
  const [screenGranted, setScreenGranted] = useState(false);
  const [requestingPermissions, setRequestingPermissions] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const [terminationReason, setTerminationReason] = useState<string | null>(null);

  const [micOn, setMicOn] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The video tiles/settings panel need this for rendering, and reading a
  // ref's `.current` during render isn't allowed — so the stream is mirrored
  // into state on every assignment below. `cameraStreamRef` stays the
  // source of truth for handlers/effects (the proctoring watchdog, cleanup)
  // that must always see the latest stream without re-subscribing.
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const terminatedRef = useRef(false);

  const stopAllMedia = () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    screenStreamRef.current = null;
    setCameraStream(null);
  };

  const notifyTermination = (reason: string) => {
    const payload = JSON.stringify({ reason });
    const url = `/api/assess/${token}/terminate`;
    // sendBeacon survives the tab closing/hiding right after this fires — a plain
    // fetch can be cancelled mid-flight when the page is torn down at the same time.
    if (navigator.sendBeacon) {
      const sent = navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
      if (sent) return;
    }
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch((err) => console.error('[assess] terminate notify failed:', err));
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

  const handleSubmitPasscode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch(`/api/assess/${token}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode }),
      });
      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? 'Verification failed');
        return;
      }

      setQuestions(json.questions ?? []);
      setCandidateName(json.candidate_name ?? null);
      setStage('instructions');
    } catch (err) {
      console.error('[assess] verify failed:', err);
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
        const newCameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        cameraStreamRef.current = newCameraStream;
        setCameraStream(newCameraStream);
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
      console.error('[assess] permission request failed:', err);
      setPermissionError(
        hasLiveCameraStream()
          ? 'Screen sharing was cancelled or denied. Please share your entire screen to continue.'
          : 'Camera, microphone, and full-screen sharing are all required to start this interview.',
      );
    } finally {
      setRequestingPermissions(false);
    }
  };

  const handleToggleMic = () => {
    const audioTracks = cameraStreamRef.current?.getAudioTracks() ?? [];
    const nextMicOn = !micOn;
    audioTracks.forEach((track) => {
      track.enabled = nextMicOn;
    });
    setMicOn(nextMicOn);
  };

  // Only offered from the pre-join 'ready' lobby — switching devices mid-interview
  // would mean re-wiring the proctoring watchdog's track 'ended' listeners onto a
  // brand-new MediaStreamTrack, which isn't worth the fragility for this control.
  const handleApplyDeviceSelection = async ({
    videoDeviceId,
    audioDeviceId,
  }: {
    videoDeviceId: string;
    audioDeviceId: string;
  }) => {
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: videoDeviceId } },
      audio: { deviceId: { exact: audioDeviceId } },
    });
    newStream.getAudioTracks().forEach((track) => {
      track.enabled = micOn;
    });
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = newStream;
    setCameraStream(newStream);
  };

  const handleJoinInterview = () => {
    questionStartedAtRef.current = Date.now();
    setStage('interview');
  };

  useProctoringWatchdog({
    active: stage === 'interview',
    cameraStreamRef,
    screenStreamRef,
    onViolation: terminateInterview,
  });

  const currentQuestion = questions[currentIndex];

  const handleAnswerChange = (value: string) => {
    if (firstKeystrokeAtRef.current === null && value.length > 0) {
      firstKeystrokeAtRef.current = Date.now();
    }
    setAnswerText(value);
  };

  const handleSubmitAnswer = async () => {
    if (!currentQuestion) return;
    setSavingAnswer(true);

    const totalTimeTakenSec = (Date.now() - questionStartedAtRef.current) / 1000;
    const timeToFirstResponseSec = firstKeystrokeAtRef.current
      ? (firstKeystrokeAtRef.current - questionStartedAtRef.current) / 1000
      : totalTimeTakenSec;

    try {
      const answerRes = await fetch(`/api/assess/${token}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_id: currentQuestion.id,
          transcript: answerText,
          time_to_first_response_sec: timeToFirstResponseSec,
          total_time_taken_sec: totalTimeTakenSec,
        }),
      });
      if (!answerRes.ok) {
        const answerJson = await answerRes.json().catch(() => null);
        throw new Error(answerJson?.error ?? 'Failed to save your answer.');
      }

      const isLastQuestion = currentIndex >= questions.length - 1;
      if (isLastQuestion) {
        const completeRes = await fetch(`/api/assess/${token}/complete`, { method: 'POST' });
        if (!completeRes.ok) {
          const completeJson = await completeRes.json().catch(() => null);
          throw new Error(completeJson?.error ?? 'Failed to complete the interview.');
        }
        stopAllMedia();
        setStage('completed');
      } else {
        setAnswerText('');
        firstKeystrokeAtRef.current = null;
        questionStartedAtRef.current = Date.now();
        setCurrentIndex((idx) => idx + 1);
      }
    } catch (err) {
      console.error('[assess] failed to save answer:', err);
      setError(err instanceof Error ? err.message : 'Failed to save your answer. Please try again.');
    } finally {
      setSavingAnswer(false);
    }
  };

  if (stage === 'terminated') {
    return <TerminatedInterview terminationReason={terminationReason} />;
  }

  if (stage === 'completed') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#f8f9fa] px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-card border border-zinc-100 p-8 text-center space-y-4">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
          <h1 className="text-xl font-bold text-zinc-900">Interview complete</h1>
          <p className="text-sm text-zinc-500">
            Thank you{candidateName ? `, ${candidateName}` : ''}. Your responses have been
            submitted. You may close this tab now.
          </p>
        </div>
      </main>
    );
  }

  if (stage === 'interview') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#f8f9fa] px-4 py-10">
        {/* Persistent self-view + controls, Meet/Zoom-style, throughout the call */}
        <div className="fixed bottom-4 right-4 z-40 flex flex-col items-center gap-2">
          <MeetingVideoTile stream={cameraStream} micOn={micOn} size="small" />
          <MeetingControlBar micOn={micOn} onToggleMic={handleToggleMic} settingsEnabled={false} />
        </div>

        <div className="max-w-2xl w-full bg-white rounded-2xl shadow-card border border-zinc-100 p-8 space-y-6">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
              Question {currentIndex + 1} of {questions.length}
            </span>
            <span className="text-xs font-semibold uppercase tracking-[0.15em] px-2.5 py-1 rounded-full bg-[#34c4f2]/10 text-[#0c7ea6]">
              {currentQuestion?.category?.replaceAll('_', ' ')}
            </span>
          </div>

          <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            Stay on this tab and keep your camera, microphone, and screen share on — switching
            tabs, minimizing the window, or stopping any of them will immediately end your
            interview.
          </p>

          <h2 className="text-lg font-bold text-zinc-900">{currentQuestion?.question_text}</h2>

          <textarea
            id="assess-answer-textarea"
            value={answerText}
            onChange={(e) => handleAnswerChange(e.target.value)}
            rows={8}
            placeholder="Type your answer here..."
            className="w-full text-sm p-4 bg-zinc-50 border border-zinc-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#34c4f2] text-zinc-900"
          />

          {error && (
            <div className="flex items-center space-x-2 p-4 text-sm text-red-600 bg-red-50 rounded-xl border border-red-100">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <p className="font-medium">{error}</p>
            </div>
          )}

          <button
            id="assess-submit-answer"
            type="button"
            onClick={handleSubmitAnswer}
            disabled={savingAnswer || answerText.trim().length === 0}
            className="w-full bg-[#34c4f2] hover:bg-[#2db0db] text-zinc-900 font-black py-4 rounded-2xl transition-all shadow-xl shadow-[#34c4f2]/30 flex items-center justify-center space-x-3 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-[0.2em] text-sm"
          >
            {savingAnswer ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <span>{currentIndex >= questions.length - 1 ? 'Finish Interview' : 'Next Question'}</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </main>
    );
  }

  if (stage === 'instructions' || stage === 'permissions') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#f8f9fa] px-4 py-10">
        <ProctoringInstructions
          cameraGranted={cameraGranted}
          screenGranted={screenGranted}
          permissionError={permissionError}
          requestingPermissions={requestingPermissions}
          onRequestPermissions={requestPermissions}
        />
      </main>
    );
  }

  if (stage === 'ready') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#0b0f14] px-4 py-10">
        <div className="max-w-lg w-full space-y-5">
          <div className="text-center space-y-1">
            <h1 className="text-xl font-bold text-white">You&apos;re ready to join</h1>
            <p className="text-sm text-zinc-400">
              Check how you look and sound below, then join when you&apos;re ready.
            </p>
          </div>

          <MeetingVideoTile stream={cameraStream} micOn={micOn} size="large" />

          <MeetingControlBar
            micOn={micOn}
            onToggleMic={handleToggleMic}
            onOpenSettings={() => setSettingsOpen(true)}
            settingsEnabled
          />

          <button
            id="assess-join-interview"
            type="button"
            onClick={handleJoinInterview}
            className="w-full bg-[#34c4f2] hover:bg-[#2db0db] text-zinc-900 font-black py-4 rounded-2xl transition-all shadow-xl shadow-[#34c4f2]/30 flex items-center justify-center space-x-3 active:scale-[0.98] uppercase tracking-[0.2em] text-sm"
          >
            <span>Join Interview</span>
          </button>
        </div>

        {settingsOpen && (
          <DeviceSettingsPanel
            currentCameraId={cameraStream?.getVideoTracks()[0]?.getSettings().deviceId ?? null}
            currentMicId={cameraStream?.getAudioTracks()[0]?.getSettings().deviceId ?? null}
            onClose={() => setSettingsOpen(false)}
            onApply={handleApplyDeviceSelection}
          />
        )}
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#f8f9fa] px-4">
      <form
        onSubmit={handleSubmitPasscode}
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
          id="assess-passcode-input"
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={passcode}
          onChange={(e) => setPasscode(e.target.value.replace(/\D/g, ''))}
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
          id="assess-verify-submit"
          type="submit"
          disabled={submitting || passcode.length !== 6}
          className="w-full bg-[#34c4f2] hover:bg-[#2db0db] text-zinc-900 font-black py-4 rounded-2xl transition-all shadow-xl shadow-[#34c4f2]/30 flex items-center justify-center space-x-3 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-[0.2em] text-sm"
        >
          {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <span>Continue</span>}
        </button>
      </form>
    </main>
  );
}
