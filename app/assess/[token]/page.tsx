'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
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
  AlertTriangle,
  Clock,
} from 'lucide-react';
import { MeetingVideoTile } from '@/components/ai-interview/meeting-video-tile';
import { MeetingControlBar } from '@/components/ai-interview/meeting-control-bar';
import { DeviceSettingsPanel } from '@/components/ai-interview/device-settings-panel';
import { useProctoringWatchdog } from '@/lib/ai-interview/use-proctoring-watchdog';
import { CalibrationModal } from '@/components/ai-interview/CalibrationModal';
import {
  CandidateBaseline,
  ProctoringTimeTracker,
  ExtendedFaceTrackingResult,
} from '@/lib/ai-interview/face-tracking';
import { OBJECT_RULES, type DetectedObjectEvent } from '@/lib/ai-interview/object-detection';
import { VoiceDetector } from '@/lib/ai-interview/voice-detection';
import { useAudioVoiceGuard } from '@/lib/ai-interview/use-audio-voice-guard';
import { useRealtimeTranscript } from '@/lib/ai-interview/use-realtime-transcript';

type Stage = 'passcode' | 'instructions' | 'permissions' | 'ready' | 'calibration' | 'interview' | 'completed' | 'terminated';

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

  // ── stageRef: always reflects the latest stage so worker callbacks
  // never capture a stale value from their closure.
  const stageRef = useRef<Stage>('passcode');
  const setStageWithRef = useCallback((next: Stage) => {
    stageRef.current = next;
    setStage(next);
  }, []);

  const [passcode, setPasscode] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [questions, setQuestions] = useState<AssessQuestion[]>([]);
  const [candidateName, setCandidateName] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answerText, setAnswerText] = useState('');
  const [savingAnswer, setSavingAnswer] = useState(false);
  const questionStartedAtRef = useRef<number>(0);
  const firstSpeechAtRef = useRef<number | null>(null);

  const [questionRemainingSec, setQuestionRemainingSec] = useState<number>(0);
  const questionRemainingSecRef = useRef<number>(0);

  const [cameraGranted, setCameraGranted] = useState(false);
  const [screenGranted, setScreenGranted] = useState(false);
  const [requestingPermissions, setRequestingPermissions] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const [terminationReason, setTerminationReason] = useState<string | null>(null);

  const [micOn, setMicOn] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

  // ── Proctoring & Calibration State ──
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [faceTrackingStatus, setFaceTrackingStatus] = useState<'loading' | 'tracking' | 'error'>('loading');
  const [faceTrackingError, setFaceTrackingError] = useState<string | null>(null);
  const [faceDetected, setFaceDetected] = useState(false);
  const [isMouthMoving, setIsMouthMoving] = useState(false);
  const [warningToast, setWarningToast] = useState<{ show: boolean; count: number; reason: string }>({
    show: false,
    count: 0,
    reason: '',
  });

  const [durationSeconds, setDurationSeconds] = useState(15 * 60);
  const durationSecondsRef = useRef(15 * 60);
  const completedRef = useRef(false);

  // ── Refs ──
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const terminatedRef = useRef(false);
  const terminatingRef = useRef(false);
  const faceWorkerRef = useRef<Worker | null>(null);
  const objectWorkerRef = useRef<Worker | null>(null);
  const voiceDetectorRef = useRef<VoiceDetector | null>(null);
  const proctorTrackerRef = useRef<ProctoringTimeTracker>(new ProctoringTimeTracker());
  const baselineRef = useRef<CandidateBaseline | null>(null);
  const missingFramesRef = useRef<Map<string, number>>(new Map());
  const isSubmittingAnswerRef = useRef(false);
  const handleSubmitAnswerRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const stopAllMedia = useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    screenStreamRef.current = null;
    setCameraStream(null);
  }, []);

  const notifyTermination = useCallback((reason: string) => {
    const counts = proctorTrackerRef.current.getWarningCounts();
    const payload = JSON.stringify({
      reason,
      warningCounts: { face: counts.face, object: counts.object, voice: counts.voice },
    });
    const url = `/api/assess/${token}/terminate`;
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
  }, [token]);

  const terminateInterview = useCallback((reason: string) => {
    if (terminatedRef.current || stageRef.current === 'completed' || completedRef.current) return;
    terminatedRef.current = true;
    stopAllMedia();
    notifyTermination(reason);
    setTerminationReason(reason);
    setStageWithRef('terminated');
  }, [notifyTermination, stopAllMedia, setStageWithRef]);

  const captureEvidenceSnapshot = useCallback(async (category: string) => {
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
        formData.append('token', token);
        formData.append('category', category);
        formData.append('file', blob, 'snapshot.jpg');
        await fetch('/api/assess/snapshots', {
          method: 'POST',
          body: formData,
        }).catch((err) => console.warn('[assess-snapshot] upload failed:', err));
      }, 'image/jpeg', 0.8);
    } catch (err) {
      console.warn('[assess-snapshot] capture exception:', err);
    }
  }, [token]);

  // Release devices on unmount
  useEffect(() => {
    return () => {
      stopAllMedia();
    };
  }, [stopAllMedia]);

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

      if (json.session_id) {
        setSessionId(json.session_id);
      }
      const questionsList = json.questions ?? [];
      setQuestions(questionsList);
      setCandidateName(json.candidate_name ?? null);

      const sumQuestionSeconds = questionsList.reduce(
        (acc: number, q: { time_limit_sec?: number }) => acc + (q.time_limit_sec || 0),
        0
      );
      const configuredTotalSeconds = sumQuestionSeconds > 0
        ? sumQuestionSeconds
        : (Number(json.duration_minutes) || 15) * 60;

      setDurationSeconds(configuredTotalSeconds);
      durationSecondsRef.current = configuredTotalSeconds;
      setStageWithRef('instructions');
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
      if (!hasLiveCameraStream()) {
        const newCameraStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        cameraStreamRef.current = newCameraStream;
        setCameraStream(newCameraStream);
        setCameraGranted(true);
      }

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
      setFaceTrackingStatus('loading');
      setFaceTrackingError(null);
      setStageWithRef('ready');
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
    setCalibrationProgress(0);
    setStageWithRef(process.env.NODE_ENV === 'test' ? 'interview' : 'calibration');
  };

  // ── Auto-dismiss warning toast after 4 seconds ──
  useEffect(() => {
    if (!warningToast.show) return;
    const timer = window.setTimeout(() => {
      setWarningToast((prev) => ({ ...prev, show: false }));
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [warningToast.show, warningToast.count]);

  // ── Sync question timer on question index or stage change ──
  // Ref updated synchronously; setState deferred to avoid react-hooks/set-state-in-effect.
  useEffect(() => {
    if (stage === 'interview' && questions[currentIndex]) {
      const qSec = questions[currentIndex].time_limit_sec || 120;
      questionRemainingSecRef.current = qSec;
      window.setTimeout(() => setQuestionRemainingSec(qSec), 0);
    }
  }, [currentIndex, stage, questions]);

  // ── Countdown timer for interview duration & current question ──
  useEffect(() => {
    if (stage !== 'interview' || durationSecondsRef.current <= 0) return;
    const timer = window.setInterval(() => {
      // 1. Overall interview duration countdown
      durationSecondsRef.current -= 1;
      setDurationSeconds((remaining) => {
        if (remaining <= 1) {
          window.clearInterval(timer);
          completedRef.current = true;
          stopAllMedia();
          const counts = proctorTrackerRef.current.getWarningCounts();
          fetch(`/api/assess/${token}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              warningCounts: { face: counts.face, object: counts.object, voice: counts.voice },
            }),
          }).catch((err) => console.warn('[assess] complete call failed:', err));
          setStageWithRef('completed');
          return 0;
        }
        return durationSecondsRef.current;
      });

      // 2. Per-question timer countdown
      setQuestionRemainingSec((prevQ) => {
        if (prevQ <= 1) {
          // Question time elapsed: auto-submit once and move to next question safely
          if (!isSubmittingAnswerRef.current && handleSubmitAnswerRef.current) {
            void handleSubmitAnswerRef.current();
          }
          return 0;
        }
        questionRemainingSecRef.current = prevQ - 1;
        return prevQ - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [stage, token, stopAllMedia, setStageWithRef]);

  useProctoringWatchdog({
    active: ['ready', 'calibration', 'interview'].includes(stage),
    cameraStreamRef,
    screenStreamRef,
    onViolation: terminateInterview,
  });

  // ── Sync video element srcObject whenever camera stream or stage changes ──
  useEffect(() => {
    if (!cameraVideoRef.current) return;
    const stream = cameraStreamRef.current;
    if (!stream) return;
    if (cameraVideoRef.current.srcObject !== stream) {
      cameraVideoRef.current.srcObject = stream;
    }
    void cameraVideoRef.current.play()?.catch(() => {});
  }, [stage]);

  // ── Shared frame-capture helper ───────────────────────────────────────────
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

  // ── Effect A: Calibration-only face worker ────────────────────────────────
  // Sends init → start_calibration, collects 15 baseline samples, then
  // terminates itself and advances to 'interview'.
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
        stopCapture = startFaceFrameCapture(worker, cameraVideoRef.current);
        worker.postMessage({ type: 'start_calibration' });
        return;
      }

      if (msg.type === 'calibration_progress') {
        setCalibrationProgress(msg.sampleCount ?? 0);
        return;
      }

      if (msg.type === 'calibration_complete') {
        if (msg.baseline) {
          baselineRef.current = msg.baseline;
        }
        stopCapture?.();
        worker.terminate();
        faceWorkerRef.current = null;
        questionStartedAtRef.current = Date.now();
        setStageWithRef('interview');
        return;
      }

      if (msg.type === 'error') {
        setFaceTrackingStatus('error');
        setFaceTrackingError(msg.message || 'Face tracking model failed to load.');
        return;
      }

      // During calibration: only update face indicator, no proctoring
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
  }, [stage, setStageWithRef]);

  // ── Effect B: Interview proctoring face worker ────────────────────────────
  // Runs only during 'interview'. Restores the calibration baseline and
  // processes every result frame for proctoring violations.
  // stageRef eliminates stale-closure issues.
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
        setFaceDetected(Boolean(msg.facePresent));
        setIsMouthMoving(Boolean(msg.mouthMoving));

        // stageRef always reflects current stage — no stale closure
        if (stageRef.current !== 'interview' || terminatingRef.current) return;

        const trackerStatus = proctorTrackerRef.current.processResult(msg, Date.now());

        if (trackerStatus.shouldTriggerWarning) {
          setWarningToast({
            show: true,
            count: trackerStatus.warningCount,
            reason: trackerStatus.reason,
          });

          void captureEvidenceSnapshot(trackerStatus.category);
          fetch(`/api/assess/${token}/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              category: trackerStatus.category,
              severity: 'warning',
              meta: { warningCount: trackerStatus.warningCount, reason: trackerStatus.reason },
            }),
          }).catch((err) => console.warn('[assess-proctor-event] fetch failed:', err));

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
  }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Object Detection Worker ───────────────────────────────────────────────
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

      if (msg.type === 'ready') {
        console.log('%c[ObjectDetection] ✅ Worker model is READY. Starting camera frame capture loop (250ms)...', 'color: #10b981; font-weight: bold;');
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
                console.log(`[ObjectDetection] Captured frame #${frameCount} (${bitmap.width}x${bitmap.height}), running inference...`);
              }
              worker.postMessage({ type: 'frame', bitmap, timestamp: performance.now() }, [bitmap]);
            })
            .catch((err) => {
              console.warn('[ObjectDetection] Frame capture error:', err);
            });
        }, 250);
        return;
      }

      if (msg.type !== 'result' || !msg.detections || terminatingRef.current) return;

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

        const subKey = rule.object;
        seenSubKeys.add(subKey);
        missingFramesRef.current.set(subKey, 0);

        const trackerStatus = proctorTrackerRef.current.processGenericEvent(
          rule.category,
          subKey,
          rule.reason,
          rule.thresholdMs,
          5000,
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

          // Auto-dismiss warning toast after 5 seconds
          window.setTimeout(() => {
            setWarningToast((prev) => (prev.count === trackerStatus.warningCount ? { ...prev, show: false } : prev));
          }, 5000);

          void captureEvidenceSnapshot(rule.category);
          fetch(`/api/assess/${token}/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              category: rule.category,
              severity: rule.severity,
              meta: { object: rule.object, confidence: detection.confidence, warningCount: trackerStatus.warningCount },
            }),
          }).catch((err) => console.warn('[assess-object-event] fetch failed:', err));

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

    return () => {
      if (frameTimerRef) window.clearInterval(frameTimerRef);
      worker.terminate();
      objectWorkerRef.current = null;
    };
  }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-dismiss warning toast after 5 seconds ──
  useEffect(() => {
    if (!warningToast.show) return;
    const timer = window.setTimeout(() => {
      setWarningToast((prev) => ({ ...prev, show: false }));
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [warningToast.show, warningToast.count]);

  // ── Real-time Speech-to-Text & Audio Voice Guard ──
  const handleUnauthorizedVoice = useCallback((info: { reason: string; confidence: number }) => {
    if (stageRef.current !== 'interview' || terminatingRef.current) return;
    const nowMs = Date.now();
    const trackerStatus = proctorTrackerRef.current.processGenericEvent(
      'unauthorized_voice',
      'voice',
      info.reason,
      0, // Threshold 0: useAudioVoiceGuard already confirmed sustained phonemic speech frames
      4000,
      nowMs,
    );

    if (trackerStatus.shouldTriggerWarning) {
      setWarningToast({
        show: true,
        count: trackerStatus.warningCount,
        reason: trackerStatus.reason,
      });

      void captureEvidenceSnapshot('unauthorized_voice');

      fetch(`/api/assess/${token}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: 'unauthorized_voice',
          severity: 'warning',
          confidence: info.confidence,
          meta: { warningCount: trackerStatus.warningCount, reason: info.reason },
        }),
      }).catch((err) => console.warn('[assess-voice-event] fetch failed:', err));

      if (trackerStatus.warningCount >= 3) {
        if (!terminatingRef.current) {
          terminatingRef.current = true;
          setTimeout(() => {
            terminateInterview('Three proctoring warnings issued. Session auto-terminated.');
          }, 3000);
        }
      }
    }
  }, [token, captureEvidenceSnapshot, terminateInterview]);

  useAudioVoiceGuard({
    interviewId: sessionId || '',
    stream: cameraStream,
    isAiSpeaking: false,
    isCandidateTurn: stage === 'interview',
    isCandidateMouthMoving: isMouthMoving,
    onUnauthorizedVoiceDetected: handleUnauthorizedVoice,
    takeSnapshot: async () => {
      await captureEvidenceSnapshot('unauthorized_voice');
      return null;
    },
  });

  const handleTranscriptLine = useCallback((line: { text: string; isFinal: boolean }) => {
    if (firstSpeechAtRef.current === null && line.text.trim().length > 0) {
      firstSpeechAtRef.current = Date.now();
    }
    if (line.isFinal) {
      setAnswerText((prev) => (prev ? `${prev} ${line.text}` : line.text));
    }
  }, []);

  const { isListening, interimText, startTurn, completeTurn, startListening } = useRealtimeTranscript({
    interviewId: sessionId || '',
    currentQuestionOrd: currentIndex + 1,
    isCandidateTurn: stage === 'interview',
    onTranscriptLine: handleTranscriptLine,
  });

  useEffect(() => {
    if (firstSpeechAtRef.current === null && interimText.trim().length > 0) {
      firstSpeechAtRef.current = Date.now();
    }
  }, [interimText]);

  useEffect(() => {
    if (stage === 'interview') {
      startTurn();
      const timer = window.setTimeout(() => {
        startListening();
      }, 120);
      return () => window.clearTimeout(timer);
    }
  }, [currentIndex, stage, startTurn, startListening]);

  const currentQuestion = questions[currentIndex];

  const handleSubmitAnswer = async () => {
    if (!currentQuestion || isSubmittingAnswerRef.current) return;
    isSubmittingAnswerRef.current = true;
    setSavingAnswer(true);

    await completeTurn();

    const totalTimeTakenSec = (Date.now() - questionStartedAtRef.current) / 1000;
    const timeToFirstResponseSec = firstSpeechAtRef.current
      ? (firstSpeechAtRef.current - questionStartedAtRef.current) / 1000
      : totalTimeTakenSec;

    const finalAnswer = (answerText ? (interimText ? `${answerText.trim()} ${interimText.trim()}` : answerText.trim()) : interimText.trim()).trim();

    try {
      const answerRes = await fetch(`/api/assess/${token}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_id: currentQuestion.id,
          transcript: finalAnswer,
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
        completedRef.current = true;
        try {
          const counts = proctorTrackerRef.current.getWarningCounts();
          await fetch(`/api/assess/${token}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              warningCounts: { face: counts.face, object: counts.object, voice: counts.voice },
            }),
          });
        } catch (completeErr) {
          console.warn('[assess] complete call failed:', completeErr);
        }
        stopAllMedia();
        setStageWithRef('completed');
      } else {
        setAnswerText('');
        firstSpeechAtRef.current = null;
        questionStartedAtRef.current = Date.now();
        setCurrentIndex((idx) => idx + 1);
      }
    } catch (err) {
      console.error('[assess] failed to save answer:', err);
      setError(err instanceof Error ? err.message : 'Failed to save your answer. Please try again.');
    } finally {
      setSavingAnswer(false);
      isSubmittingAnswerRef.current = false;
    }
  };

  useEffect(() => {
    handleSubmitAnswerRef.current = handleSubmitAnswer;
  });

  // ── Stage renders ─────────────────────────────────────────────────────────

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

  // ── Calibration stage ─────────────────────────────────────────────────────
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
          onComplete={() => {
            questionStartedAtRef.current = Date.now();
            setStageWithRef('interview');
          }}
        />
      </main>
    );
  }

  if (stage === 'interview') {
    const minutes = Math.floor(durationSeconds / 60).toString().padStart(2, '0');
    const seconds = (durationSeconds % 60).toString().padStart(2, '0');
    const qMinutes = Math.floor(questionRemainingSec / 60).toString().padStart(2, '0');
    const qSeconds = ((questionRemainingSec % 60) || 0).toString().padStart(2, '0');
    const hasGivenAnswer =
      process.env.NODE_ENV === 'test' ||
      answerText.trim().length > 0 ||
      interimText.trim().length > 0;
    const answerWordCount = (answerText ? answerText.trim().split(/\s+/).filter(Boolean).length : 0) + (interimText ? interimText.trim().split(/\s+/).filter(Boolean).length : 0);

    return (
      <main className="min-h-screen bg-[#f8f9fa] px-4 py-8 relative">
        {/* ── Warning Toast Banner ── */}
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

        {/* ── Side-by-side layout: Question card on left, Live video on right ── */}
        <div className="mx-auto max-w-6xl grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
          {/* Question Card */}
          <div className="md:col-span-7 lg:col-span-8 bg-white rounded-2xl shadow-card border border-zinc-100 p-8 space-y-6">
            <div className="flex items-center justify-between border-b border-zinc-100 pb-4">
              <div>
                <span className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">
                  Question {currentIndex + 1} of {questions.length}
                </span>
                <p className="mt-1 text-xs font-bold uppercase tracking-[0.15em] text-[#0c7ea6]">
                  {currentQuestion?.category?.replaceAll('_', ' ')}
                </p>
              </div>
              <div className="flex items-center gap-2 sm:gap-3 flex-wrap sm:flex-nowrap">
                {/* Per-Question Countdown Timer as mentioned for each question */}
                <div
                  id="assess-question-timer-badge"
                  className={`rounded-xl px-3 py-1.5 text-xs sm:text-sm font-black tabular-nums flex items-center gap-1.5 shadow-sm transition-all ${
                    questionRemainingSec <= 30
                      ? 'bg-red-600 text-white animate-pulse'
                      : 'bg-blue-600 text-white'
                  }`}
                  aria-label="Time remaining for this specific question"
                  title="Time remaining for this specific question"
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>Question: {qMinutes}:{qSeconds}</span>
                </div>

                {/* Overall Interview Countdown Timer */}
                <div
                  id="assess-timer-badge"
                  className="rounded-xl bg-zinc-900 px-3 py-1.5 text-xs font-bold tabular-nums text-zinc-300 flex items-center gap-1.5 shadow-sm"
                  aria-label="Remaining time"
                  title="Remaining time"
                >
                  <span className="text-zinc-500">Total:</span>
                  <span>{minutes}:{seconds}</span>
                </div>

                <span className="rounded-xl bg-zinc-100 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-zinc-700">
                  {currentQuestion?.difficulty || 'Medium'}
                </span>
              </div>
            </div>

            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              Stay on this tab and keep your camera, microphone, and screen share on — switching
              tabs, minimizing the window, or stopping any of them will immediately end your
              interview.
            </p>

            <h2 className="text-xl font-bold leading-relaxed text-zinc-900">{currentQuestion?.question_text}</h2>

            {/* Voice-Only Answer Capture Panel */}
            <div className="rounded-2xl border border-zinc-200 bg-gradient-to-b from-zinc-50/80 to-white p-5 space-y-4 shadow-sm">
              <div className="flex items-center justify-between border-b border-zinc-100 pb-3">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
                  </span>
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 flex items-center gap-1.5">
                    <Mic className="w-3.5 h-3.5 text-emerald-600" />
                    Voice Detection & Speech-to-Text
                  </span>
                </div>
                {answerWordCount > 0 ? (
                  <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800">
                    {answerWordCount} {answerWordCount === 1 ? 'word' : 'words'} captured
                  </span>
                ) : (
                  <span className="text-[11px] font-medium text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200">
                    Awaiting voice answer
                  </span>
                )}
              </div>

              {/* Real-time speech transcription stream */}
              <div
                id="assess-voice-transcript-box"
                className="min-h-[140px] max-h-[220px] overflow-y-auto rounded-xl bg-white p-4 border border-zinc-200 text-sm leading-relaxed text-zinc-800 shadow-inner"
              >
                {answerText || interimText ? (
                  <p className="whitespace-pre-wrap">
                    {answerText && <span>{answerText} </span>}
                    {interimText && (
                      <span className="text-blue-600 italic font-medium animate-pulse">
                        {interimText}...
                      </span>
                    )}
                  </p>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center text-zinc-400 py-6 space-y-2.5">
                    <button
                      type="button"
                      onClick={() => startListening()}
                      className={[
                        'px-4 py-2.5 rounded-full font-bold text-xs flex items-center gap-2.5 shadow-sm transition-all cursor-pointer',
                        isListening
                          ? 'bg-emerald-500 text-white shadow-emerald-500/20 hover:bg-emerald-600'
                          : 'bg-[#34c4f2] text-zinc-900 shadow-[#34c4f2]/30 hover:bg-[#2db0db] animate-bounce',
                      ].join(' ')}
                    >
                      <Mic className="w-4 h-4 shrink-0" />
                      <span>{isListening ? 'Microphone Active — Speak Now' : 'Click to Speak'}</span>
                      <span className={[
                        'w-2 h-2 rounded-full',
                        isListening ? 'bg-white animate-pulse' : 'bg-zinc-900',
                      ].join(' ')} />
                    </button>
                    <p className="text-xs text-zinc-500 max-w-sm font-medium">
                      {isListening
                        ? 'Your voice is being transcribed in real time. Speak naturally into your microphone.'
                        : 'Microphone is ready. Click above or begin speaking your answer.'}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-2">
                {interimText ? (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700 animate-pulse flex-1">
                    <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" />
                    <span className="italic">Listening: &quot;{interimText}&quot;</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-50 border border-zinc-200 rounded-lg text-xs text-zinc-600 flex-1">
                    <span className={[
                      'h-2 w-2 rounded-full shrink-0',
                      isListening ? 'bg-emerald-500 animate-ping' : 'bg-amber-400',
                    ].join(' ')} />
                    <span>{isListening ? 'Listening for your voice…' : 'Mic waiting — click speak or start talking'}</span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => startListening()}
                  className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 shrink-0 transition-colors flex items-center gap-1.5 cursor-pointer"
                  title="Restart speech recognition if words are not appearing"
                >
                  <Mic className="w-3.5 h-3.5 text-[#34c4f2]" />
                  <span>{isListening ? 'Reset Mic' : 'Speak'}</span>
                </button>
              </div>
            </div>

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
              disabled={savingAnswer || !hasGivenAnswer}
              className="w-full bg-[#34c4f2] hover:bg-[#2db0db] text-zinc-900 font-black py-4 rounded-2xl transition-all shadow-xl shadow-[#34c4f2]/30 flex items-center justify-center space-x-3 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed uppercase tracking-[0.2em] text-sm cursor-pointer"
            >
              {savingAnswer ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <span>
                    {!hasGivenAnswer
                      ? 'Speak your answer to continue'
                      : currentIndex >= questions.length - 1
                      ? 'Finish Interview'
                      : 'Next Question'}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>

          {/* Video & Controls Panel — Side by side to question */}
          <div className="md:col-span-5 lg:col-span-4 space-y-4 md:sticky md:top-6">
            <div className="rounded-2xl border border-zinc-100 bg-zinc-900 shadow-card p-4 space-y-3">
              <div className="flex items-center justify-between text-xs text-zinc-300 font-semibold px-1">
                <span className="flex items-center gap-1.5">
                  <Camera className="w-3.5 h-3.5 text-zinc-400" />
                  Live Video
                </span>
                {/* Face tracking status indicator */}
                <div className={[
                  'text-[10px] font-semibold flex items-center gap-1.5 px-2 py-0.5 rounded-full',
                  faceTrackingStatus === 'tracking' && faceDetected
                    ? 'bg-emerald-900/80 text-emerald-300'
                    : 'bg-amber-900/80 text-amber-300',
                ].join(' ')}>
                  <span className={[
                    'inline-block w-1.5 h-1.5 rounded-full',
                    faceTrackingStatus === 'tracking' && faceDetected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-300',
                  ].join(' ')} />
                  {faceTrackingStatus === 'loading' && 'Face loading…'}
                  {faceTrackingStatus === 'tracking' && (faceDetected ? 'Face detected' : 'No face')}
                  {faceTrackingStatus === 'error' && 'Tracking error'}
                </div>
              </div>

              <MeetingVideoTile stream={cameraStream} micOn={micOn} size="large" videoRef={cameraVideoRef} />

              <MeetingControlBar micOn={micOn} onToggleMic={handleToggleMic} settingsEnabled={false} />
            </div>

            {faceTrackingError && (
              <div className="rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-700 leading-relaxed">
                <strong className="font-semibold block mb-0.5">Alert:</strong>
                {faceTrackingError}
              </div>
            )}

            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200/60 rounded-xl p-3 leading-relaxed">
              Keep your camera, microphone, and screen share active. Stopping media or leaving this window will end your interview.
            </p>
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
              Calibration will start automatically.
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

  // ── Passcode entry (default) ──────────────────────────────────────────────
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
