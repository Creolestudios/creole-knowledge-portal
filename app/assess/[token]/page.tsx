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

type Stage = 'passcode' | 'instructions' | 'permissions' | 'ready' | 'calibration' | 'interview' | 'completed' | 'terminated' | 'expired';

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
import { ExpiredInterviewLink } from '@/components/ai-interview/expired-interview-link';

export default function CandidateAssessmentPage() {
  const params = useParams();
  const token = (params?.token as string) || (params?.id as string);

  const [stage, setStage] = useState<Stage>(() => {
    if (typeof window !== 'undefined' && token) {
      try {
        const refreshReason =
          sessionStorage.getItem(`assess_refresh_terminated_${token}`) ||
          (sessionStorage.getItem(`assess_live_active_${token}`) === 'true'
            ? 'The candidate refreshed or closed the page during the live interview.'
            : null);
        if (refreshReason) {
          return 'terminated';
        }
        if (
          localStorage.getItem(`assess_used_${token}`) === 'true' ||
          sessionStorage.getItem(`assess_used_${token}`) === 'true'
        ) {
          return 'expired';
        }
      } catch {
        // ignore
      }
    }
    return 'passcode';
  });

  // ── stageRef: always reflects the latest stage so worker callbacks
  // never capture a stale value from their closure.
  const stageRef = useRef<Stage>(stage);
  const setStageWithRef = useCallback((next: Stage) => {
    stageRef.current = next;
    setStage(next);
  }, []);

  const [expiredNote, setExpiredNote] = useState<string>('Note: This interview link has already been used and is expired.');
  const [expirationReason, setExpirationReason] = useState<string | undefined>(undefined);
  const [expirationTitle, setExpirationTitle] = useState<string | undefined>(undefined);
  const [expirationDetail, setExpirationDetail] = useState<string | undefined>(undefined);
  const [expirationViolationReason, setExpirationViolationReason] = useState<string | undefined>(undefined);
  const [expirationWarningCount, setExpirationWarningCount] = useState<number | undefined>(undefined);
  const [isVerifyingLink, setIsVerifyingLink] = useState<boolean>(() => {
    if (process.env.NODE_ENV === 'test') return false;
    if (typeof window !== 'undefined' && token) {
      try {
        const hasRefreshReason =
          Boolean(sessionStorage.getItem(`assess_refresh_terminated_${token}`)) ||
          sessionStorage.getItem(`assess_live_active_${token}`) === 'true';
        if (hasRefreshReason) {
          return false;
        }
      } catch {
        // ignore
      }
    }
    return true;
  });

  const [deviceId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      try {
        let stored = sessionStorage.getItem('assess_device_id');
        if (!stored) {
          stored = 'dev_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36);
          sessionStorage.setItem('assess_device_id', stored);
        }
        return stored;
      } catch {
        // ignore
      }
    }
    return 'dev_' + Math.random().toString(36).substring(2, 10);
  });

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

  const [showAckPopup, setShowAckPopup] = useState(false);
  const [ackChecked, setAckChecked] = useState(false);

  const [terminationReason, setTerminationReason] = useState<string | null>(() => {
    if (typeof window !== 'undefined' && token) {
      try {
        return (
          sessionStorage.getItem(`assess_refresh_terminated_${token}`) ||
          (sessionStorage.getItem(`assess_live_active_${token}`) === 'true'
            ? 'The candidate refreshed or closed the page during the live interview.'
            : null)
        );
      } catch {
        // ignore
      }
    }
    return null;
  });

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
  const [isInterviewPaused, setIsInterviewPaused] = useState(false);
  const isInterviewPausedRef = useRef(false);
  const resumeCooldownUntilRef = useRef<number>(0);

  const [durationSeconds, setDurationSeconds] = useState(15 * 60);
  const durationSecondsRef = useRef(15 * 60);
  const completedRef = useRef(false);

  // ── Refs ──
  const interimTextRef = useRef('');
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const terminatedRef = useRef(false);
  const terminatingRef = useRef(false);
  const faceWorkerRef = useRef<Worker | null>(null);
  const objectWorkerRef = useRef<Worker | null>(null);
  const objectWorkerReadyRef = useRef<boolean>(false);
  const voiceDetectorRef = useRef<VoiceDetector | null>(null);
  const proctorTrackerRef = useRef<ProctoringTimeTracker>(new ProctoringTimeTracker());
  const baselineRef = useRef<CandidateBaseline | null>(null);
  const missingFramesRef = useRef<Map<string, number>>(new Map());
  const consecutiveDetectedFramesRef = useRef<Map<string, number>>(new Map());
  const isSubmittingAnswerRef = useRef(false);
  const autoSubmittedQuestionIdxRef = useRef<number | null>(null);
  const lastSpeechAtRef = useRef<number>(0);
  const [silenceCountdown, setSilenceCountdown] = useState<number | null>(null);
  const currentIndexRef = useRef(currentIndex);
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);
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
    try {
      localStorage.setItem(`assess_used_${token}`, 'true');
      sessionStorage.setItem(`assess_used_${token}`, 'true');
      sessionStorage.setItem(
        `assess_refresh_terminated_${token}`,
        sessionStorage.getItem(`assess_refresh_terminated_${token}`) || reason
      );
    } catch {
      // ignore
    }

    // Flush and save candidate's current answer if any speech was recorded
    const curQ = questions[currentIndex];
    const liveInterim = interimTextRef.current.trim();
    const currentSpeech = (answerText ? liveInterim ? `${answerText.trim()} ${liveInterim}` : answerText.trim() : liveInterim).trim();
    if (curQ?.id && currentSpeech) {
      fetch(`/api/assess/${token}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_id: curQ.id, transcript: currentSpeech }),
        keepalive: true,
      }).catch(console.warn);
    }

    stopAllMedia();
    notifyTermination(reason);
    setTerminationReason(reason);
    setStageWithRef('terminated');
  }, [notifyTermination, stopAllMedia, setStageWithRef, questions, currentIndex, answerText, token]);

  const captureEvidenceSnapshot = useCallback(async (category: string): Promise<string | null> => {
    const video = cameraVideoRef.current;
    if (!video) return null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', 0.8);
      });
      if (!blob) return null;

      const formData = new FormData();
      formData.append('token', token);
      formData.append('category', category);
      formData.append('file', blob, 'snapshot.jpg');

      const res = await fetch('/api/assess/snapshots', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        console.warn('[assess-snapshot] upload failed with status:', res.status);
        return null;
      }
      const data = await res.json();
      return (data?.path as string) || null;
    } catch (err) {
      console.warn('[assess-snapshot] capture exception:', err);
      return null;
    }
  }, [token]);

  // Release devices on unmount
  useEffect(() => {
    return () => {
      stopAllMedia();
    };
  }, [stopAllMedia]);

  // Initial link verification on mount to check if link was once used / expired
  useEffect(() => {
    if (!token) return;
    if (process.env.NODE_ENV === 'test') return;
    let isMounted = true;

    fetch(`/api/assess/${encodeURIComponent(token)}/verify`)
      .then(async (res) => {
        if (!isMounted) return;
          if (res.status === 410) {
          const json = await res.json().catch(() => ({}));
          try {
            localStorage.setItem(`assess_used_${token}`, 'true');
            sessionStorage.setItem(`assess_used_${token}`, 'true');
          } catch {
            // ignore
          }
          if (json.expirationReason) {
            setExpirationReason(json.expirationReason);
          }
          if (json.reasonTitle) {
            setExpirationTitle(json.reasonTitle);
          }
          if (json.reasonDetail) {
            setExpirationDetail(json.reasonDetail);
          }
          if (json.violationReason) {
            setExpirationViolationReason(json.violationReason);
          }
          if (json.warningCount) {
            setExpirationWarningCount(json.warningCount);
          }
          if (json.expired || json.used || json.expirationReason) {
            setExpiredNote(json.reasonDetail || json.note || json.error || 'Note: This interview link has already been used and is expired.');

            // If the candidate refreshed during the live interview, they are viewing the termination screen.
            // Keep the termination screen displayed! Do not switch to the expired link screen.
            if (stageRef.current === 'terminated') {
              try {
                sessionStorage.removeItem(`assess_refresh_terminated_${token}`);
                sessionStorage.removeItem(`assess_live_active_${token}`);
              } catch {
                // ignore
              }
              return;
            }

            setStageWithRef('expired');
          }
        } else if (res.ok) {
          try {
            localStorage.removeItem(`assess_used_${token}`);
            sessionStorage.removeItem(`assess_used_${token}`);
          } catch {
            // ignore
          }
        }
      })
      .catch(() => { })
      .finally(() => {
        if (isMounted) {
          setIsVerifyingLink(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [token, setStageWithRef]);

  const handleSubmitPasscode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch(`/api/assess/${token}/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-device-id': deviceId,
        },
        body: JSON.stringify({ passcode, deviceId }),
      });
      const json = await res.json();

      if (res.status === 409 || json.concurrent) {
        setError(json.error || 'An active interview session is already in progress on another device. Simultaneous access to the same interview link is prohibited.');
        return;
      }

      if (res.status === 410) {
        try {
          localStorage.setItem(`assess_used_${token}`, 'true');
          sessionStorage.setItem(`assess_used_${token}`, 'true');
        } catch {
          // ignore
        }
        if (json.expirationReason) {
          setExpirationReason(json.expirationReason);
        }
        if (json.reasonTitle) {
          setExpirationTitle(json.reasonTitle);
        }
        if (json.reasonDetail) {
          setExpirationDetail(json.reasonDetail);
        }
        if (json.violationReason) {
          setExpirationViolationReason(json.violationReason);
        }
        if (json.warningCount) {
          setExpirationWarningCount(json.warningCount);
        }
        setExpiredNote(json.reasonDetail || json.note || json.error || 'Note: This interview link has already been used and is expired.');
        setStageWithRef('expired');
        return;
      }

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

      let controller: any;
      if (typeof window !== 'undefined' && 'CaptureController' in window) {
        // @ts-ignore
        controller = new CaptureController();
      }

      const screenStream = await navigator.mediaDevices.getDisplayMedia({ 
        video: { displaySurface: 'monitor' } as any,
        ...(controller ? { controller } : {}),
      } as any);

      if (controller) {
        try {
          controller.setFocusBehavior('no-focus-change');
        } catch (e) {}
      }

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
      if (process.env.NODE_ENV === 'test') {
        setStageWithRef('ready');
      } else {
        setShowAckPopup(true);
      }
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
  useEffect(() => {
    if (stage === 'interview' && questions[currentIndex]) {
      const qSec = questions[currentIndex].time_limit_sec || 120;
      questionRemainingSecRef.current = qSec;
      window.setTimeout(() => setQuestionRemainingSec(qSec), 0);
    }
  }, [currentIndex, stage, questions]);

  // ── Countdown timer for current question & auto-advancement on time completion ──
  useEffect(() => {
    if (stage !== 'interview' || isInterviewPaused) return;
    const timer = window.setInterval(() => {
      // 1. Overall interview duration tracking
      if (durationSecondsRef.current > 0) {
        durationSecondsRef.current -= 1;
        setDurationSeconds(durationSecondsRef.current);
      }

      // 2. Per-question timer countdown
      if (questionRemainingSecRef.current <= 1) {
        questionRemainingSecRef.current = 0;
        setQuestionRemainingSec(0);
        // Time is up for this question: auto-advance to next question once
        if (
          autoSubmittedQuestionIdxRef.current !== currentIndexRef.current &&
          !isSubmittingAnswerRef.current &&
          handleSubmitAnswerRef.current
        ) {
          autoSubmittedQuestionIdxRef.current = currentIndexRef.current;
          void handleSubmitAnswerRef.current();
        }
      } else {
        questionRemainingSecRef.current -= 1;
        setQuestionRemainingSec(questionRemainingSecRef.current);

        // 3. Silence auto-advance (when candidate has spoken and remains silent for >= 5s)
        if (
          lastSpeechAtRef.current > 0 &&
          !isSubmittingAnswerRef.current &&
          handleSubmitAnswerRef.current
        ) {
          const silentSec = (Date.now() - lastSpeechAtRef.current) / 1000;
          if (silentSec >= 7) {
            setSilenceCountdown(null);
            autoSubmittedQuestionIdxRef.current = currentIndexRef.current;
            void handleSubmitAnswerRef.current();
          } else if (silentSec >= 4) {
            setSilenceCountdown(Math.max(1, Math.ceil(7 - silentSec)));
          } else {
            setSilenceCountdown(null);
          }
        }
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [stage, isInterviewPaused]);

  useProctoringWatchdog({
    active: stage === 'interview',
    cameraStreamRef,
    screenStreamRef,
    onViolation: terminateInterview,
  });

  // Track active live interview in sessionStorage so refresh can be distinguished from reopening
  useEffect(() => {
    if (stage === 'interview' && token) {
      try {
        sessionStorage.setItem(`assess_live_active_${token}`, 'true');
        sessionStorage.removeItem(`assess_refresh_terminated_${token}`);
      } catch {
        // ignore
      }
    }
  }, [stage, token]);

  // Mark link used and clean up refresh tracking flags once terminated or completed stage is reached
  useEffect(() => {
    if ((stage === 'terminated' || stage === 'completed') && token) {
      try {
        localStorage.setItem(`assess_used_${token}`, 'true');
        sessionStorage.setItem(`assess_used_${token}`, 'true');
        sessionStorage.removeItem(`assess_refresh_terminated_${token}`);
        sessionStorage.removeItem(`assess_live_active_${token}`);
      } catch {
        // ignore
      }
    }
  }, [stage, token]);

  // Prevent candidate from accidentally closing or refreshing tab during live interview
  useEffect(() => {
    if (stage !== 'interview') return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      try {
        sessionStorage.setItem(
          `assess_refresh_terminated_${token}`,
          'The candidate refreshed or closed the page during the live interview.'
        );
      } catch {
        // ignore
      }
      e.preventDefault();
      e.returnValue = 'An interview is currently in progress. Leaving will terminate your session.';
      return e.returnValue;
    };

    const handleFocus = () => {
      if (stageRef.current === 'interview') {
        try {
          sessionStorage.removeItem(`assess_refresh_terminated_${token}`);
        } catch {
          // ignore
        }
      }
    };

    const handlePageHide = () => {
      try {
        sessionStorage.setItem(
          `assess_refresh_terminated_${token}`,
          'The candidate refreshed or closed the page during the live interview.'
        );
      } catch {
        // ignore
      }
      terminateInterview('The candidate refreshed or closed the page during the live interview.');
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [stage, token, terminateInterview]);

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
      const activeVideo = cameraVideoRef.current || videoElement;
      if (timestamp - lastFrameAt >= 125 && activeVideo) {
        if (activeVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
            frameRequest = activeVideo.requestVideoFrameCallback(captureFrame);
          }
          return;
        }
        lastFrameAt = timestamp;
        try {
          const bitmap = await createImageBitmap(activeVideo);
          worker.postMessage({ type: 'frame', bitmap, timestamp }, [bitmap]);
        } catch (err) {
          setFaceTrackingStatus('error');
          setFaceTrackingError(err instanceof Error ? err.message : 'Camera frame could not be read.');
        }
      }
      const nextVideo = cameraVideoRef.current || videoElement;
      if (nextVideo && 'requestVideoFrameCallback' in HTMLVideoElement.prototype) {
        frameRequest = nextVideo.requestVideoFrameCallback(captureFrame);
      }
    };

    const captureTimer = window.setInterval(() => {
      if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) void captureFrame(performance.now());
    }, 125);

    const startTimer = window.setTimeout(() => {
      const nextVideo = cameraVideoRef.current || videoElement;
      if ('requestVideoFrameCallback' in HTMLVideoElement.prototype && nextVideo) {
        frameRequest = nextVideo.requestVideoFrameCallback(captureFrame);
      }
    }, 250);

    return () => {
      window.clearTimeout(startTimer);
      window.clearInterval(captureTimer);
      const activeVideo = cameraVideoRef.current || videoElement;
      if (frameRequest && activeVideo?.cancelVideoFrameCallback) {
        activeVideo.cancelVideoFrameCallback(frameRequest);
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
        if (
          stageRef.current !== 'interview' ||
          terminatingRef.current ||
          isInterviewPausedRef.current ||
          Date.now() < resumeCooldownUntilRef.current
        ) return;

        const trackerStatus = proctorTrackerRef.current.processResult(msg, Date.now());

        if (trackerStatus.shouldTriggerWarning) {
          setIsInterviewPaused(true);
          isInterviewPausedRef.current = true;
          setWarningToast({
            show: true,
            count: trackerStatus.warningCount,
            reason: trackerStatus.reason,
          });

          void (async () => {
            const snapshotPath = await captureEvidenceSnapshot(trackerStatus.category);
            await fetch(`/api/assess/${token}/events`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                category: trackerStatus.category,
                severity: 'warning',
                snapshotPath: snapshotPath || undefined,
                meta: { warningCount: trackerStatus.warningCount, reason: trackerStatus.reason },
              }),
            }).catch((err) => console.warn('[assess-proctor-event] fetch failed:', err));
          })();

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
    const isProctorStage = ['ready', 'calibration', 'interview'].includes(stage);
    if (!isProctorStage) {
      if (objectWorkerRef.current) {
        objectWorkerRef.current.terminate();
        objectWorkerRef.current = null;
        objectWorkerReadyRef.current = false;
      }
      return;
    }

    if (typeof Worker === 'undefined') {
      console.warn('[ObjectDetection] Web Workers not supported in this browser environment');
      return;
    }

    let worker = objectWorkerRef.current;
    if (!worker) {
      console.log(`%c[ObjectDetection] Pre-initializing Object Detection Worker early in stage: ${stage}...`, 'color: #06b6d4; font-weight: bold;');
      worker = new Worker(
        new URL('../../../lib/ai-interview/object-detection.worker.ts', import.meta.url),
      );
      objectWorkerRef.current = worker;
      objectWorkerReadyRef.current = false;
      console.log('[ObjectDetection] Sending init to worker');
      worker.postMessage({ type: 'init' });
    }

    let frameTimerRef: number | null = null;
    let frameCount = 0;

    worker.onerror = (err) => {
      console.warn('%c[ObjectDetection Error] Worker runtime exception:', 'color: #ef4444; font-weight: bold;', err);
    };

    const startCaptureLoop = () => {
      if (frameTimerRef !== null) return;
      console.log('%c[ObjectDetection] ✅ Starting camera frame capture loop (120ms)...', 'color: #10b981; font-weight: bold;');
      frameTimerRef = window.setInterval(() => {
        if (stageRef.current !== 'interview') return;
        const video = cameraVideoRef.current;
        if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          return;
        }
        createImageBitmap(video)
          .then((bitmap) => {
            frameCount += 1;
            if (frameCount % 20 === 1) {
              console.log(`[ObjectDetection] Captured frame #${frameCount} (${bitmap.width}x${bitmap.height}), running inference...`);
            }
            worker?.postMessage({ type: 'frame', bitmap, timestamp: performance.now() }, [bitmap]);
          })
          .catch((err) => {
            console.warn('[ObjectDetection] Frame capture error:', err);
          });
      }, 120);
    };

    worker.onmessage = (event: MessageEvent<{ type: string; detections?: DetectedObjectEvent[]; message?: string }>) => {
      const msg = event.data;

      if (msg.type === 'error') {
        console.warn('%c[ObjectDetection Error]', 'color: #ef4444; font-weight: bold;', msg.message);
        return;
      }

      if (msg.type === 'ready') {
        console.log('%c[ObjectDetection] ✅ Worker model is READY.', 'color: #10b981; font-weight: bold;');
        objectWorkerReadyRef.current = true;
        if (stageRef.current === 'interview') {
          startCaptureLoop();
        }
        return;
      }

      if (
        msg.type !== 'result' ||
        !msg.detections ||
        terminatingRef.current ||
        isInterviewPausedRef.current ||
        Date.now() < resumeCooldownUntilRef.current
      ) return;

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

        // Immediately process unauthorized object upon detection
        const trackerStatus = proctorTrackerRef.current.processGenericEvent(
          rule.category,
          subKey,
          rule.reason,
          rule.thresholdMs,
          5000,
          nowMs,
        );

        if (trackerStatus.shouldTriggerWarning) {
          setIsInterviewPaused(true);
          isInterviewPausedRef.current = true;
          console.warn(
            `%c[ObjectDetection] ⚠️ PROCTORING ALERT #${trackerStatus.warningCount}: ${trackerStatus.reason}`,
            'color: #dc2626; font-weight: bold; font-size: 14px; background: #fee2e2; padding: 4px; border-radius: 4px;',
          );

          // 1. Direct synchronous capture snapshot from live video frame FIRST
          const snapshotPromise = captureEvidenceSnapshot('object');

          // 2. Direct show warning toast to user
          setWarningToast({
            show: true,
            count: trackerStatus.warningCount,
            reason: trackerStatus.reason,
          });

          // Evidence snapshot + DB event with snapshot_path
          void (async () => {
            const snapshotPath = await snapshotPromise;
            await fetch(`/api/assess/${token}/events`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                category: 'object',
                severity: rule.severity,
                snapshotPath: snapshotPath || undefined,
                meta: { object: rule.object, confidence: detection.confidence, warningCount: trackerStatus.warningCount },
              }),
            }).catch((err) => console.warn('[assess-object-event] fetch failed:', err));
          })();

          if (trackerStatus.warningCount >= 3) {
            if (!terminatingRef.current) {
              terminatingRef.current = true;
              setTimeout(() => {
                terminateInterview('Three proctoring warnings issued. Session auto-terminated.');
              }, 3000);
            }
          }

          // Enforce 1 alert per detection cycle and respect category break
          break;
        }
      }

      const allObjectSubKeys = Object.keys(OBJECT_RULES);
      for (const subKey of allObjectSubKeys) {
        if (!seenSubKeys.has(subKey)) {
          consecutiveDetectedFramesRef.current.set(subKey, 0);
          const missCount = (missingFramesRef.current.get(subKey) || 0) + 1;
          missingFramesRef.current.set(subKey, missCount);
          if (missCount >= 2) {
            proctorTrackerRef.current.clearGenericKey('object_detected', subKey);
          }
        }
      }
    };

    if (stage === 'interview' && objectWorkerReadyRef.current) {
      startCaptureLoop();
    }

    return () => {
      if (frameTimerRef !== null) {
        window.clearInterval(frameTimerRef);
        frameTimerRef = null;
      }
      if ((stage as string) === 'completed' || (stage as string) === 'terminated') {
        worker?.terminate();
        objectWorkerRef.current = null;
        objectWorkerReadyRef.current = false;
      }
    };
  }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleResumeInterview = useCallback(() => {
    setWarningToast((prev) => ({ ...prev, show: false }));
    setIsInterviewPaused(false);
    isInterviewPausedRef.current = false;
    resumeCooldownUntilRef.current = Date.now() + 3000; // 3-second grace cooldown break
    proctorTrackerRef.current.clearActiveViolations();
    missingFramesRef.current.clear();
    consecutiveDetectedFramesRef.current.clear();
  }, []);

  // ── Real-time Speech-to-Text & Audio Voice Guard ──
  const handleUnauthorizedVoice = useCallback((info: { reason: string; confidence: number; durationMs?: number }) => {
    if (
      stageRef.current !== 'interview' ||
      terminatingRef.current ||
      isInterviewPausedRef.current ||
      Date.now() < resumeCooldownUntilRef.current
    ) return;
    const nowMs = Date.now();

    let voiceReason = info.reason;
    if (info.reason.includes('music')) {
      voiceReason = 'Background music detected.';
    } else if (info.reason.includes('typing')) {
      voiceReason = 'Keyboard typing sounds detected.';
    } else if (info.durationMs && info.durationMs >= 10000) {
      voiceReason = 'Background voice detected.';
    } else {
      voiceReason =
        'Background voice detected. Please ensure that no other person or voice is present during the interview.';
    }

    const trackerStatus = proctorTrackerRef.current.processGenericEvent(
      'unauthorized_voice',
      'voice',
      voiceReason,
      0, // Threshold 0: useAudioVoiceGuard already confirmed sustained phonemic speech frames
      10000, // 10-second break / cooldown between consecutive voice warnings
      nowMs,
    );

    if (trackerStatus.shouldTriggerWarning) {
      setIsInterviewPaused(true);
      isInterviewPausedRef.current = true;
      setWarningToast({
        show: true,
        count: trackerStatus.warningCount,
        reason: voiceReason,
      });

      void (async () => {
        const snapshotPath = await captureEvidenceSnapshot('unauthorized_voice');
        await fetch(`/api/assess/${token}/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: 'unauthorized_voice',
            severity: 'warning',
            confidence: info.confidence,
            snapshotPath: snapshotPath || undefined,
            meta: { warningCount: trackerStatus.warningCount, reason: voiceReason },
          }),
        }).catch((err) => console.warn('[assess-voice-event] fetch failed:', err));
      })();

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
    // Guard is active during the entire interview stage. The optimistic UI means
    // there's no longer a 1-4s blocking window; transitions are instant.
    isCandidateTurn: stage === 'interview' && !isInterviewPaused,
    isCandidateMouthMoving: isMouthMoving,
    onUnauthorizedVoiceDetected: handleUnauthorizedVoice,
    takeSnapshot: async () => {
      await captureEvidenceSnapshot('unauthorized_voice');
      return null;
    },
    readingGracePeriodMs: 0,
    continuousVoiceMs: 2500,
  });

  const handleTranscriptLine = useCallback((line: { text: string; isFinal: boolean }) => {
    if (line.text.trim().length > 0) {
      if (firstSpeechAtRef.current === null) {
        firstSpeechAtRef.current = Date.now();
      }
      lastSpeechAtRef.current = Date.now();
      setSilenceCountdown(null);
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
    interimTextRef.current = interimText;
    if (interimText.trim().length > 0) {
      if (firstSpeechAtRef.current === null) {
        firstSpeechAtRef.current = Date.now();
      }
      lastSpeechAtRef.current = Date.now();
      queueMicrotask(() => {
        setSilenceCountdown(null);
      });
    }
  }, [interimText]);

  useEffect(() => {
    if (stage === 'interview') {
      try {
        localStorage.setItem(`assess_used_${token}`, 'true');
        sessionStorage.setItem(`assess_used_${token}`, 'true');
      } catch {
        // ignore
      }
      startTurn();
      const timer = window.setTimeout(() => {
        startListening();
      }, 120);
      return () => window.clearTimeout(timer);
    }
  }, [currentIndex, stage, startTurn, startListening, token]);

  const currentQuestion = questions[currentIndex];

  const handleSubmitAnswer = async () => {
    if (!currentQuestion || isSubmittingAnswerRef.current) return;
    isSubmittingAnswerRef.current = true;
    setSavingAnswer(true);
    setError(null);
    setSilenceCountdown(null);

    // Capture all values synchronously before any state changes
    const questionId = currentQuestion.id;
    const totalTimeTakenSec = Math.max(1, (Date.now() - questionStartedAtRef.current) / 1000);
    const timeToFirstResponseSec = firstSpeechAtRef.current
      ? Math.max(0, (firstSpeechAtRef.current - questionStartedAtRef.current) / 1000)
      : totalTimeTakenSec;

    // Merge confirmed + in-flight interim text immediately
    const finalAnswer = (answerText
      ? interimText
        ? `${answerText.trim()} ${interimText.trim()}`
        : answerText.trim()
      : interimText.trim()
    ).trim();

    const isLastQuestion = currentIndex >= questions.length - 1;

    try {
      void completeTurn(finalAnswer);

      // Controller with 8-second timeout so network lag never freezes candidate UI
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const answerRes = await fetch(`/api/assess/${token}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          question_id: questionId,
          transcript: finalAnswer,
          time_to_first_response_sec: timeToFirstResponseSec,
          total_time_taken_sec: totalTimeTakenSec,
        }),
      }).finally(() => clearTimeout(timeoutId));

      if (!answerRes.ok) {
        const answerJson = await answerRes.json().catch(() => null);
        throw new Error(answerJson?.error ?? 'Failed to save your answer.');
      }

      if (isLastQuestion) {
        completedRef.current = true;
        const counts = proctorTrackerRef.current.getWarningCounts();
        await fetch(`/api/assess/${token}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            warningCounts: { face: counts.face, object: counts.object, voice: counts.voice },
          }),
        }).catch((completeErr) => {
          console.warn('[assess] complete call failed:', completeErr);
          return null;
        });

        stopAllMedia();
        setStageWithRef('completed');
      } else {
        const nextIdx = currentIndex + 1;
        const nextQSec = questions[nextIdx]?.time_limit_sec || 120;
        firstSpeechAtRef.current = null;
        lastSpeechAtRef.current = 0;
        questionStartedAtRef.current = Date.now();
        questionRemainingSecRef.current = nextQSec;
        autoSubmittedQuestionIdxRef.current = null;
        setQuestionRemainingSec(nextQSec);
        setAnswerText('');
        setCurrentIndex(nextIdx);
      }
    } catch (err) {
      console.error('[assess] failed to save answer:', err);
      // If time has expired and it was an automated advance, proceed anyway so candidate isn't stuck forever
      if (questionRemainingSecRef.current <= 0 && !isLastQuestion) {
        const nextIdx = currentIndex + 1;
        const nextQSec = questions[nextIdx]?.time_limit_sec || 120;
        firstSpeechAtRef.current = null;
        lastSpeechAtRef.current = 0;
        questionStartedAtRef.current = Date.now();
        questionRemainingSecRef.current = nextQSec;
        autoSubmittedQuestionIdxRef.current = null;
        setQuestionRemainingSec(nextQSec);
        setAnswerText('');
        setCurrentIndex(nextIdx);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to save your answer. Please try again.');
      }
    } finally {
      setSavingAnswer(false);
      isSubmittingAnswerRef.current = false;
    }
  };


  useEffect(() => {
    handleSubmitAnswerRef.current = handleSubmitAnswer;
  });

  // ── Stage renders ─────────────────────────────────────────────────────────

  if (isVerifyingLink) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#f8f9fa] px-4">
        <div className="flex flex-col items-center justify-center space-y-4">
          <div className="w-10 h-10 border-3 border-zinc-200 border-t-[#34c4f2] rounded-full animate-spin" />
          <p className="text-sm font-medium text-zinc-500">Checking interview status...</p>
        </div>
      </main>
    );
  }

  if (stage === 'expired') {
    return (
      <ExpiredInterviewLink
        note={expiredNote}
        isUsed={true}
        reason={expirationReason}
        reasonTitle={expirationTitle}
        reasonDetail={expirationDetail}
        violationReason={expirationViolationReason || (expirationReason === 'violation' ? (terminationReason || undefined) : undefined)}
        warningCount={expirationWarningCount}
      />
    );
  }

  if (stage === 'terminated') {
    return <TerminatedInterview terminationReason={terminationReason} />;
  }

  if (stage === 'completed') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#f8f9fa] dark:bg-[#121212] px-4 transition-colors">
        <div className="max-w-md w-full bg-white dark:bg-[#2b2b2b] rounded-2xl shadow-card border border-zinc-100 dark:border-[#4a4a4a] p-8 text-center space-y-4">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
          <h1 className="text-xl font-bold text-zinc-900 dark:text-white">Interview complete</h1>
          <p className="text-sm text-zinc-500 dark:text-[#9f9f9f]">
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
      <main className="min-h-screen bg-[#f8f9fa] dark:bg-[#121212] flex items-center justify-center relative transition-colors">
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
      <main className="min-h-screen bg-[#f8f9fa] dark:bg-[#121212] px-4 py-8 relative transition-colors">
        {/* Full Screen Blur Overlay on Pause */}
        {isInterviewPaused && (
          <div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-md transition-all duration-300 pointer-events-auto"
            aria-hidden="true"
          />
        )}

        {/* ── Warning Toast Banner ── */}
        {warningToast.show && (
          <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 max-w-2xl w-full px-4 animate-in slide-in-from-top duration-300">
            <div className="bg-amber-500 text-white rounded-2xl shadow-2xl p-4 flex items-center justify-between border border-amber-400 gap-4">
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
                onClick={handleResumeInterview}
                className="text-white font-bold text-xs bg-amber-600 hover:bg-amber-700 border border-amber-300/40 rounded-xl px-4 py-2 transition-all shadow-md flex-shrink-0 cursor-pointer"
              >
                Resume Interview
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
                <p className="mt-1 text-xs font-bold uppercase tracking-[0.15em] text-[#34c4f2]">
                  {currentQuestion?.category?.replaceAll('_', ' ')}
                </p>
              </div>
              <div className="flex items-center gap-2 sm:gap-3 flex-wrap sm:flex-nowrap">
                {/* Per-Question Countdown Timer Only */}
                <div
                  id="assess-timer-badge"
                  data-testid="assess-question-timer-badge"
                  className={`rounded-xl px-3.5 py-1.5 text-xs sm:text-sm font-black tabular-nums flex items-center gap-1.5 shadow-sm transition-all ${
                    questionRemainingSec <= 30
                      ? 'bg-red-600 text-white animate-pulse'
                      : 'bg-[#34c4f2] text-zinc-900 border border-[#34c4f2]/30'
                  }`}
                  aria-label="Remaining time"
                  title="Time remaining for this question"
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>Time: {qMinutes}:{qSeconds}</span>
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
                      <span className="text-[#34c4f2] italic font-medium animate-pulse">
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

            {silenceCountdown !== null && (
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-sky-50 border border-sky-200 text-sky-900 text-xs font-semibold animate-pulse">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-sky-500 animate-ping" />
                  Answer captured. Advancing to next question in {silenceCountdown}s...
                </span>
                <button
                  type="button"
                  onClick={handleSubmitAnswer}
                  className="text-[11px] text-sky-700 underline font-bold cursor-pointer hover:text-sky-950"
                >
                  Advance now
                </button>
              </div>
            )}

            <button
              id="assess-submit-answer"
              type="button"
              onClick={handleSubmitAnswer}
              disabled={savingAnswer || !hasGivenAnswer}
              className={[
                'w-full text-zinc-900 font-black py-4 rounded-2xl transition-all flex items-center justify-center space-x-3 active:scale-[0.98] uppercase tracking-[0.2em] text-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
                hasGivenAnswer
                  ? 'bg-[#34c4f2] hover:bg-[#2db0db] shadow-xl shadow-[#34c4f2]/40 ring-2 ring-[#34c4f2]/50'
                  : 'bg-[#34c4f2] hover:bg-[#2db0db] shadow-xl shadow-[#34c4f2]/30',
                savingAnswer ? 'opacity-50 cursor-not-allowed' : '',
              ].join(' ')}
            >
              {savingAnswer ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-zinc-900" />
                  <span>Submitting…</span>
                </>
              ) : (
                <>
                  <span>
                    {currentIndex >= questions.length - 1 ? 'Finish Interview' : 'Next Question'}
                  </span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>

          {/* Video & Controls Panel — Side by side to question */}
          <div className="md:col-span-5 lg:col-span-4 space-y-4 md:sticky md:top-6">
            <div className="rounded-2xl border border-zinc-200 dark:border-[#4a4a4a] bg-white dark:bg-[#2b2b2b] shadow-card p-4 space-y-3">
              <div className="flex items-center justify-between text-xs text-zinc-700 dark:text-zinc-300 font-semibold px-1">
                <span className="flex items-center gap-1.5">
                  <Camera className="w-3.5 h-3.5 text-zinc-500 dark:text-[#9f9f9f]" />
                  Live Video
                </span>
                {/* Face tracking status indicator */}
                <div className={[
                  'text-[10px] font-semibold flex items-center gap-1.5 px-2 py-0.5 rounded-full',
                  faceTrackingStatus === 'tracking' && faceDetected
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/80 dark:text-emerald-300 dark:border-transparent'
                    : 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/80 dark:text-amber-300 dark:border-transparent',
                ].join(' ')}>
                  <span className={[
                    'inline-block w-1.5 h-1.5 rounded-full',
                    faceTrackingStatus === 'tracking' && faceDetected ? 'bg-emerald-500 dark:bg-emerald-400 animate-pulse' : 'bg-amber-500 dark:bg-amber-300',
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
              <div className="rounded-xl border border-red-100 dark:border-red-900/40 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-300 leading-relaxed">
                <strong className="font-semibold block mb-0.5">Alert:</strong>
                {faceTrackingError}
              </div>
            )}

            <p className="text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/60 rounded-xl p-3 leading-relaxed">
              Keep your camera, microphone, and screen share active. Stopping media or leaving this window will end your interview.
            </p>
          </div>
        </div>
      </main>
    );
  }

  if (stage === 'instructions' || stage === 'permissions') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#f8f9fa] dark:bg-[#121212] px-4 py-10 relative">
        <ProctoringInstructions
          cameraGranted={cameraGranted}
          screenGranted={screenGranted}
          permissionError={permissionError}
          requestingPermissions={requestingPermissions}
          onRequestPermissions={requestPermissions}
        />
        {showAckPopup && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] p-4 backdrop-blur-sm">
            <div className="bg-white dark:bg-[#2b2b2b] rounded-2xl max-w-md w-full shadow-2xl p-6 border border-zinc-100 dark:border-[#4a4a4a]">
              <h3 className="text-xl font-bold text-zinc-900 dark:text-white mb-3">Acknowledgment</h3>
              <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-5 leading-relaxed">
                Please confirm that you have read all the instructions, understand the proctoring rules, and have successfully granted the required permissions.
              </p>
              
              <label className="flex items-start gap-3 cursor-pointer p-3 bg-zinc-50 dark:bg-zinc-800/60 rounded-xl border border-zinc-200 dark:border-zinc-700 mb-6 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                <div className="pt-0.5">
                  <input
                    type="checkbox"
                    checked={ackChecked}
                    onChange={(e) => setAckChecked(e.target.checked)}
                    className="w-4 h-4 rounded border-zinc-300 text-[#34c4f2] focus:ring-[#34c4f2]"
                  />
                </div>
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-200 leading-snug">
                  I acknowledge that I have read the instructions and granted necessary permissions.
                </span>
              </label>

              <button
                type="button"
                disabled={!ackChecked}
                onClick={() => {
                  setShowAckPopup(false);
                  setStageWithRef('ready');
                }}
                className="w-full bg-[#34c4f2] hover:bg-[#2db0db] text-zinc-900 font-black py-3.5 rounded-xl transition-all flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wider text-sm"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </main>
    );
  }

  if (stage === 'ready') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#f8f9fa] dark:bg-[#0b0f14] transition-colors px-4 py-10">
        <div className="max-w-lg w-full space-y-5">
          <div className="text-center space-y-1">
            <h1 className="text-xl font-bold text-zinc-900 dark:text-white">You&apos;re ready to join</h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
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
    <main className="min-h-screen flex items-center justify-center bg-[#f8f9fa] dark:bg-[#121212] px-4">
      <form
        onSubmit={handleSubmitPasscode}
        className="max-w-md w-full bg-white dark:bg-[#2b2b2b] rounded-2xl shadow-card border border-zinc-100 dark:border-[#4a4a4a] p-8 space-y-6"
      >
        <div className="text-center space-y-2">
          <div className="w-12 h-12 bg-[#34c4f2]/10 rounded-xl flex items-center justify-center mx-auto">
            <KeyRound className="w-6 h-6 text-[#34c4f2]" />
          </div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-white">Enter your passcode</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
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
          className="w-full text-center text-2xl font-black tracking-[0.4em] py-4 bg-zinc-50 dark:bg-zinc-800/80 border border-zinc-100 dark:border-zinc-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#34c4f2] text-zinc-900 dark:text-white"
        />

        {error && (
          <div className="flex items-center space-x-2 p-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 rounded-xl border border-red-100 dark:border-red-900/50">
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
