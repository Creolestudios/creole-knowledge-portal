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
  Clock,
} from 'lucide-react';
import { CalibrationModal } from '@/components/ai-interview/CalibrationModal';
import { CandidateBaseline, ProctoringTimeTracker, ExtendedFaceTrackingResult } from '@/lib/ai-interview/face-tracking';
import { MeetingVideoTile } from '@/components/ai-interview/meeting-video-tile';
import { MeetingControlBar } from '@/components/ai-interview/meeting-control-bar';
import { DeviceSettingsPanel } from '@/components/ai-interview/device-settings-panel';
import { useProctoringWatchdog } from '@/lib/ai-interview/use-proctoring-watchdog';
import { OBJECT_RULES, type DetectedObjectEvent } from '@/lib/ai-interview/object-detection';
import { VoiceDetector } from '@/lib/ai-interview/voice-detection';

type Stage = 'passcode' | 'instructions' | 'permissions' | 'calibration' | 'ready' | 'interview' | 'completed' | 'terminated';

type InterviewQuestion = {
  id: string;
  question_text: string;
  category: string;
  question_order: number;
  difficulty?: string;
  time_limit_sec?: number;
};

import { ProctoringInstructions } from '@/components/ai-interview/proctoring-instructions';
import { TerminatedInterview } from '@/components/ai-interview/terminated-interview';
import { createClient } from '@/lib/supabase/client';
import { useWebRTC } from '@/lib/ai-interview/use-webrtc';
import { useAnswerRecorder } from '@/lib/ai-interview/use-answer-recorder';
import { useAudioVoiceGuard } from '@/lib/ai-interview/use-audio-voice-guard';
import { useRealtimeTranscript } from '@/lib/ai-interview/use-realtime-transcript';

