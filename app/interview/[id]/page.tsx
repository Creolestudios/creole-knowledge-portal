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
  AlertTriangle,
} from 'lucide-react';
import { CalibrationModal } from '@/components/ai-interview/CalibrationModal';
import { CandidateBaseline, ProctoringTimeTracker, ExtendedFaceTrackingResult } from '@/lib/ai-interview/face-tracking';
import { MeetingVideoTile } from '@/components/ai-interview/meeting-video-tile';
import { MeetingControlBar } from '@/components/ai-interview/meeting-control-bar';
import { DeviceSettingsPanel } from '@/components/ai-interview/device-settings-panel';
import { useProctoringWatchdog } from '@/lib/ai-interview/use-proctoring-watchdog';

type Stage = 'passcode' | 'instructions' | 'permissions' | 'calibration' | 'ready' | 'interview' | 'terminated';

type InterviewQuestion = {
  id: string;
  question_text: string;
  category: string;
  question_order: number;
};

import { ProctoringInstructions } from '@/components/ai-interview/proctoring-instructions';
import { TerminatedInterview } from '@/components/ai-interview/terminated-interview';
import { createClient } from '@/lib/supabase/client';
import { useWebRTC } from '@/lib/ai-interview/use-webrtc';

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
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [questionError, setQuestionError] = useState<string | null>(null);
  const [cameraPreview, setCameraPreview] = useState<MediaStream | null>(null);
  const [faceTrackingStatus, setFaceTrackingStatus] = useState<'loading' | 'tracking' | 'error'>('loading');
  const [faceTrackingError, setFaceTrackingError] = useState<string | null>(null);
  const [faceDetected, setFaceDetected] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const supabase = createClient();
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const initAdmin = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('role')
        .eq('user_id', user.id)
        .single();

      if (profile?.role === 'admin') {
        setIsAdmin(true);
        setStage('instructions');
      }
    };
    initAdmin();
  }, [interviewId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Proctoring & Calibration State
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [warningToast, setWarningToast] = useState<{ show: boolean; count: number; reason: string }>({
    show: false,
    count: 0,
    reason: '',
  });

  const [micOn, setMicOn] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Mirrors cameraStreamRef for rendering — reading a ref's `.current` during
  // render isn't allowed (and won't reliably re-render on ref mutation
  // anyway). The ref stays the source of truth for handlers/effects (the
  // proctoring watchdog, cleanup) that must always see the latest stream.
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

  const { remoteStream } = useWebRTC(
    interviewId,
    cameraStream,
    isAdmin ? 'admin' : 'candidate',
    stage === 'interview'
  );

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      void remoteVideoRef.current.play().catch(console.warn);
    }
  }, [remoteStream, stage]);

  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const durationSecondsRef = useRef(0);
  const terminatedRef = useRef(false);
  const faceWorkerRef = useRef<Worker | null>(null);
  const proctorTrackerRef = useRef<ProctoringTimeTracker>(new ProctoringTimeTracker());
  const baselineRef = useRef<CandidateBaseline | null>(null);

  const stopAllMedia = () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    screenStreamRef.current = null;
    setCameraStream(null);
  };

  const notifyTermination = (reason: string) => {
    const payload = JSON.stringify({ interviewId, reason });
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

  const captureEvidenceSnapshot = async (category: string) => {
    if (!cameraVideoRef.current) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = cameraVideoRef.current.videoWidth || 640;
      canvas.height = cameraVideoRef.current.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(cameraVideoRef.current, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(async (blob) => {
        if (!blob) return;
        const formData = new FormData();
        formData.append('interviewId', interviewId);
        formData.append('category', category);
        formData.append('file', blob, 'snapshot.jpg');
        await fetch('/api/interview/snapshots', {
          method: 'POST',
          body: formData,
        }).catch((err) => console.warn('[snapshot] upload failed:', err));
      }, 'image/jpeg', 0.8);
    } catch (err) {
      console.warn('[snapshot] capture exception:', err);
    }
  };

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
      if (!hasLiveCameraStream()) {
        const newCameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        cameraStreamRef.current = newCameraStream;
        setCameraPreview(newCameraStream);
        setCameraStream(newCameraStream);
        setCameraGranted(true);
      }

      if (!isAdmin) {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const [videoTrack] = screenStream.getVideoTracks();
        const displaySurface = videoTrack?.getSettings().displaySurface;
        const isPartialShare = displaySurface !== undefined && displaySurface !== 'monitor';

        if (isPartialShare) {
          screenStream.getTracks().forEach((track) => track.stop());
          setScreenGranted(false);
          setPermissionError('Please share your entire screen, not a window or tab, to continue.');
          return;
        }

        screenStreamRef.current = screenStream;
        setScreenGranted(true);
      } else {
        setScreenGranted(true);
      }

      const questionsResponse = await fetch(`/api/interview/${interviewId}/questions`);
      const questionsData = await questionsResponse.json();
      if (!questionsResponse.ok || !Array.isArray(questionsData.questions) || !questionsData.questions.length) {
        setQuestionError(questionsData.error ?? 'Interview questions are not ready yet.');
        return;
      }

      const configuredDurationMinutes = Number(questionsData.session?.duration_minutes);
      if (!Number.isFinite(configuredDurationMinutes) || configuredDurationMinutes <= 0) {
        setQuestionError('The interviewer has not configured a valid interview duration yet.');
        return;
      }

      setQuestions(questionsData.questions);
      durationSecondsRef.current = configuredDurationMinutes * 60;
      setDurationSeconds(configuredDurationMinutes * 60);
      setFaceTrackingStatus('loading');
      setFaceTrackingError(null);
      setStage(isAdmin ? 'interview' : 'ready');
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

    if (process.env.NODE_ENV === 'test') return;

    const timer = window.setTimeout(() => {
      setStage('calibration');
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [stage]);

  const handleToggleMic = () => {
    const audioTracks = cameraStreamRef.current?.getAudioTracks() ?? [];
    const nextMicOn = !micOn;
    audioTracks.forEach((track) => {
      track.enabled = nextMicOn;
    });
    setMicOn(nextMicOn);
  };

  useEffect(() => {
    if (!['calibration', 'interview'].includes(stage) || !cameraVideoRef.current || !cameraPreview || isAdmin) return;
    cameraVideoRef.current.srcObject = cameraPreview;
    void cameraVideoRef.current.play();
  }, [cameraPreview, stage, isAdmin]);

  useEffect(() => {
    if (!['calibration', 'interview'].includes(stage) || isAdmin) return;

    if (typeof Worker === 'undefined') {
      const unsupportedTimer = window.setTimeout(() => {
        setFaceTrackingStatus('error');
        setFaceTrackingError('This browser does not support the face tracking worker.');
      }, 0);
      return () => window.clearTimeout(unsupportedTimer);
    }

    const worker = new Worker(new URL('../../../lib/ai-interview/face-calibration.worker.ts', import.meta.url));
    faceWorkerRef.current = worker;

    worker.onmessage = (event: MessageEvent<{ type: string; message?: string; sampleCount?: number; baseline?: CandidateBaseline } & ExtendedFaceTrackingResult>) => {
      const message = event.data;
      if (message.type === 'ready') {
        setFaceTrackingStatus('tracking');
        if (stage === 'calibration') {
          worker.postMessage({ type: 'start_calibration' });
        }
        return;
      }

      if (message.type === 'calibration_progress') {
        setCalibrationProgress(message.sampleCount ?? 0);
        return;
      }

      if (message.type === 'calibration_complete') {
        if (message.baseline) {
          baselineRef.current = message.baseline;
          worker.postMessage({ type: 'set_baseline', baseline: message.baseline });
        }
        setStage('interview');
        return;
      }

      if (message.type === 'error') {
        setFaceTrackingStatus('error');
        setFaceTrackingError(message.message || 'Face tracking model failed to load.');
        return;
      }

      if (message.type === 'result') {
        const hasFace = Boolean(message.facePresent);
        setFaceDetected(hasFace);

        // Run proctoring time tracker for warning debouncing & time windows
        const trackerStatus = proctorTrackerRef.current.processResult(message, Date.now());

        if (trackerStatus.shouldTriggerWarning) {
          setWarningToast({
            show: true,
            count: trackerStatus.warningCount,
            reason: trackerStatus.reason,
          });

          // Upload evidence snapshot & log event
          void captureEvidenceSnapshot(trackerStatus.category);
          fetch('/api/interview/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              interviewId,
              category: trackerStatus.category,
              severity: 'warning',
              meta: { warningCount: trackerStatus.warningCount, reason: trackerStatus.reason },
            }),
          }).catch((err) => console.warn('[proctor-event] fetch failed:', err));

          if (trackerStatus.warningCount >= 3) {
            terminateInterview('Three proctoring warnings issued. Session auto-terminated.');
          }
        }

        if (message.alert === 'warning') {
          setFaceTrackingStatus('tracking');
          setFaceTrackingError(
            message.lookingAway || message.headTurnedAway
              ? 'Candidate attention looks unstable.'
              : message.readingSuspected
                ? 'Reading off-screen suspected.'
                : 'Eyes appear closed or attention is drifting.',
          );
          return;
        }

        if (message.alert === 'error') {
          setFaceTrackingStatus('error');
          setFaceTrackingError('Face tracking could not detect a valid face in the frame.');
          return;
        }

        setFaceTrackingError(null);
      }
    };

    worker.postMessage({ type: 'init' });

    let frameRequest = 0;
    let lastFrameAt = 0;
    const videoElement = cameraVideoRef.current;
    const captureFrame = async (timestamp: number) => {
      if (timestamp - lastFrameAt >= 125 && videoElement) {
        if (videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
            frameRequest = videoElement.requestVideoFrameCallback(captureFrame);
          }
          return;
        }
        lastFrameAt = timestamp;
        try {
          const bitmap = await createImageBitmap(videoElement);
          worker.postMessage({ type: 'frame', bitmap, timestamp }, [bitmap]);
        } catch (error) {
          setFaceTrackingStatus('error');
          setFaceTrackingError(error instanceof Error ? error.message : 'Camera frame could not be read.');
        }
      }
      if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
        frameRequest = videoElement?.requestVideoFrameCallback(captureFrame) || 0;
      }
    };

    const beginCapture = () => {
      if ('requestVideoFrameCallback' in HTMLVideoElement.prototype && videoElement) {
        frameRequest = videoElement.requestVideoFrameCallback(captureFrame);
      }
    };
    const captureTimer = window.setInterval(() => {
      if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) void captureFrame(performance.now());
    }, 125);
    const startTimer = window.setTimeout(beginCapture, 250);

    return () => {
      window.clearTimeout(startTimer);
      window.clearInterval(captureTimer);
      if (frameRequest && videoElement?.cancelVideoFrameCallback) {
        videoElement.cancelVideoFrameCallback(frameRequest);
      }
      worker.terminate();
      faceWorkerRef.current = null;
    };
  }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps -- worker uses stable refs and initializers

  useEffect(() => {
    if (stage !== 'interview' || durationSecondsRef.current <= 0) return;
    const timer = window.setInterval(() => {
      durationSecondsRef.current -= 1;
      setDurationSeconds((remaining) => {
        if (remaining <= 1) {
          window.clearInterval(timer);
          terminateInterview('The interview time has ended.');
          return 0;
        }
        return durationSecondsRef.current;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps -- timer uses a stable ref

  useProctoringWatchdog({
    active: !isAdmin && ['ready', 'calibration', 'interview'].includes(stage),
    cameraStreamRef,
    screenStreamRef,
    onViolation: terminateInterview,
  });

  if (stage === 'calibration') {
    return (
      <main className="min-h-screen bg-[#f8f9fa] flex items-center justify-center relative">
        <video ref={cameraVideoRef} muted playsInline className="hidden"> {/* NOSONAR */}
          <track kind="captions" />
        </video>
        <CalibrationModal
          calibrationProgress={calibrationProgress}
          onComplete={() => setStage('interview')}
        />
      </main>
    );
  }
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
    setCameraPreview(newStream);
    setCameraStream(newStream);
  };

  if (stage === 'terminated') {
    return <TerminatedInterview terminationReason={terminationReason} />;
  }

  if (stage === 'ready') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#0b0f14] px-4 py-10">
        <div className="max-w-lg w-full space-y-5">
          <div className="text-center space-y-1">
            <ShieldCheck className="w-8 h-8 text-emerald-400 mx-auto mb-1" />
            <h1 className="text-xl font-bold text-white">You&apos;re verified</h1>
            <p className="text-sm text-zinc-400">
              Your camera, mic, and screen share are live. Please wait while we initialize the face tracking calibration.
            </p>
          </div>

          <MeetingVideoTile stream={cameraStream} micOn={micOn} size="large" />

          <MeetingControlBar
            micOn={micOn}
            onToggleMic={handleToggleMic}
            onOpenSettings={() => setSettingsOpen(true)}
            settingsEnabled
          />

          <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 text-center">
            Stay on this tab and keep your camera, microphone, and screen share on — switching
            tabs, minimizing the window, or stopping any of them will immediately end your
            interview.
          </p>
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

  if (stage === 'interview') {
    const minutes = Math.floor(durationSeconds / 60).toString().padStart(2, '0');
    const seconds = (durationSeconds % 60).toString().padStart(2, '0');
    const question = questions[currentQuestion];

    return (
      <main className="min-h-screen bg-[#f8f9fa] px-4 py-8 relative">
        {/* Warning Toast Banner */}
        {warningToast.show && (
          <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 max-w-lg w-full px-4 animate-in slide-in-from-top duration-300">
            <div className="bg-amber-500 text-white rounded-2xl shadow-2xl p-4 flex items-center justify-between border border-amber-400">
              <div className="flex items-center space-x-3">
                <AlertTriangle className="w-6 h-6 flex-shrink-0 animate-bounce" />
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-amber-100">
                    Warning {warningToast.count} / 3
                  </p>
                  <p className="text-sm font-semibold">{warningToast.reason}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setWarningToast((prev) => ({ ...prev, show: false }))}
                className="text-amber-100 hover:text-white font-bold text-xs bg-amber-600/50 hover:bg-amber-600 rounded-lg px-2.5 py-1.5 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-[1fr_280px]">
          <section className="rounded-2xl border border-zinc-100 bg-white p-8 shadow-card">
            <div className="mb-8 flex items-center justify-between border-b border-zinc-100 pb-5">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">Interview question</p>
                <h1 className="mt-2 text-xl font-bold text-zinc-900">
                  Question {currentQuestion + 1} of {questions.length}
                </h1>
              </div>
              <div className="rounded-xl bg-zinc-900 px-4 py-3 text-xl font-black tabular-nums text-white">
                {minutes}:{seconds}
              </div>
            </div>
            <p className="mb-3 text-xs font-bold uppercase tracking-widest text-[#1689aa]">
              {question.category.replaceAll('_', ' ')}
            </p>
            <h2 className="text-2xl font-semibold leading-relaxed text-zinc-900">{question.question_text}</h2>
            <div className="mt-10 flex justify-between gap-3">
              <button
                id="previous-interview-question"
                type="button"
                disabled={currentQuestion === 0}
                onClick={() => setCurrentQuestion((index) => Math.max(0, index - 1))}
                className="rounded-xl border border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-700 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                id="next-interview-question"
                type="button"
                disabled={currentQuestion === questions.length - 1}
                onClick={() => setCurrentQuestion((index) => Math.min(questions.length - 1, index + 1))}
                className="rounded-xl bg-[#34c4f2] px-5 py-3 text-sm font-bold text-zinc-900 disabled:opacity-40"
              >
                Next question
              </button>
            </div>
          </section>
          <aside className="space-y-4">
            <div className="overflow-hidden rounded-2xl border border-zinc-100 bg-zinc-900 shadow-card flex flex-col">
              <div className="relative">
                <video ref={cameraVideoRef} muted playsInline className="aspect-video w-full object-cover"> {/* NOSONAR */}
                  <track kind="captions" />
                </video>
                <div className="absolute top-2 left-2 bg-black/50 px-2 py-1 rounded text-[10px] text-white font-bold uppercase tracking-wider">
                  You {isAdmin ? '(Admin)' : ''}
                </div>
              </div>

              {remoteStream ? (
                <div className="relative border-t border-zinc-800">
                  <video ref={remoteVideoRef} playsInline className="aspect-video w-full object-cover"> {/* NOSONAR */}
                    <track kind="captions" />
                  </video>
                  <div className="absolute top-2 left-2 bg-[#34c4f2]/90 px-2 py-1 rounded text-[10px] text-zinc-900 font-bold uppercase tracking-wider">
                    {isAdmin ? 'Candidate' : 'Admin'}
                  </div>
                </div>
              ) : (
                <div className="aspect-video w-full bg-zinc-800 flex items-center justify-center border-t border-zinc-700">
                  <span className="text-xs text-zinc-500 font-semibold">
                    {isAdmin ? 'Waiting for candidate...' : 'Admin not in session'}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between p-3 text-xs font-semibold text-white">
                <span>Camera and microphone active</span>
                {!isAdmin && (
                  <span className={faceTrackingStatus === 'tracking' && faceDetected ? 'text-emerald-400' : 'text-amber-300'}>
                    {faceTrackingStatus === 'loading' && 'Face loading'}
                    {faceTrackingStatus === 'tracking' && (faceDetected ? 'Face detected' : 'No face detected')}
                    {faceTrackingStatus === 'error' && 'Tracking unavailable'}
                  </span>
                )}
                {isAdmin && (
                  <span className="text-[#34c4f2]">Admin Proctoring Bypassed</span>
                )}
              </div>
            </div>
            {!isAdmin && faceTrackingStatus === 'error' && faceTrackingError && (
              <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-xs leading-relaxed text-red-700">
                {faceTrackingError}
              </div>
            )}
            <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-xs leading-relaxed text-amber-800">
              Keep this tab open and keep your camera, microphone, and screen share active.
            </div>
          </aside>
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
          customError={questionError}
          buttonText="Allow & Start Interview"
        />
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