export default function InterviewEntryPage() {
  const params = useParams();
  const interviewId = params?.id as string;

  const [stage, setStage] = useState<Stage>('passcode');
  // Keep stageRef in sync with every stage transition so worker callbacks
  // always read the current stage without closure staleness.
  const setStageWithRef = (next: Stage) => {
    stageRef.current = next;
    setStage(next);
  };

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
        // An admin never needs the passcode gate — force them past it even if
        // they had already started typing a code before this check resolved.
        setStage((current) => (current === 'passcode' ? 'instructions' : current));
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

  const { status: answerRecorderStatus, startRecording, stopAndUpload, cancelRecording } =
    useAnswerRecorder(interviewId, cameraStream);
  const [finalAnswerSubmitted, setFinalAnswerSubmitted] = useState(false);

  // ── Real-time Speech-to-Text & Audio Voice Guard ──
  const handleUnauthorizedVoice = (info: { reason: string; confidence: number }) => {
    // eslint-disable-next-line react-hooks/purity -- Date.now() is called inside an event handler, not during render.
    const nowMs = Date.now();
    const trackerStatus = proctorTrackerRef.current.processGenericEvent(
      'voice',
      'unauthorized_voice',
      'Unauthorized secondary or external AI voice detected.',
      1000,
      nowMs
    );

    if (trackerStatus.shouldTriggerWarning) {
      setWarningToast({
        show: true,
        count: trackerStatus.warningCount,
        reason: trackerStatus.reason,
      });

      void captureEvidenceSnapshot('unauthorized_voice');

      fetch('/api/interview/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interviewId,
          category: 'unauthorized_voice',
          severity: 'warning',
          confidence: info.confidence,
          meta: { warningCount: trackerStatus.warningCount, reason: info.reason },
        }),
      }).catch((err) => console.warn('[proctor-event] fetch failed:', err));

      if (trackerStatus.warningCount >= 3 && !terminatingRef.current) {
        terminatingRef.current = true;
        setTimeout(() => {
          terminateInterview('Three proctoring warnings issued. Session auto-terminated.');
        }, 3000);
      }
    }
  };

  useAudioVoiceGuard({
    interviewId,
    stream: cameraStream,
    isAiSpeaking: false,
    isCandidateTurn: stage === 'interview' && !isAdmin,
    onUnauthorizedVoiceDetected: handleUnauthorizedVoice,
    takeSnapshot: async () => {
      await captureEvidenceSnapshot('unauthorized_voice');
      return null;
    },
  });

  const [currentSpokenText, setCurrentSpokenText] = useState('');
  const [questionRemainingSec, setQuestionRemainingSec] = useState(0);
  const questionRemainingSecRef = useRef(0);
  // Prevents double-firing goToQuestion (e.g. timer + button click at the same time).
  const goingToNextRef = useRef(false);

  const { interimText, startTurn, completeTurn } = useRealtimeTranscript({
    interviewId,
    currentQuestionOrd: currentQuestion + 1,
    isCandidateTurn: stage === 'interview' && !isAdmin,
    onTranscriptLine: (line) => {
      if (line.isFinal) {
        setCurrentSpokenText((prev) => (prev ? `${prev} ${line.text}` : line.text));
      }
    },
  });

  // Only the candidate is recorded — never the admin interviewer's side of the call.
  const recordingQuestionId =
    stage === 'interview' && !isAdmin ? questions[currentQuestion]?.id : undefined;

  useEffect(() => {
    if (!recordingQuestionId) return;
    startRecording(recordingQuestionId);
    startTurn();
    return () => cancelRecording();
  }, [recordingQuestionId, startRecording, cancelRecording, startTurn]);

  // Sync question timer on current question or stage change.
  // Using setTimeout to defer setState avoids the react-hooks/set-state-in-effect lint rule;
  // the ref is updated synchronously so the interval always reads the right value.
  useEffect(() => {
    if (stage === 'interview' && questions[currentQuestion]) {
      const qSec = questions[currentQuestion].time_limit_sec || 120;
      questionRemainingSecRef.current = qSec;
      window.setTimeout(() => setQuestionRemainingSec(qSec), 0);
    }
  }, [currentQuestion, stage, questions]);

  const goToQuestion = (nextIndex: number) => {
    if (goingToNextRef.current) return;
    goingToNextRef.current = true;

    // Advance the UI immediately — do NOT await slow async operations here.
    setFinalAnswerSubmitted(false);
    setCurrentSpokenText('');
    setCurrentQuestion(nextIndex);

    // Fire-and-forget: persist metrics + upload audio in the background.
    // The MediaRecorder is stopped now so no audio is lost; the upload just
    // completes after the UI has already moved on.
    void completeTurn().catch((err) =>
      console.warn('[interview] completeTurn error:', err)
    );
    void stopAndUpload().catch((err) =>
      console.warn('[interview] stopAndUpload error:', err)
    );

    // Reset guard after the state update has propagated.
    window.setTimeout(() => {
      goingToNextRef.current = false;
    }, 500);
  };

  const submitFinalAnswer = async () => {
    await completeTurn();
    await stopAndUpload();
    setFinalAnswerSubmitted(true);
    // Trigger scoring pass on complete
    fetch(`/api/interview/${interviewId}/score`, { method: 'POST' }).catch((err) => {
      console.warn('[interview] Scoring trigger error:', err);
    });
  };

  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const durationSecondsRef = useRef(0);
  const terminatedRef = useRef(false);
  const completedRef = useRef(false);
  const terminatingRef = useRef(false);
  const faceWorkerRef = useRef<Worker | null>(null);
  const objectWorkerRef = useRef<Worker | null>(null);
  const voiceDetectorRef = useRef<VoiceDetector | null>(null);
  const proctorTrackerRef = useRef<ProctoringTimeTracker>(new ProctoringTimeTracker());
  const baselineRef = useRef<CandidateBaseline | null>(null);
  const missingFramesRef = useRef<Map<string, number>>(new Map());
  // Always reflects the latest stage so worker message handlers never
  // capture a stale value from their closure.
  const stageRef = useRef<Stage>(stage);

  const stopAllMedia = () => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    screenStreamRef.current = null;
    setCameraStream(null);
  };

  const notifyTermination = (reason: string) => {
    const counts = proctorTrackerRef.current.getWarningCounts();
    const payload = JSON.stringify({
      interviewId,
      reason,
      warningCounts: { face: counts.face, object: counts.object, voice: counts.voice },
    });
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
    if (terminatedRef.current || stageRef.current === 'completed' || completedRef.current) return;
    terminatedRef.current = true;
    stopAllMedia();
    notifyTermination(reason);
    setTerminationReason(reason);
    setStageWithRef('terminated');
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

      setStageWithRef('instructions');
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
        setPermissionError(questionsData.error ?? 'Interview questions are not ready yet.');
        return;
      }

      const questionsList = questionsData.questions;
      setQuestions(questionsList);

      const sumQuestionSeconds = questionsList.reduce(
        (acc: number, q: { time_limit_sec?: number }) => acc + (q.time_limit_sec || 0),
        0
      );
      const totalSeconds = sumQuestionSeconds > 0
        ? sumQuestionSeconds
        : (Number(questionsData.session?.duration_minutes) || 15) * 60;

      durationSecondsRef.current = totalSeconds;
      setDurationSeconds(totalSeconds);
      setFaceTrackingStatus('loading');
      setFaceTrackingError(null);
      setStageWithRef(isAdmin ? 'interview' : 'ready');
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

    if (isAdmin) {
      const adminTimer = window.setTimeout(() => {
        setStageWithRef('interview');
      }, 0);
      return () => window.clearTimeout(adminTimer);
    }

    if (process.env.NODE_ENV === 'test') return;

    const timer = window.setTimeout(() => {
      setStageWithRef('calibration');
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [stage, isAdmin]);

  const handleToggleMic = () => {
    const audioTracks = cameraStreamRef.current?.getAudioTracks() ?? [];
    const nextMicOn = !micOn;
    audioTracks.forEach((track) => {
      track.enabled = nextMicOn;
    });
    setMicOn(nextMicOn);
  };

  useEffect(() => {
    if (!cameraVideoRef.current) return;
    const stream = cameraStream || cameraPreview;
    if (!stream || isAdmin) return;
    if (cameraVideoRef.current.srcObject !== stream) {
      cameraVideoRef.current.srcObject = stream;
    }
    void cameraVideoRef.current.play()?.catch(() => {});
  }, [cameraStream, cameraPreview, stage, isAdmin]);

  // ─── Shared frame-capture helper ─────────────────────────────────────────
  // Extracted so both the calibration and interview effects can reuse it.
  const startFaceFrameCapture = (
    worker: Worker,
    videoElement: HTMLVideoElement | null,
  ): (() => void) => {
    let frameRequest = 0;
    let lastFrameAt = 0;

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
        } catch (err) {
          setFaceTrackingStatus('error');
          setFaceTrackingError(err instanceof Error ? err.message : 'Camera frame could not be read.');
        }
      }
      if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
        frameRequest = videoElement?.requestVideoFrameCallback(captureFrame) || 0;
      }
    };

    const captureTimer = window.setInterval(() => {
      if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) void captureFrame(performance.now());
    }, 125);

    const startTimer = window.setTimeout(() => {
      if ('requestVideoFrameCallback' in HTMLVideoElement.prototype && videoElement) {
        frameRequest = videoElement.requestVideoFrameCallback(captureFrame);
      }
    }, 250);

    return () => {
      window.clearTimeout(startTimer);
      window.clearInterval(captureTimer);
      if (frameRequest && videoElement?.cancelVideoFrameCallback) {
        videoElement.cancelVideoFrameCallback(frameRequest);
      }
    };
  };

  // ─── Effect A: Calibration-only face worker ───────────────────────────────
  // Runs only during the 'calibration' stage. Sends init → start_calibration,
  // accumulates baseline samples, and transitions to 'interview' on completion.
  // This worker is terminated immediately when calibration finishes so that
  // Effect B can start a fresh worker with the baseline already set.
  useEffect(() => {
    if (stage !== 'calibration') return;

    if (typeof Worker === 'undefined') {
      window.setTimeout(() => {
        setFaceTrackingStatus('error');
        setFaceTrackingError('This browser does not support the face tracking worker.');
      }, 0);
      return;
    }

    const worker = new Worker(
      new URL('../../../lib/ai-interview/face-calibration.worker.ts', import.meta.url),
    );
    faceWorkerRef.current = worker;
    let stopCapture: (() => void) | null = null;

    worker.onmessage = (event: MessageEvent<{ type: string; message?: string; sampleCount?: number; baseline?: CandidateBaseline } & ExtendedFaceTrackingResult>) => {
      const msg = event.data;

      if (msg.type === 'ready') {
        setFaceTrackingStatus('tracking');
        // Begin sending frames & immediately start calibration collection
        stopCapture = startFaceFrameCapture(worker, cameraVideoRef.current);
        worker.postMessage({ type: 'start_calibration' });
        return;
      }

      if (msg.type === 'calibration_progress') {
        setCalibrationProgress(msg.sampleCount ?? 0);
        return;
      }

      if (msg.type === 'calibration_complete') {
        // Persist baseline so the interview worker can load it immediately
        if (msg.baseline) {
          baselineRef.current = msg.baseline;
        }
        // Stop capture and terminate — Effect B will spin up its own worker
        stopCapture?.();
        worker.terminate();
        faceWorkerRef.current = null;
        setStageWithRef('interview');
        return;
      }

      if (msg.type === 'error') {
        setFaceTrackingStatus('error');
        setFaceTrackingError(msg.message || 'Face tracking model failed to load.');
        return;
      }

      // 'result' messages during calibration: only update face-detected indicator,
      // never trigger proctoring alerts (baseline doesn't exist yet).
      if (msg.type === 'result') {
        setFaceDetected(Boolean(msg.facePresent));
      }
    };

    worker.postMessage({ type: 'init' });

    return () => {
      stopCapture?.();
      worker.terminate();
      faceWorkerRef.current = null;
    };
  }, [stage]);

  // ─── Effect B: Interview proctoring face worker ───────────────────────────
  // Runs only during the 'interview' stage. Loads the face model, immediately
  // sends the baseline captured during calibration, then processes every
  // 'result' frame for proctoring violations.
  // Because this effect only mounts when stage === 'interview', there is NO
  // stale-closure issue — stageRef.current is always 'interview' here.
  useEffect(() => {
    if (stage !== 'interview') return;

    if (typeof Worker === 'undefined') return;

    const worker = new Worker(
      new URL('../../../lib/ai-interview/face-calibration.worker.ts', import.meta.url),
    );
    faceWorkerRef.current = worker;
    let stopCapture: (() => void) | null = null;

    worker.onmessage = (event: MessageEvent<{ type: string; message?: string } & ExtendedFaceTrackingResult>) => {
      const msg = event.data;

      if (msg.type === 'ready') {
        setFaceTrackingStatus('tracking');
        // Restore the baseline computed during calibration so the worker
        // can immediately use relative gaze offsets instead of absolutes.
        if (baselineRef.current) {
          worker.postMessage({ type: 'set_baseline', baseline: baselineRef.current });
        }
        stopCapture = startFaceFrameCapture(worker, cameraVideoRef.current);
        return;
      }

      if (msg.type === 'error') {
        setFaceTrackingStatus('error');
        setFaceTrackingError(msg.message || 'Face tracking model failed to load.');
        return;
      }

      if (msg.type === 'result') {
        const hasFace = Boolean(msg.facePresent);
        setFaceDetected(hasFace);

        // stageRef always reflects current stage — no stale closure possible.
        if (stageRef.current !== 'interview') return;

        // ── Proctoring time tracker: debounces & counts violations ──
        const trackerStatus = proctorTrackerRef.current.processResult(msg, Date.now());

        if (trackerStatus.shouldTriggerWarning) {
          setWarningToast({
            show: true,
            count: trackerStatus.warningCount,
            reason: trackerStatus.reason,
          });

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
            if (!terminatingRef.current) {
              terminatingRef.current = true;
              setTimeout(() => {
                terminateInterview('Three proctoring warnings issued. Session auto-terminated.');
              }, 3000);
            }
          }
        }

        if (msg.alert === 'warning') {
          setFaceTrackingStatus('tracking');
          setFaceTrackingError(
            msg.lookingAway || msg.headTurnedAway
              ? 'Candidate attention looks unstable.'
              : msg.readingSuspected
                ? 'Reading off-screen suspected.'
                : 'Eyes appear closed or attention is drifting.',
          );
          return;
        }

        if (msg.alert === 'error') {
          setFaceTrackingStatus('error');
          setFaceTrackingError('Face tracking could not detect a valid face in the frame.');
          return;
        }

        setFaceTrackingError(null);
      }
    };

    worker.postMessage({ type: 'init' });

    return () => {
      stopCapture?.();
      worker.terminate();
      faceWorkerRef.current = null;
    };
  }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps -- uses stable refs; terminateInterview uses terminatedRef

  // ─── Object Detection Worker ──────────────────────────────────────────────
  // Only start during the live interview — not during calibration.
  // Starting during calibration wastes resources and may log false object
  // warnings before the candidate has even reached the interview screen.
  useEffect(() => {
    if (stage !== 'interview') return;
    if (typeof Worker === 'undefined') {
      console.warn('[ObjectDetection] Web Workers not supported in this browser environment');
      return;
    }

    console.log('%c[ObjectDetection] Initializing Object Detection Worker in stage: interview...', 'color: #06b6d4; font-weight: bold;');
    const worker = new Worker(
      new URL('../../../lib/ai-interview/object-detection.worker.ts', import.meta.url),
    );
    objectWorkerRef.current = worker;
    let frameTimerRef: number | null = null;
    let frameCount = 0;

    worker.onerror = (err) => {
      console.warn('%c[ObjectDetection Error] Worker runtime exception:', 'color: #ef4444; font-weight: bold;', err);
    };

    worker.onmessage = (event: MessageEvent<{ type: string; detections?: DetectedObjectEvent[]; message?: string }>) => {
      const msg = event.data;

      if (msg.type === 'error') {
        console.warn('%c[ObjectDetection Error]', 'color: #ef4444; font-weight: bold;', msg.message);
        return;
      }

      // ── Model ready: start sending frames NOW (not before) ──
      if (msg.type === 'ready') {
        console.log('%c[ObjectDetection] ✅ Worker model is READY. Starting camera frame capture loop (350ms)...', 'color: #10b981; font-weight: bold;');
        frameTimerRef = window.setInterval(() => {
          const video = cameraVideoRef.current;
          if (!video) {
            return;
          }
          if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            return;
          }
          createImageBitmap(video)
            .then((bitmap) => {
              frameCount += 1;
              if (frameCount % 10 === 1) {
                console.log(`[ObjectDetection] Captured frame #${frameCount} (${video.videoWidth}x${video.videoHeight}), running inference...`);
              }
              worker.postMessage({ type: 'frame', bitmap, timestamp: performance.now() }, [bitmap]);
            })
            .catch((err) => {
              console.warn('[ObjectDetection] Frame capture error:', err);
            });
        }, 350); // 350ms — real-time responsive object detection
        return;
      }

      if (msg.type !== 'result' || !msg.detections) return;

      // ── Log raw detections for debugging ──
      if (msg.detections.length > 0) {
        console.log(
          '%c[ObjectDetection] 🚨 DETECTIONS IN FRAME:',
          'color: #f59e0b; font-weight: bold; font-size: 13px;',
          msg.detections.map((d) => `${d.label} (${(d.confidence * 100).toFixed(0)}%)`),
        );
      }

      const nowMs = Date.now();
      const seenSubKeys = new Set<string>();

      for (const detection of msg.detections) {
        const rule = detection.rule;
        if (!rule) continue;

        const subKey = rule.object; // e.g. 'phone', 'earbuds', 'book', 'second_screen'
        seenSubKeys.add(subKey);
        missingFramesRef.current.set(subKey, 0);

        const trackerStatus = proctorTrackerRef.current.processGenericEvent(
          rule.category,
          subKey,
          rule.reason,
          rule.thresholdMs,
          5000, // 5s debounce between repeated warnings for same object
          nowMs,
        );

        if (trackerStatus.shouldTriggerWarning) {
          console.warn(
            `%c[ObjectDetection] ⚠️ PROCTORING ALERT #${trackerStatus.warningCount}: ${trackerStatus.reason}`,
            'color: #dc2626; font-weight: bold; font-size: 14px; background: #fee2e2; padding: 4px; border-radius: 4px;',
          );

          setWarningToast({
            show: true,
            count: trackerStatus.warningCount,
            reason: trackerStatus.reason,
          });

          // Auto-dismiss warning toast after 5 seconds if not dismissed manually
          window.setTimeout(() => {
            setWarningToast((prev) => (prev.count === trackerStatus.warningCount ? { ...prev, show: false } : prev));
          }, 5000);

          // Evidence snapshot + DB event
          void captureEvidenceSnapshot(rule.category);
          fetch('/api/interview/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              interviewId,
              category: rule.category,
              severity: rule.severity,
              confidence: detection.confidence,
              meta: {
                object: rule.object,
                confidence: detection.confidence,
                boundingBox: detection.boundingBox,
                warningCount: trackerStatus.warningCount,
              },
            }),
          }).catch((err) => console.warn('[object-event] fetch failed:', err));

          if (trackerStatus.warningCount >= 3) {
            if (!terminatingRef.current) {
              terminatingRef.current = true;
              setTimeout(() => {
                terminateInterview('Three proctoring warnings issued. Session auto-terminated.');
              }, 3000);
            }
          }
        }
      }

      // Clear timers for objects not seen after a 2-frame grace period
      const allObjectSubKeys = Object.values(OBJECT_RULES).map((r) => r.object);
      for (const subKey of allObjectSubKeys) {
        if (!seenSubKeys.has(subKey)) {
          const missCount = (missingFramesRef.current.get(subKey) || 0) + 1;
          missingFramesRef.current.set(subKey, missCount);
          if (missCount >= 2) {
            proctorTrackerRef.current.clearGenericKey('object_detected', subKey);
          }
        }
      }
    };

    console.log('[ObjectDetection] Sending init to worker');
    worker.postMessage({ type: 'init' });
    // NOTE: frame timer is started inside the 'ready' handler above — NOT here.
    // This prevents frames being dropped while the COCO-SSD model is still loading.

    return () => {
      if (frameTimerRef) window.clearInterval(frameTimerRef);
      worker.terminate();
      objectWorkerRef.current = null;
    };
  }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps -- worker uses stable refs

  // ─── Background Voice Detection ───────────────────────────────────────────
  useEffect(() => {
    if (stage !== 'interview') return;
    const stream = cameraStreamRef.current;
    if (!stream) return;

    const detector = new VoiceDetector({
      noiseThreshold: 0.04,
      sustainedMs: 3000,
      debounceMs: 20000,
      onBackgroundVoice: ({ duration_ms, rms_level }) => {
        const trackerStatus = proctorTrackerRef.current.processGenericEvent(
          'background_voice',
          'voice',
          'Background voice or noise detected. Ensure you are in a quiet environment.',
          0, // threshold already handled by VoiceDetector internally
          20000,
        );

        if (trackerStatus.shouldTriggerWarning) {
          setWarningToast({
            show: true,
            count: trackerStatus.warningCount,
            reason: 'Background voice or noise detected. Ensure you are in a quiet environment.',
          });

          fetch('/api/interview/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              interviewId,
              category: 'background_voice',
              severity: 'warning',
              meta: { duration_ms, rms_level, warningCount: trackerStatus.warningCount },
            }),
          }).catch((err) => console.warn('[voice-event] fetch failed:', err));

          if (trackerStatus.warningCount >= 3) {
            if (!terminatingRef.current) {
              terminatingRef.current = true;
              setTimeout(() => {
                terminateInterview('Three proctoring warnings issued. Session auto-terminated.');
              }, 3000);
            }
          }
        }
      },
    });

    detector.start(stream);
    voiceDetectorRef.current = detector;

    return () => {
      detector.stop();
      voiceDetectorRef.current = null;
    };
  }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps -- uses stable refs

  // ── Auto-dismiss warning toast after 4 seconds ──
  useEffect(() => {
    if (!warningToast.show) return;
    const timer = window.setTimeout(() => {
      setWarningToast((prev) => ({ ...prev, show: false }));
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [warningToast.show, warningToast.count]);

  useEffect(() => {
    if (stage !== 'interview' || durationSecondsRef.current <= 0) return;
    const timer = window.setInterval(() => {
      // 1. Overall timer
      durationSecondsRef.current -= 1;
      setDurationSeconds((remaining) => {
        if (remaining <= 1) {
          window.clearInterval(timer);
          completedRef.current = true;
          stopAllMedia();
          fetch(`/api/interview/${interviewId}/score`, { method: 'POST' }).catch(() => {});
          setStageWithRef('completed');
          return 0;
        }
        return durationSecondsRef.current;
      });

      // 2. Per-question timer — auto-advance when it hits 0
      setQuestionRemainingSec((prevQ) => {
        if (prevQ <= 1) {
          // Timer just expired: auto-advance to next question (or finish interview)
          window.setTimeout(() => {
            setCurrentQuestion((cq) => {
              setQuestions((qs) => {
                if (!goingToNextRef.current) {
                  if (cq < qs.length - 1) {
                    goToQuestion(cq + 1);
                  } else {
                    // Last question — submit automatically
                    void submitFinalAnswer();
                  }
                }
                return qs;
              });
              return cq;
            });
          }, 0);
          return 0;
        }
        questionRemainingSecRef.current = prevQ - 1;
        return prevQ - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps

  useProctoringWatchdog({
    active: !isAdmin && ['ready', 'calibration', 'interview'].includes(stage),
    cameraStreamRef,
    screenStreamRef,
    onViolation: terminateInterview,
  });

  if (stage === 'calibration') {
    return (
      <main className="min-h-screen bg-[#f8f9fa] flex items-center justify-center relative">
        <video
          ref={cameraVideoRef}
          autoPlay
          muted
          playsInline
          aria-hidden="true"
          style={{
            position: 'fixed',
            bottom: 0,
            right: 0,
            width: '320px',
            height: '240px',
            opacity: 0.001,
            pointerEvents: 'none',
            zIndex: -50,
          }}
        />
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

  if (stage === 'completed') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#f8f9fa] px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-card border border-zinc-100 p-8 text-center space-y-4">
          <div className="w-16 h-16 bg-emerald-500/10 rounded-2xl flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
          </div>
          <h1 className="text-2xl font-bold text-zinc-900">Interview complete</h1>
          <p className="text-sm text-zinc-500 leading-relaxed">
            Thank you. Your responses and assessment data have been submitted. You may close this window now.
          </p>
        </div>
      </main>
    );
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
    const qMinutes = Math.floor(questionRemainingSec / 60).toString().padStart(2, '0');
    const qSeconds = ((questionRemainingSec % 60) || 0).toString().padStart(2, '0');
    const hasGivenAnswer = currentSpokenText.trim().length > 0 || (interimText && interimText.trim().length > 0);
    const question = questions[currentQuestion];

    return (
      <main className="min-h-screen bg-[#f8f9fa] px-4 py-8 relative">
        {/* Warning Toast Banner */}
        {warningToast.show && (
          <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 max-w-2xl w-full px-4 animate-in slide-in-from-top duration-300">
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

        {/* ── Side-by-side layout: Question card left, camera right ── */}
        <div className="mx-auto max-w-6xl grid grid-cols-1 md:grid-cols-12 gap-6 items-start">

          {/* Question Card */}
          <section className="md:col-span-7 lg:col-span-8 rounded-2xl border border-zinc-100 bg-white p-8 shadow-card">
            <div className="mb-8 flex items-center justify-between border-b border-zinc-100 pb-5">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-zinc-400">Interview question</p>
                <h1 className="mt-2 text-xl font-bold text-zinc-900">
                  Question {currentQuestion + 1} of {questions.length}
                </h1>
              </div>
              <div className="flex items-center gap-3">
                {/* Per-Question Countdown Timer as mentioned for each question */}
                <div
                  id="interview-question-timer-badge"
                  className={`rounded-xl px-3.5 py-2.5 text-sm font-black tabular-nums flex items-center gap-1.5 shadow-sm transition-all ${
                    questionRemainingSec <= 30
                      ? 'bg-red-600 text-white animate-pulse'
                      : 'bg-blue-600 text-white'
                  }`}
                  title="Time remaining for this specific question"
                >
                  <Clock className="w-4 h-4" />
                  <span>Question: {qMinutes}:{qSeconds}</span>
                </div>

                {/* Overall Interview Countdown Timer */}
                <div
                  className="rounded-xl bg-zinc-900 px-3.5 py-2.5 text-sm font-bold tabular-nums text-zinc-300 flex items-center gap-1.5 shadow-sm"
                  title="Overall interview remaining time"
                >
                  <span className="text-zinc-500 text-xs">Total:</span>
                  <span>{minutes}:{seconds}</span>
                </div>

                <span className="rounded-xl bg-zinc-100 px-3 py-2 text-xs font-bold uppercase tracking-wider text-zinc-700">
                  {question?.difficulty || 'Medium'}
                </span>
              </div>
            </div>
            <p className="mb-3 text-xs font-bold uppercase tracking-widest text-[#1689aa]">
              {question.category.replaceAll('_', ' ')}
            </p>
            <h2 className="text-2xl font-semibold leading-relaxed text-zinc-900">{question.question_text}</h2>
            {!isAdmin && (
              <div
                id="answer-recording-status"
                className="mt-8 flex items-center gap-2 text-xs font-bold uppercase tracking-widest"
              >
                {answerRecorderStatus === 'recording' && (
                  <>
                    <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-red-600">Recording your voice</span>
                  </>
                )}
                {answerRecorderStatus === 'saving' && (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-500" />
                    <span className="text-zinc-500">Saving your answer</span>
                  </>
                )}
                {answerRecorderStatus === 'unsupported' && (
                  <span className="text-amber-600">Answer recording is unavailable in this browser</span>
                )}
              </div>
            )}

            {interimText && (
              <div className="mt-4 p-3 rounded-xl bg-sky-50 border border-sky-100 text-xs text-sky-800 flex items-center gap-2 animate-pulse">
                <span className="h-2 w-2 rounded-full bg-sky-500 shrink-0" />
                <span className="italic">Live Caption: &ldquo;{interimText}&rdquo;</span>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              {/* Previous button removed — candidate only moves forward */}
              {!isAdmin && currentQuestion === questions.length - 1 ? (
                <button
                  id="submit-final-interview-answer"
                  type="button"
                  disabled={finalAnswerSubmitted || answerRecorderStatus === 'saving' || !hasGivenAnswer}
                  onClick={submitFinalAnswer}
                  className="rounded-xl bg-[#34c4f2] px-6 py-3.5 text-sm font-bold text-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed shadow-md transition-all active:scale-[0.98]"
                >
                  {finalAnswerSubmitted
                    ? 'Answer submitted'
                    : !hasGivenAnswer
                    ? 'Speak your answer to submit'
                    : 'Submit final answer'}
                </button>
              ) : (
                <button
                  id="next-interview-question"
                  type="button"
                  disabled={currentQuestion === questions.length - 1 || answerRecorderStatus === 'saving' || !hasGivenAnswer}
                  onClick={() => goToQuestion(currentQuestion + 1)}
                  className="rounded-xl bg-[#34c4f2] px-6 py-3.5 text-sm font-bold text-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed shadow-md transition-all active:scale-[0.98]"
                >
                  {!hasGivenAnswer ? 'Speak your answer to continue' : 'Next question'}
                </button>
              )}
            </div>
          </section>

          {/* Camera Panel — sticky on the right, side-by-side to question */}
          <div className="md:col-span-5 lg:col-span-4 space-y-4 md:sticky md:top-6">
            <div className="rounded-2xl border border-zinc-100 bg-zinc-900 shadow-card p-4 space-y-3">
              <div className="flex items-center justify-between text-xs text-zinc-300 font-semibold px-1">
                <span className="flex items-center gap-1.5">
                  <Camera className="w-3.5 h-3.5 text-zinc-400" />
                  Live Video
                </span>
                <span className={[
                  'text-[10px] font-semibold flex items-center gap-1.5 px-2 py-0.5 rounded-full',
                  faceTrackingStatus === 'tracking' && faceDetected ? 'bg-emerald-900/80 text-emerald-300' : 'bg-amber-900/80 text-amber-300',
                ].join(' ')}>
                  <span className={[
                    'inline-block w-1.5 h-1.5 rounded-full',
                    faceTrackingStatus === 'tracking' && faceDetected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-300',
                  ].join(' ')} />
                  {faceTrackingStatus === 'loading' && 'Face loading…'}
                  {faceTrackingStatus === 'tracking' && (faceDetected ? 'Face detected' : 'No face detected')}
                  {faceTrackingStatus === 'error' && 'Tracking unavailable'}
                </span>
              </div>

              <MeetingVideoTile stream={cameraStream} micOn={micOn} size="large" videoRef={cameraVideoRef} />

              <MeetingControlBar micOn={micOn} onToggleMic={handleToggleMic} settingsEnabled={false} />
            </div>

            {/* Inline alerts below camera */}
            {faceTrackingError && (
              <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-xs leading-relaxed text-red-700">
                <strong className="block mb-1 font-semibold text-red-800">Alert</strong>
                {faceTrackingError}
              </div>
            )}
            <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-xs leading-relaxed text-amber-800">
              Keep this tab open and keep your camera, microphone, and screen share active.
            </div>
          </div>

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
