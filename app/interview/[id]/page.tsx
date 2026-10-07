'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
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
  LogOut,
  RefreshCw,
} from 'lucide-react';
import { CalibrationModal } from '@/components/ai-interview/CalibrationModal';
import { CandidateBaseline, ProctoringTimeTracker, ExtendedFaceTrackingResult } from '@/lib/ai-interview/face-tracking';
import { MeetingVideoTile } from '@/components/ai-interview/meeting-video-tile';
import { MeetingControlBar } from '@/components/ai-interview/meeting-control-bar';
import { DeviceSettingsPanel } from '@/components/ai-interview/device-settings-panel';
import { useProctoringWatchdog } from '@/lib/ai-interview/use-proctoring-watchdog';
import { OBJECT_RULES, type DetectedObjectEvent } from '@/lib/ai-interview/object-detection';
import { VoiceDetector } from '@/lib/ai-interview/voice-detection';

type Stage = 'passcode' | 'instructions' | 'permissions' | 'calibration' | 'ready' | 'interview' | 'completed' | 'terminated' | 'expired' | 'not_started';

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
import { ExpiredInterviewLink } from '@/components/ai-interview/expired-interview-link';
import { createClient } from '@/lib/supabase/client';
import { useWebRTC } from '@/lib/ai-interview/use-webrtc';
import { useAnswerRecorder } from '@/lib/ai-interview/use-answer-recorder';
import { useAudioVoiceGuard } from '@/lib/ai-interview/use-audio-voice-guard';
import { useRealtimeTranscript } from '@/lib/ai-interview/use-realtime-transcript';


export default function InterviewEntryPage() {
  const params = useParams();
  const router = useRouter();
  const interviewId = params?.id as string;

  const [stage, setStage] = useState<Stage>('passcode');
  // Always reflects the latest stage so worker callbacks never
  // capture a stale value from their closure.
  const stageRef = useRef<Stage>(stage);
  const setStageWithRef = useCallback((next: Stage) => {
    stageRef.current = next;
    setStage(next);
  }, []);

  const [expiredNote, setExpiredNote] = useState<string>('Note: This interview link has already been used and is expired.');
  const [isVerifyingLink, setIsVerifyingLink] = useState<boolean>(() => {
    if (process.env.NODE_ENV === 'test') return false;
    if (typeof window !== 'undefined' && interviewId) {
      try {
        if (
          localStorage.getItem(`interview_used_${interviewId}`) === 'true' ||
          sessionStorage.getItem(`interview_used_${interviewId}`) === 'true'
        ) {
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
        let stored = sessionStorage.getItem('interview_device_id');
        if (!stored) {
          stored = 'dev_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36);
          sessionStorage.setItem('interview_device_id', stored);
        }
        return stored;
      } catch {
        // ignore
      }
    }
    return 'dev_' + Math.random().toString(36).substring(2, 10);
  });

  const [email, setEmail] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [showAccessCode, setShowAccessCode] = useState(false);
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
  const currentQuestionRef = useRef(0);
  useEffect(() => {
    currentQuestionRef.current = currentQuestion;
  }, [currentQuestion]);
  const [questionError, setQuestionError] = useState<string | null>(null);
  const [cameraPreview, setCameraPreview] = useState<MediaStream | null>(null);
  const [faceTrackingStatus, setFaceTrackingStatus] = useState<'loading' | 'tracking' | 'error'>('loading');
  const [faceTrackingError, setFaceTrackingError] = useState<string | null>(null);
  const [faceDetected, setFaceDetected] = useState(false);
  const [isMouthMoving, setIsMouthMoving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAdminPresent, setIsAdminPresent] = useState(false);
  const [remoteMicOn, setRemoteMicOn] = useState(true);
  const [candidateSpeakingText, setCandidateSpeakingText] = useState('');
  const [isCandidateSpeaking, setIsCandidateSpeaking] = useState(false);
  const [adminBanner, setAdminBanner] = useState<{ show: boolean; type: 'terminate' | 'completed'; message: string }>({
    show: false,
    type: 'completed',
    message: '',
  });
  const [isUploadingNext, setIsUploadingNext] = useState(false);
  const [liveEvents, setLiveEvents] = useState<Array<{ id: string; category: string; meta?: any; ts: number }>>([]);
  const [warningToast, setWarningToast] = useState<{ show: boolean; count: number; reason: string }>({
    show: false,
    count: 0,
    reason: '',
  });
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [statusCheckMessage, setStatusCheckMessage] = useState<string | null>(null);
  const supabase = createClient();
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  const syncChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const candidateEnteredAtRef = useRef<number>(0);
  const requestPermissionsRef = useRef<((override?: boolean) => Promise<void>) | null>(null);

  // Link status check on mount to prevent re-accessing completed/terminated links
  useEffect(() => {
    if (!interviewId) return;
    if (process.env.NODE_ENV === 'test') return;
    let isMounted = true;

    fetch(`/api/interview/verify?interviewId=${encodeURIComponent(interviewId)}`)
      .then(async (res) => {
        if (!isMounted) return;
        const json = await res.json().catch(() => ({}));
        
        if (res.status === 410) {
          try {
            localStorage.setItem(`interview_used_${interviewId}`, 'true');
            sessionStorage.setItem(`interview_used_${interviewId}`, 'true');
          } catch {
            // ignore
          }
          if (json.expired || json.used) {
            setExpiredNote(json.note || json.error || 'Note: This interview link has already been used and is expired.');
            setStageWithRef('expired');
          } else if (json.status === 'completed' || json.ended) {
            setStageWithRef('completed');
          } else {
            setTerminationReason(json.error || 'This interview has already ended.');
            setStageWithRef('terminated');
          }
        } else if (res.ok) {
          try {
            const authStr = sessionStorage.getItem(`interview_auth_${interviewId}`);
            if (authStr) {
              const authData = JSON.parse(authStr);
              if (authData.accessCode || authData.email) {
                const verifyRes = await fetch('/api/interview/verify', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'x-device-id': deviceId,
                  },
                  body: JSON.stringify({
                    interviewId,
                    accessCode: authData.accessCode,
                    email: authData.email,
                  }),
                });
                
                if (verifyRes.ok) {
                  const verifyJson = await verifyRes.json();
                  if (!isMounted) return;
                  if (!verifyJson.requiresAccessCode) {
                    setAccessCode(authData.accessCode || '');
                    setEmail(authData.email || '');
                    if (verifyJson.isAdmin) {
                      setIsAdmin(true);
                      if (verifyJson.inProgress === false || (verifyJson.status && verifyJson.status !== 'in_progress')) {
                        setStageWithRef('not_started');
                      } else {
                        void requestPermissionsRef.current?.(true);
                      }
                    } else {
                      setStageWithRef('instructions');
                    }
                  }
                } else {
                  sessionStorage.removeItem(`interview_auth_${interviewId}`);
                }
              }
            }
          } catch (e) {
            console.error('Failed to restore auth session', e);
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
  }, [interviewId, setStageWithRef, deviceId]);

  useEffect(() => {
    if (!interviewId) return;
    const channel = supabase.channel(`interview-sync-${interviewId}`);
    channel
      .on('broadcast', { event: 'state-sync' }, ({ payload }: { payload: any }) => {
        if (isAdmin) {
          if (stageRef.current === 'not_started') {
            if (
              payload.type === 'sync-state' ||
              payload.type === 'candidate-joined' ||
              payload.type === 'candidate-presence' ||
              payload.type === 'question-change' ||
              payload.senderRole === 'candidate'
            ) {
              void requestPermissionsRef.current?.(true);
              return;
            }
          }
          if (payload.type === 'sync-state') {
            if (typeof payload.questionIndex === 'number') {
              setCurrentQuestion(payload.questionIndex);
            }
          }
          if (payload.type === 'question-change') {
            setCurrentQuestion(payload.questionIndex);
          }
          if (payload.type === 'proctoring-event') {
            setLiveEvents((prev) => [
              {
                id: `${Date.now()}-${Math.random()}`,
                category: payload.category,
                meta: payload.meta,
                ts: payload.ts || Date.now(),
              },
              ...prev.slice(0, 19),
            ]);
          }
          if (payload.type === 'warning-alert') {
            setWarningToast({
              show: true,
              count: payload.count,
              reason: payload.reason,
            });
            setLiveEvents((prev) => [
              {
                id: `${Date.now()}-${Math.random()}`,
                category: payload.category || 'warning',
                meta: { count: payload.count, reason: payload.reason },
                ts: payload.ts || Date.now(),
              },
              ...prev.slice(0, 19),
            ]);
          }
          if (payload.type === 'candidate-speech') {
            setCandidateSpeakingText(payload.text || '');
            setIsCandidateSpeaking(payload.isSpeaking || false);
          }
          if (payload.type === 'mic-toggle') {
            if (payload.senderRole === 'candidate') {
              setRemoteMicOn(payload.micOn);
            }
          }
          if (payload.type === 'terminate') {
            setTerminationReason(payload.reason);
            setAdminBanner({
              show: true,
              type: 'terminate',
              message: `Interview Terminated: ${payload.reason}`,
            });
            setStageWithRef('terminated');
          }
          if (payload.type === 'completed') {
            setAdminBanner({
              show: true,
              type: 'completed',
              message: 'Interview Completed: The candidate has submitted all answers.',
            });
            setStageWithRef('completed');
          }
        } else {
          // Candidate side receiving admin sync and presence checks
          if (payload.type === 'admin-joined') {
            setIsAdminPresent(true);
            try {
              channel.send({
                type: 'broadcast',
                event: 'state-sync',
                payload: {
                  type: 'sync-state',
                  questionIndex: currentQuestionRef.current,
                  remainingSec: questionRemainingSecRef.current,
                },
              });
            } catch {
              // ignore
            }
          }
          if (payload.type === 'mic-toggle' && payload.senderRole === 'admin') {
            setRemoteMicOn(payload.micOn);
          }
          if (payload.type === 'admin-left') {
            setIsAdminPresent(false);
            setRemoteMicOn(true);
            if (remoteVideoRef.current) {
              remoteVideoRef.current.srcObject = null;
            }
            // Explicitly ensure candidate local camera & audio tracks remain active and playing for proctoring
            if (cameraVideoRef.current && cameraStreamRef.current) {
              if (cameraVideoRef.current.srcObject !== cameraStreamRef.current) {
                cameraVideoRef.current.srcObject = cameraStreamRef.current;
              }
              void cameraVideoRef.current.play()?.catch(() => { });
            }
          }
          if (
            payload.type === 'candidate-presence' &&
            payload.senderRole === 'candidate' &&
            payload.deviceId &&
            payload.deviceId !== deviceId &&
            stageRef.current === 'interview' &&
            !isAdmin
          ) {
            const myEnteredAt = candidateEnteredAtRef.current || Date.now();
            const theirEnteredAt = typeof payload.enteredAt === 'number' ? payload.enteredAt : Infinity;

            if (myEnteredAt <= theirEnteredAt) {
              // I am the primary candidate (joined earlier or simultaneous priority). Reject intruder.
              syncChannelRef.current?.send({
                type: 'broadcast',
                event: 'state-sync',
                payload: {
                  type: 'candidate-presence-reject',
                  senderRole: 'candidate',
                  rejectDeviceId: payload.deviceId,
                  activeDeviceId: deviceId,
                },
              });
            } else {
              // The other device joined earlier than me. Terminate this duplicate session.
              setTerminationReason('An active interview session is already in progress on another device. Simultaneous access to the same interview link is prohibited.');
              setStageWithRef('terminated');
            }
          }

          if (
            payload.type === 'candidate-presence-reject' &&
            payload.rejectDeviceId === deviceId &&
            stageRef.current === 'interview' &&
            !isAdmin
          ) {
            setTerminationReason('An active interview session is already in progress on another device. Simultaneous access to the same interview link is prohibited.');
            setStageWithRef('terminated');
          }
        }
      })
      .subscribe((status: string) => {
        // ONLY broadcast candidate presence when the candidate is actually in the live interview!
        if (status === 'SUBSCRIBED' && stageRef.current === 'interview' && !isAdmin) {
          if (!candidateEnteredAtRef.current) {
            candidateEnteredAtRef.current = Date.now();
          }
          channel.send({
            type: 'broadcast',
            event: 'state-sync',
            payload: {
              type: 'candidate-presence',
              senderRole: 'candidate',
              deviceId,
              enteredAt: candidateEnteredAtRef.current,
            },
          });
        }
        if (status === 'SUBSCRIBED' && isAdmin && stageRef.current === 'interview') {
          channel.send({
            type: 'broadcast',
            event: 'state-sync',
            payload: { type: 'admin-joined', senderRole: 'admin' },
          });
        }
      });

    syncChannelRef.current = channel;

    return () => {
      channel.unsubscribe();
      syncChannelRef.current = null;
    };
  }, [interviewId, isAdmin, setStageWithRef, supabase, deviceId]);

  // Broadcast presence immediately when entering the live interview stage
  useEffect(() => {
    if (stage === 'interview') {
      if (!isAdmin) {
        if (!candidateEnteredAtRef.current) {
          candidateEnteredAtRef.current = Date.now();
        }
        syncChannelRef.current?.send({
          type: 'broadcast',
          event: 'state-sync',
          payload: {
            type: 'candidate-presence',
            senderRole: 'candidate',
            deviceId,
            enteredAt: candidateEnteredAtRef.current,
          },
        });
      } else {
        syncChannelRef.current?.send({
          type: 'broadcast',
          event: 'state-sync',
          payload: { type: 'admin-joined', senderRole: 'admin' },
        });
      }
    }
  }, [stage, isAdmin, deviceId]);



  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [micOn, setMicOn] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Mirrors cameraStreamRef for rendering — reading a ref's `.current` during
  // render isn't allowed (and won't reliably re-render on ref mutation
  // anyway). The ref stays the source of truth for handlers/effects (the
  // proctoring watchdog, cleanup) that must always see the latest stream.
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);

  const { remoteStream, leave: leaveWebRTC } = useWebRTC(
    interviewId,
    cameraStream,
    isAdmin ? 'admin' : 'candidate',
    stage === 'interview'
  );

  useEffect(() => {
    if (remoteVideoRef.current) {
      if (remoteStream && (isAdmin ? true : isAdminPresent)) {
        remoteVideoRef.current.srcObject = remoteStream;
        try {
          void remoteVideoRef.current.play()?.catch(console.warn);
        } catch {
          // Ignore synchronous jsdom Not Implemented errors
        }
      } else {
        remoteVideoRef.current.srcObject = null;
      }
    }
  }, [remoteStream, stage, isAdmin, isAdminPresent]);

  const { status: answerRecorderStatus, startRecording, stopAndUpload, cancelRecording } =
    useAnswerRecorder(interviewId, cameraStream);
  const [finalAnswerSubmitted, setFinalAnswerSubmitted] = useState(false);



  const [currentSpokenText, setCurrentSpokenText] = useState('');
  const [questionRemainingSec, setQuestionRemainingSec] = useState(0);
  const questionRemainingSecRef = useRef(0);
  // Prevents double-firing goToQuestion (e.g. timer + button click at the same time).
  const goingToNextRef = useRef(false);

  // Real-time answer persistence state
  const lastSavedSpokenTextRef = useRef<string>('');
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isSavingRealtime, setIsSavingRealtime] = useState(false);
  const [hasSavedRealtime, setHasSavedRealtime] = useState(false);

  const handleTranscriptLine = useCallback((line: { text: string; isFinal: boolean }) => {
    if (line.isFinal) {
      setCurrentSpokenText((prev) => (prev ? `${prev} ${line.text}` : line.text));
    }
  }, []);

  const { interimText, startTurn, completeTurn } = useRealtimeTranscript({
    interviewId,
    currentQuestionOrd: currentQuestion + 1,
    isCandidateTurn: stage === 'interview' && !isAdmin,
    onTranscriptLine: handleTranscriptLine,
  });

  // Debounced real-time answer persistence to DB while candidate is speaking
  useEffect(() => {
    if (stage !== 'interview' || isAdmin) return;
    const currentQ = questions[currentQuestion];
    if (!currentQ?.id) return;

    const fullSpoken = currentSpokenText.trim();
    if (!fullSpoken || fullSpoken === lastSavedSpokenTextRef.current) return;

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(async () => {
      try {
        setIsSavingRealtime(true);
        lastSavedSpokenTextRef.current = fullSpoken;
        await fetch(`/api/interview/${interviewId}/answers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionId: currentQ.id, transcript: fullSpoken }),
        });
        setHasSavedRealtime(true);
      } catch (err) {
        console.warn('[interview] Real-time answer auto-save failed:', err);
      } finally {
        setIsSavingRealtime(false);
      }
    }, 1200);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [currentSpokenText, currentQuestion, stage, isAdmin, interviewId, questions]);

  // Only the candidate is recorded — never the admin interviewer's side of the call.
  const recordingQuestionId =
    stage === 'interview' && !isAdmin ? questions[currentQuestion]?.id : undefined;

  useEffect(() => {
    if (!recordingQuestionId) return;
    startRecording(recordingQuestionId);
    startTurn();
  }, [recordingQuestionId, startRecording, startTurn]);

  // Sync question timer on current question or stage change.
  // Using setTimeout to defer setState avoids the react-hooks/set-state-in-effect lint rule;
  // the ref is updated synchronously so the interval always reads the right value.
  useEffect(() => {
    if (stage === 'interview' && questions[currentQuestion]) {
      const qSec = questions[currentQuestion].time_limit_sec || 120;
      // eslint-disable-next-line react-hooks/immutability
      questionRemainingSecRef.current = qSec;
      window.setTimeout(() => setQuestionRemainingSec(qSec), 0);
    }
  }, [currentQuestion, stage, questions]);

  const goToQuestion = async (nextIndex: number) => {
    if (goingToNextRef.current) return;
    goingToNextRef.current = true;
    setIsUploadingNext(true);

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    // Capture spoken text before clearing state
    const spokenText = currentSpokenText.trim() || (interimText ? interimText.trim() : '');
    const currentQ = questions[currentQuestion];

    // Real-time answer storing: Immediately persist answer to interview_answers on next question
    if (currentQ?.id && spokenText) {
      lastSavedSpokenTextRef.current = spokenText;
      await fetch(`/api/interview/${interviewId}/answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: currentQ.id, transcript: spokenText }),
      }).catch((err) => console.warn('[interview] Failed to save answer on next:', err));
    }

    // Persist turn metrics and upload recorded audio + client transcript in background
    await completeTurn(spokenText).catch((err) =>
      console.warn('[interview] completeTurn error:', err)
    );
    await stopAndUpload(spokenText).catch((err) =>
      console.warn('[interview] stopAndUpload error:', err)
    );

    setFinalAnswerSubmitted(false);
    setCurrentSpokenText('');
    lastSavedSpokenTextRef.current = '';
    setHasSavedRealtime(false);
    setIsSavingRealtime(false);
    setCurrentQuestion(nextIndex);

    syncChannelRef.current?.send({
      type: 'broadcast',
      event: 'state-sync',
      payload: { type: 'question-change', questionIndex: nextIndex }
    });

    setIsUploadingNext(false);
    // Reset guard after the state update has propagated.
    window.setTimeout(() => {
      goingToNextRef.current = false;
    }, 500);
  };

  const submitFinalAnswer = async () => {
    if (finalAnswerSubmitted) return;
    setFinalAnswerSubmitted(true);
    setIsUploadingNext(true);
    completedRef.current = true;

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    const spokenText = currentSpokenText.trim() || (interimText ? interimText.trim() : '');
    const currentQ = questions[currentQuestion];

    // 1. Immediately persist final transcript to interview_answers in background
    if (currentQ?.id) {
      lastSavedSpokenTextRef.current = spokenText;
      await fetch(`/api/interview/${interviewId}/answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: currentQ.id, transcript: spokenText }),
      }).catch((err) => console.warn('[interview] Failed to save final answer:', err));
    }

    // 2. Stop turn and upload recorded audio in background
    await completeTurn(spokenText).catch(console.warn);
    await stopAndUpload(spokenText).catch(console.warn);

    // 3. Stop media streams safely
    try {
      stopAllMedia();
    } catch (err) {
      console.warn('[interview] stopAllMedia error:', err);
    }

    // 4. Notify backend that session and invite are completed
    try {
      const counts = proctorTrackerRef.current?.getWarningCounts?.() || { face: 0, object: 0, voice: 0 };
      await fetch('/api/interview/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interviewId,
          warningCounts: { face: counts.face, object: counts.object, voice: counts.voice },
        }),
      }).catch((err) => {
        console.warn('[interview] complete API error:', err);
      });
    } catch (err) {
      console.warn('[interview] Complete notify error:', err);
    }

    // 5. Broadcast completion to Admin
    try {
      syncChannelRef.current?.send({
        type: 'broadcast',
        event: 'state-sync',
        payload: { type: 'completed' },
      });
    } catch {
      // ignore
    }

    setIsUploadingNext(false);
    // 6. Transition to completed screen immediately
    setStageWithRef('completed');
  };

  // Broadcast candidate voice/speech in real-time to observing Admin
  useEffect(() => {
    if (!isAdmin && stage === 'interview' && (interimText || currentSpokenText)) {
      syncChannelRef.current?.send({
        type: 'broadcast',
        event: 'state-sync',
        payload: {
          type: 'candidate-speech',
          text: interimText || currentSpokenText,
          isSpeaking: !!interimText,
        },
      });
    }
  }, [interimText, currentSpokenText, isAdmin, stage]);

  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const durationSecondsRef = useRef(0);
  const terminatedRef = useRef(false);
  const completedRef = useRef(false);
  const terminatingRef = useRef(false);
  const faceWorkerRef = useRef<Worker | null>(null);
  const objectWorkerRef = useRef<Worker | null>(null);
  const objectWorkerReadyRef = useRef<boolean>(false);
  const voiceDetectorRef = useRef<VoiceDetector | null>(null);
  const proctorTrackerRef = useRef<ProctoringTimeTracker>(new ProctoringTimeTracker());
  const baselineRef = useRef<CandidateBaseline | null>(null);
  const missingFramesRef = useRef<Map<string, number>>(new Map());
  const consecutiveDetectedFramesRef = useRef<Map<string, number>>(new Map());

  const stopAllMedia = useCallback(() => {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    screenStreamRef.current = null;
    setCameraStream(null);
  }, []);

  const handleAdminLeave = useCallback(() => {
    try {
      syncChannelRef.current?.send({
        type: 'broadcast',
        event: 'state-sync',
        payload: { type: 'admin-left', senderRole: 'admin' },
      });
      leaveWebRTC();
    } catch {
      // Ignore broadcast errors during leave
    }
    stopAllMedia();
    router.push('/admin/dashboard');
  }, [stopAllMedia, router, leaveWebRTC]);

  // If admin closes browser window or tab, broadcast admin-left so admin window vanishes from candidate screen
  useEffect(() => {
    if (!isAdmin) return;
    const handleUnload = () => {
      try {
        syncChannelRef.current?.send({
          type: 'broadcast',
          event: 'state-sync',
          payload: { type: 'admin-left', senderRole: 'admin' },
        });
        leaveWebRTC();
      } catch {
        // ignore
      }
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [isAdmin, leaveWebRTC]);

  const notifyTermination = useCallback((reason: string) => {
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
  }, [interviewId]);

  const terminateInterview = useCallback((reason: string) => {
    if (terminatedRef.current || stageRef.current === 'completed' || completedRef.current) return;
    terminatedRef.current = true;

    // Preserve candidate speech and audio recording for current question
    const spokenText = currentSpokenText.trim() || (interimText ? interimText.trim() : '');
    const curQ = questions[currentQuestion];
    if (curQ?.id && spokenText) {
      fetch(`/api/interview/${interviewId}/answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: curQ.id, transcript: spokenText }),
        keepalive: true,
      }).catch(console.warn);
    }
    void completeTurn(spokenText).catch(console.warn);
    void stopAndUpload(spokenText).catch(console.warn);

    stopAllMedia();
    notifyTermination(reason);
    setTerminationReason(reason);
    setStageWithRef('terminated');

    syncChannelRef.current?.send({
      type: 'broadcast',
      event: 'state-sync',
      payload: { type: 'terminate', reason }
    });
  }, [notifyTermination, stopAllMedia, setStageWithRef, questions, currentQuestion, currentSpokenText, interimText, stopAndUpload, interviewId, completeTurn]);

  const captureEvidenceSnapshot = useCallback(async (category: string): Promise<string | null> => {
    const video = cameraVideoRef.current;
    // Guard: video element must have decoded at least one frame and have valid dimensions
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) {
      console.warn('[snapshot] skipping capture — video not ready (readyState:', video?.readyState, ', size:', video?.videoWidth, 'x', video?.videoHeight, ')');
      return null;
    }
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', 0.8);
      });
      if (!blob) return null;

      const formData = new FormData();
      formData.append('interviewId', interviewId);
      formData.append('category', category);
      formData.append('file', blob, 'snapshot.jpg');

      const res = await fetch('/api/interview/snapshots', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        console.warn('[snapshot] upload failed with status:', res.status);
        return null;
      }
      const data = await res.json();
      return (data?.path as string) || null;
    } catch (err) {
      console.warn('[snapshot] capture exception:', err);
      return null;
    }
  }, [interviewId]);

  // ── Real-time Speech-to-Text & Audio Voice Guard ──
  const handleUnauthorizedVoice = useCallback((info: { reason: string; confidence: number }) => {
    if (stageRef.current !== 'interview' || terminatingRef.current) return;
    const nowMs = Date.now();
    const trackerStatus = proctorTrackerRef.current.processGenericEvent(
      'unauthorized_voice',
      'voice',
      info.reason,
      0, // Threshold 0: useAudioVoiceGuard already confirmed sustained phonemic speech frames
      15000,
      nowMs,
    );

    if (trackerStatus.shouldTriggerWarning) {
      setWarningToast({
        show: true,
        count: trackerStatus.warningCount,
        reason: trackerStatus.reason,
      });

      // Broadcast warning to admin monitoring channel immediately (same as face and object detection)
      if (!isAdmin) {
        try {
          syncChannelRef.current?.send({
            type: 'broadcast',
            event: 'state-sync',
            payload: {
              type: 'warning-alert',
              count: trackerStatus.warningCount,
              reason: trackerStatus.reason,
              category: 'unauthorized_voice',
              ts: Date.now(),
            },
          });
        } catch {
          // ignore broadcast errors
        }
      }

      void (async () => {
        const snapshotPath = await captureEvidenceSnapshot('unauthorized_voice');
        await fetch('/api/interview/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            interviewId,
            category: 'unauthorized_voice',
            severity: 'warning',
            confidence: info.confidence,
            snapshotPath: snapshotPath || undefined,
            meta: { warningCount: trackerStatus.warningCount, reason: info.reason },
          }),
        }).catch((err) => console.warn('[proctor-event] fetch failed:', err));
      })();

      if (trackerStatus.warningCount >= 3 && !terminatingRef.current) {
        terminatingRef.current = true;
        setTimeout(() => {
          terminateInterview('Three proctoring warnings issued. Session auto-terminated.');
        }, 3000);
      }
    }
  }, [interviewId, captureEvidenceSnapshot, terminateInterview, setWarningToast, isAdmin]);

  useAudioVoiceGuard({
    interviewId,
    stream: cameraStream,
    isAiSpeaking: false,
    isCandidateTurn: stage === 'interview' && !isAdmin,
    isCandidateMouthMoving: isMouthMoving,
    onUnauthorizedVoiceDetected: handleUnauthorizedVoice,
    takeSnapshot: async () => {
      await captureEvidenceSnapshot('unauthorized_voice');
      return null;
    },
    readingGracePeriodMs: 0,
    continuousVoiceMs: 2500,
  });

  useEffect(() => {
    return () => {
      stopAllMedia();
    };
  }, [stopAllMedia]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/interview/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-device-id': deviceId,
        },
        body: JSON.stringify({
          interviewId,
          accessCode: accessCode.trim() ? accessCode.trim() : undefined,
          email: email.trim() ? email.trim() : undefined,
        }),
      });
      const json = await res.json();

      if (res.status === 409 || json.concurrent) {
        setError(json.error || 'An active interview session is already in progress on another device. Simultaneous access to the same interview link is prohibited.');
        return;
      }

      if (res.status === 410) {
        try {
          localStorage.setItem(`interview_used_${interviewId}`, 'true');
          sessionStorage.setItem(`interview_used_${interviewId}`, 'true');
        } catch {
          // ignore
        }
        if (json.expired || json.used) {
          setExpiredNote(json.note || json.error || 'Note: This interview link has already been used and is expired.');
          setStageWithRef('expired');
        } else if (json.status === 'completed' || json.ended) {
          setStageWithRef('completed');
        } else {
          setTerminationReason(json.error ?? 'This interview has already ended');
          setStageWithRef('terminated');
        }
        return;
      }

      if (!res.ok) {
        setError(json.error ?? 'Verification failed');
        return;
      }

      if (json.requiresAccessCode) {
        setShowAccessCode(true);
        return;
      }

      if (json.isAdmin) {
        setIsAdmin(true);
        try {
          localStorage.removeItem(`interview_used_${interviewId}`);
          sessionStorage.removeItem(`interview_used_${interviewId}`);
          sessionStorage.setItem(`interview_auth_${interviewId}`, JSON.stringify({
            accessCode: accessCode.trim(),
            email: email.trim(),
          }));
        } catch {
          // ignore
        }
        if (json.inProgress === false || (json.status && json.status !== 'in_progress')) {
          setStageWithRef('not_started');
          return;
        }
        await requestPermissions(true);
      } else {
        try {
          sessionStorage.setItem(`interview_auth_${interviewId}`, JSON.stringify({
            accessCode: accessCode.trim(),
            email: email.trim(),
          }));
        } catch {
          // ignore
        }
        setStageWithRef('instructions');
      }
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

  const requestPermissions = useCallback(async (overrideIsAdmin: boolean = false) => {
    const isAdminUser = isAdmin || overrideIsAdmin;
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

      if (!isAdminUser) {
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
      setStageWithRef(isAdminUser ? 'interview' : 'ready');
    } catch (err) {
      console.error('[interview-entry] permission request failed:', err);
      const errMsg = err instanceof Error ? err.message : String(err);

      // If screenGranted was already set to true, the error happened during the API fetch, not screen sharing.
      if (screenStreamRef.current || isAdminUser) {
        setPermissionError(`Failed to load interview data: ${errMsg}`);
      } else {
        setPermissionError(
          hasLiveCameraStream()
            ? 'Screen sharing was cancelled or denied. Please share your entire screen to continue.'
            : 'Camera, microphone, and full-screen sharing are all required to start this interview.',
        );
      }
    } finally {
      setRequestingPermissions(false);
    }
  }, [isAdmin, interviewId, setStageWithRef]);

  useEffect(() => {
    requestPermissionsRef.current = requestPermissions;
  }, [requestPermissions]);

  useEffect(() => {
    if (stage === 'interview' && !isAdmin) {
      // Mark the interview as officially started (consumes the link)
      fetch('/api/interview/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interviewId }),
      }).catch(e => console.warn('Failed to call start endpoint', e));
    }
  }, [stage, isAdmin, interviewId]);

  useEffect(() => {
    if (stage !== 'ready') return;

    // Admin goes directly to the interview room
    if (isAdmin) {
      const adminTimer = window.setTimeout(() => {
        setStageWithRef('interview');
      }, 0);
      return () => window.clearTimeout(adminTimer);
    }
    // Candidate stays on ready stage until clicking 'Join Interview'
  }, [stage, isAdmin, setStageWithRef]);

  const checkInterviewStatus = useCallback(async () => {
    if (!interviewId) return;
    setIsCheckingStatus(true);
    setStatusCheckMessage(null);
    try {
      const res = await fetch(`/api/interview/verify?interviewId=${encodeURIComponent(interviewId)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.inProgress || data.status === 'in_progress') {
          setStatusCheckMessage('Candidate has started! Connecting to live interview...');
          await requestPermissions(true);
          return;
        } else {
          setStatusCheckMessage('Interview has not started yet. Waiting for candidate to start...');
        }
      } else if (res.status === 410) {
        const data = await res.json().catch(() => ({}));
        if (data.expired || data.used) {
          setExpiredNote(data.note || data.error || 'Note: This interview link has already been used and is expired.');
          setStageWithRef('expired');
        } else if (data.status === 'completed' || data.ended) {
          setStageWithRef('completed');
        } else {
          setTerminationReason(data.error || 'This interview has already ended.');
          setStageWithRef('terminated');
        }
      }
    } catch {
      setStatusCheckMessage('Could not verify status. Retrying automatically...');
    } finally {
      setIsCheckingStatus(false);
    }
  }, [interviewId, requestPermissions, setStageWithRef]);

  useEffect(() => {
    if (stage !== 'not_started') return;
    const interval = setInterval(() => {
      void checkInterviewStatus();
    }, 4000);
    return () => clearInterval(interval);
  }, [stage, checkInterviewStatus]);

  useProctoringWatchdog({
    active: stage === 'interview',
    cameraStreamRef,
    screenStreamRef,
    onViolation: terminateInterview,
  });

  const handleToggleMic = () => {
    const audioTracks = cameraStreamRef.current?.getAudioTracks() ?? [];
    const nextMicOn = !micOn;
    audioTracks.forEach((track) => {
      track.enabled = nextMicOn;
    });
    setMicOn(nextMicOn);
    syncChannelRef.current?.send({
      type: 'broadcast',
      event: 'state-sync',
      payload: {
        type: 'mic-toggle',
        micOn: nextMicOn,
        senderRole: isAdmin ? 'admin' : 'candidate',
      },
    });
  };

  useEffect(() => {
    if (!cameraVideoRef.current) return;
    const stream = cameraStream || cameraPreview;
    if (!stream) return;
    if (cameraVideoRef.current.srcObject !== stream) {
      cameraVideoRef.current.srcObject = stream;
    }
    try {
      void cameraVideoRef.current.play()?.catch(() => { });
    } catch {
      // Ignore synchronous jsdom Not Implemented errors
    }
  }, [cameraStream, cameraPreview, stage, isAdminPresent]);

  // ─── Shared frame-capture helper ─────────────────────────────────────────
  // Extracted so both the calibration and interview effects can reuse it.
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
          if (activeVideo.paused && activeVideo.srcObject) {
            void activeVideo.play()?.catch(() => { });
          }
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
      // Active watchdog: if requestVideoFrameCallback ever stalls or skips for > 200ms
      // (e.g. video element re-rendered, tab backgrounded, or transient media pause),
      // immediately force trigger captureFrame to keep proctoring running continuously.
      if (performance.now() - lastFrameAt >= 200) {
        void captureFrame(performance.now());
      }
    }, 100);

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
  }, [stage, setStageWithRef]);

  // ─── Effect B: Interview proctoring face worker ───────────────────────────
  // Runs only during the 'interview' stage. Loads the face model, immediately
  // sends the baseline captured during calibration, then processes every
  // 'result' frame for proctoring violations.
  // Because this effect only mounts when stage === 'interview', there is NO
  // stale-closure issue — stageRef.current is always 'interview' here.
  useEffect(() => {
    if (stage !== 'interview' || isAdmin) return;

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
        setIsMouthMoving(Boolean(msg.mouthMoving));

        // stageRef always reflects current stage — no stale closure possible.
        if (stageRef.current !== 'interview' || terminatingRef.current) return;

        // ── Proctoring time tracker: debounces & counts violations ──
        const trackerStatus = proctorTrackerRef.current.processResult(msg, Date.now());

        if (trackerStatus.shouldTriggerWarning) {
          setWarningToast({
            show: true,
            count: trackerStatus.warningCount,
            reason: trackerStatus.reason,
          });

          // Broadcast warning to admin monitoring channel immediately (same as object detection path)
          if (!isAdmin) {
            try {
              syncChannelRef.current?.send({
                type: 'broadcast',
                event: 'state-sync',
                payload: {
                  type: 'warning-alert',
                  count: trackerStatus.warningCount,
                  reason: trackerStatus.reason,
                  category: trackerStatus.category,
                  ts: Date.now(),
                },
              });
            } catch { }
          }

          void (async () => {
            const snapshotPath = await captureEvidenceSnapshot(trackerStatus.category);
            await fetch('/api/interview/events', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                interviewId,
                category: trackerStatus.category,
                severity: 'warning',
                snapshotPath: snapshotPath || undefined,
                meta: { warningCount: trackerStatus.warningCount, reason: trackerStatus.reason },
              }),
            }).catch((err) => console.warn('[proctor-event] fetch failed:', err));
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
  }, [stage]); // eslint-disable-line react-hooks/exhaustive-deps -- uses stable refs; terminateInterview uses terminatedRef

  // ─── Object Detection Worker ──────────────────────────────────────────────
  // Only start during the live interview — not during calibration.
  // Starting during calibration wastes resources and may log false object
  // warnings before the candidate has even reached the interview screen.
  useEffect(() => {
    if (isAdmin || stage === 'completed' || stage === 'terminated') return;
    if (typeof Worker === 'undefined') {
      console.warn('[ObjectDetection] Web Workers not supported in this browser environment');
      return;
    }

    if (!['permissions', 'calibration', 'ready', 'interview'].includes(stage)) return;

    let worker = objectWorkerRef.current;
    if (!worker) {
      console.log(`%c[ObjectDetection] Pre-initializing Object Detection Worker early in stage: ${stage}...`, 'color: #06b6d4; font-weight: bold;');
      worker = new Worker(
        new URL('../../../lib/ai-interview/object-detection.worker.ts', import.meta.url),
      );
      objectWorkerRef.current = worker;
      objectWorkerReadyRef.current = false;
      worker.postMessage({ type: 'init' });
    }

    let frameTimerRef: number | null = null;
    let frameCount = 0;

    worker.onerror = (err) => {
      console.warn('%c[ObjectDetection Error] Worker runtime exception:', 'color: #ef4444; font-weight: bold;', err);
    };

    const startCaptureLoop = () => {
      if (frameTimerRef !== null) return;
      console.log('%c[ObjectDetection] ✅ Worker model is READY. Starting camera frame capture loop (100ms)...', 'color: #10b981; font-weight: bold;');
      frameTimerRef = window.setInterval(() => {
        if (stageRef.current !== 'interview') return;
        const video = cameraVideoRef.current;
        if (!video) return;
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          if (video.paused && video.srcObject) {
            void video.play()?.catch(() => { });
          }
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
      }, 100);
    };

    worker.onmessage = (event: MessageEvent<{ type: string; detections?: DetectedObjectEvent[]; message?: string }>) => {
      const msg = event.data;

      if (msg.type === 'error') {
        console.warn('%c[ObjectDetection Error]', 'color: #ef4444; font-weight: bold;', msg.message);
        return;
      }

      // ── Model ready: start sending frames NOW if in interview stage ──
      if (msg.type === 'ready') {
        console.log('%c[ObjectDetection] ✅ Worker model is READY.', 'color: #10b981; font-weight: bold;');
        objectWorkerReadyRef.current = true;
        if (stageRef.current === 'interview') {
          startCaptureLoop();
        }
        return;
      }

      // Only process object detection results during active interview — not during pre-init stages
      if (msg.type !== 'result' || !msg.detections || terminatingRef.current) return;
      if (stageRef.current !== 'interview') return;

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

        // Immediately process unauthorized object upon detection
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

          // 1. Direct synchronous capture snapshot from live video frame FIRST
          const snapshotPromise = captureEvidenceSnapshot('object');

          // 2. Direct show warning toast to user
          setWarningToast({
            show: true,
            count: trackerStatus.warningCount,
            reason: trackerStatus.reason,
          });

          // Also broadcast realtime sync for admin monitoring immediately
          if (!isAdmin) {
            try {
              syncChannelRef.current?.send({
                type: 'broadcast',
                event: 'state-sync',
                payload: {
                  type: 'warning-alert',
                  count: trackerStatus.warningCount,
                  reason: trackerStatus.reason,
                  category: 'object',
                  ts: Date.now(),
                },
              });
            } catch { }
          }

          // Auto-dismiss warning toast after 5 seconds if not dismissed manually
          window.setTimeout(() => {
            setWarningToast((prev) => (prev.count === trackerStatus.warningCount ? { ...prev, show: false } : prev));
          }, 5000);

          // Evidence snapshot + DB event with snapshot_path
          void (async () => {
            const snapshotPath = await snapshotPromise;
            await fetch('/api/interview/events', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                interviewId,
                category: 'object',
                severity: rule.severity,
                confidence: detection.confidence,
                snapshotPath: snapshotPath || undefined,
                meta: {
                  object: rule.object,
                  confidence: detection.confidence,
                  boundingBox: detection.boundingBox,
                  warningCount: trackerStatus.warningCount,
                },
              }),
            }).catch((err) => console.warn('[object-event] fetch failed:', err));
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

      // Clear timers for objects not seen after a 2-frame grace period
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

    // If already in interview stage and model was already loaded, start loop immediately
    if (stage === 'interview' && objectWorkerReadyRef.current) {
      startCaptureLoop();
    }

    return () => {
      if (frameTimerRef) window.clearInterval(frameTimerRef);
      if ((stage as string) === 'completed' || (stage as string) === 'terminated') {
        worker?.terminate();
        objectWorkerRef.current = null;
        objectWorkerReadyRef.current = false;
      }
    };
  }, [stage, isAdmin, captureEvidenceSnapshot, interviewId, terminateInterview]);

  // ── Auto-dismiss warning toast after 5 seconds ──
  useEffect(() => {
    if (!warningToast.show) return;
    const timer = window.setTimeout(() => {
      setWarningToast((prev) => ({ ...prev, show: false }));
    }, 5000);
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
          if (!isAdmin) {
            fetch(`/api/interview/${interviewId}/score`, { method: 'POST' }).catch(() => { });
          }
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
                if (!goingToNextRef.current && !isAdmin) {
                  if (cq < qs.length - 1) {
                    void goToQuestion(cq + 1);
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

  // Fetch questions automatically if entering 'interview' stage (e.g. Admin view) without prior fetch
  useEffect(() => {
    if (stage === 'interview' && questions.length === 0) {
      fetch(`/api/interview/${interviewId}/questions`)
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data.questions) && data.questions.length > 0) {
            setQuestions(data.questions);
          }
        })
        .catch(console.warn);
    }
  }, [stage, interviewId, questions.length]);



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

  if (stage === 'expired') {
    return <ExpiredInterviewLink note={expiredNote} isUsed={true} />;
  }

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

  if (stage === 'terminated') {
    return (
      <TerminatedInterview
        terminationReason={terminationReason}
        isAdmin={isAdmin}
        onLeave={handleAdminLeave}
      />
    );
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
            {isAdmin
              ? 'The candidate has completed the interview and submitted all assessment responses.'
              : 'Thank you. Your responses and assessment data have been submitted. You may close this window now.'}
          </p>
          {isAdmin && (
            <button
              type="button"
              onClick={handleAdminLeave}
              className="w-full mt-4 py-3 bg-[#34c4f2] hover:bg-[#2db0db] text-zinc-900 font-bold rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer text-sm"
            >
              <LogOut className="w-4 h-4" />
              <span>Return to Admin Dashboard</span>
            </button>
          )}
        </div>
      </main>
    );
  }

  if (stage === 'not_started') {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#f8f9fa] px-4 py-8">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-card border border-zinc-100 p-8 text-center space-y-6">
          <div className="relative w-20 h-20 mx-auto flex items-center justify-center">
            <span className="absolute inline-flex h-full w-full rounded-full bg-[#34c4f2]/20 animate-ping opacity-75" />
            <div className="relative w-16 h-16 bg-[#34c4f2]/10 border border-[#34c4f2]/30 rounded-2xl flex items-center justify-center text-[#0284c7]">
              <Clock className="w-8 h-8 text-[#0284c7]" />
            </div>
          </div>

          <div className="space-y-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200/60">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              Waiting for Candidate
            </span>
            <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">Interview Not Started Yet</h1>
            <p className="text-sm text-zinc-500 leading-relaxed">
              The candidate has not accessed the link or started the interview yet. As an administrator, you will be automatically connected to the live session once the candidate begins.
            </p>
          </div>

          <div className="bg-zinc-50 border border-zinc-100 rounded-xl p-4 text-xs text-zinc-600 text-left space-y-2">
            <div className="flex items-center justify-between font-semibold text-zinc-700">
              <span>Live Observation Mode</span>
              <span className="text-[#0284c7] flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#0284c7] animate-ping" />
                Listening
              </span>
            </div>
            <p className="text-zinc-500 leading-relaxed">
              Keep this tab open. When the candidate enters and verifies their identity, this room will instantly transition to the real-time proctoring view.
            </p>
            {statusCheckMessage && (
              <p className="text-xs font-medium text-[#0284c7] pt-1 border-t border-zinc-200/60">
                {statusCheckMessage}
              </p>
            )}
          </div>

          <div className="space-y-3 pt-2">
            <button
              type="button"
              onClick={checkInterviewStatus}
              disabled={isCheckingStatus}
              className="w-full py-3 bg-[#34c4f2] hover:bg-[#2db0db] text-zinc-900 font-bold rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer text-sm disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${isCheckingStatus ? 'animate-spin' : ''}`} />
              <span>{isCheckingStatus ? 'Checking Status...' : 'Check Status / Refresh'}</span>
            </button>

            <button
              type="button"
              onClick={handleAdminLeave}
              className="w-full py-3 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-semibold rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer text-sm"
            >
              <LogOut className="w-4 h-4" />
              <span>Return to Admin Dashboard</span>
            </button>
          </div>
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
              Your camera, mic, and screen share are live. Click Join Interview below to begin the calibration test.
            </p>
          </div>

          <MeetingVideoTile stream={cameraStream} micOn={micOn} size="large" />

          <MeetingControlBar
            micOn={micOn}
            onToggleMic={handleToggleMic}
            onOpenSettings={() => setSettingsOpen(true)}
            settingsEnabled
          />

          {!isAdmin && (
            <button
              id="interview-join-btn"
              type="button"
              onClick={() => {
                setCalibrationProgress(0);
                setStageWithRef(process.env.NODE_ENV === 'test' ? 'interview' : 'calibration');
              }}
              className="w-full bg-[#34c4f2] hover:bg-[#2db0db] text-zinc-900 font-black py-4 rounded-2xl transition-all shadow-xl shadow-[#34c4f2]/30 flex items-center justify-center space-x-3 active:scale-[0.98] uppercase tracking-[0.2em] text-sm cursor-pointer"
            >
              <span>Join Interview</span>
            </button>
          )}

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

        {/* Admin Monitoring / Termination / Completion Alert Banner */}
        {adminBanner.show && (
          <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 max-w-2xl w-full px-4 animate-in slide-in-from-top duration-300">
            <div className={`text-white rounded-2xl shadow-2xl p-4 flex items-center justify-between border ${adminBanner.type === 'terminate'
              ? 'bg-red-600 border-red-500'
              : 'bg-emerald-600 border-emerald-500'
              }`}>
              <div className="flex items-center space-x-3">
                {adminBanner.type === 'terminate' ? (
                  <AlertTriangle className="w-6 h-6 flex-shrink-0 animate-bounce" />
                ) : (
                  <CheckCircle2 className="w-6 h-6 flex-shrink-0" />
                )}
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-white/80">
                    {adminBanner.type === 'terminate' ? 'Monitoring Alert' : 'Session Completed'}
                  </p>
                  <p className="text-sm font-semibold">{adminBanner.message}</p>
                  <p className="text-xs text-white/70 mt-0.5">Closing interview screen automatically...</p>
                </div>
              </div>
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
                  className={`rounded-xl px-3.5 py-2.5 text-sm font-black tabular-nums flex items-center gap-1.5 shadow-sm transition-all ${questionRemainingSec <= 30
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

                {isAdmin && (
                  <button
                    id="admin-leave-interview-btn"
                    type="button"
                    onClick={handleAdminLeave}
                    className="flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl transition-all shadow-sm active:scale-95 cursor-pointer ml-1"
                    title="Leave live interview and return to admin dashboard"
                  >
                    <LogOut className="w-3.5 h-3.5 text-red-600" />
                    <span>Leave</span>
                  </button>
                )}
              </div>
            </div>
            <p className="mb-3 text-xs font-bold uppercase tracking-widest text-[#1689aa]">
              {question?.category ? question.category.replaceAll('_', ' ') : 'General'}
            </p>
            <h2 className="text-2xl font-semibold leading-relaxed text-zinc-900">
              {question?.question_text || (isAdmin ? 'Observing live interview session...' : 'Loading question...')}
            </h2>
            {!isAdmin && (
              <div
                id="answer-recording-status"
                className="mt-8 flex items-center gap-3 text-xs font-bold uppercase tracking-widest flex-wrap"
              >
                {answerRecorderStatus === 'recording' && (
                  <span className="flex items-center gap-2 text-red-600">
                    <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
                    Recording your voice
                  </span>
                )}
                {isSavingRealtime && (
                  <span className="text-sky-600 flex items-center gap-1.5 font-medium normal-case tracking-normal">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-600" />
                    Saving answer to database...
                  </span>
                )}
                {!isSavingRealtime && hasSavedRealtime && (
                  <span className="text-emerald-600 flex items-center gap-1.5 font-medium normal-case tracking-normal">
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                    Answer saved in real time
                  </span>
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
              {!isAdmin && (
                currentQuestion === questions.length - 1 ? (
                  <button
                    id="submit-final-interview-answer"
                    type="button"
                    disabled={finalAnswerSubmitted || isUploadingNext}
                    onClick={() => void submitFinalAnswer()}
                    className="rounded-xl bg-[#34c4f2] hover:bg-[#2db0db] px-6 py-3.5 text-sm font-bold text-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed shadow-md transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2"
                  >
                    {isUploadingNext || finalAnswerSubmitted ? <><Loader2 className="w-4 h-4 animate-spin" /> Submitting interview...</> : 'Submit final answer'}
                  </button>
                ) : (
                  <button
                    id="next-interview-question"
                    type="button"
                    disabled={currentQuestion === questions.length - 1 || isUploadingNext}
                    onClick={() => void goToQuestion(currentQuestion + 1)}
                    className="rounded-xl bg-[#34c4f2] hover:bg-[#2db0db] px-6 py-3.5 text-sm font-bold text-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed shadow-md transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2"
                  >
                    {isUploadingNext ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : 'Next question'}
                  </button>
                )
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

              <div className="space-y-3">
                {/* Admin View: Admin self tile at top, Candidate remote tile below */}
                {isAdmin ? (
                  <>
                    <div className="relative rounded-2xl overflow-hidden bg-black border border-zinc-800 shadow-xl">
                      <MeetingVideoTile
                        stream={cameraStream}
                        micOn={micOn}
                        size="large"
                        label="You (Admin)"
                        muted={true}
                        mirror={true}
                        videoRef={cameraVideoRef}
                      />
                    </div>
                    {remoteStream && (
                      <div className="relative rounded-2xl overflow-hidden bg-black border border-zinc-800 shadow-xl">
                        <MeetingVideoTile
                          stream={remoteStream}
                          micOn={remoteMicOn}
                          size="large"
                          label="Candidate"
                          muted={false}
                          mirror={false}
                          videoRef={remoteVideoRef}
                        />
                      </div>
                    )}
                  </>
                ) : (
                  /* Candidate View: Interviewer tile at top (only while admin is present), Candidate self tile below (ALWAYS mounted) */
                  <>
                    {remoteStream && isAdminPresent && (
                      <div className="relative rounded-2xl overflow-hidden bg-black border border-zinc-800 shadow-xl">
                        <MeetingVideoTile
                          stream={remoteStream}
                          micOn={remoteMicOn}
                          size="large"
                          label="Interviewer"
                          muted={false}
                          mirror={false}
                          videoRef={remoteVideoRef}
                        />
                      </div>
                    )}
                    <div className="relative rounded-2xl overflow-hidden bg-black border border-zinc-800 shadow-xl">
                      <MeetingVideoTile
                        stream={cameraStream}
                        micOn={micOn}
                        size="large"
                        label="You"
                        muted={true}
                        mirror={true}
                        videoRef={cameraVideoRef}
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Live Voice / Candidate Speaking Caption for Admin */}
              {isAdmin && (candidateSpeakingText || isCandidateSpeaking) && (
                <div className="p-3 rounded-xl bg-sky-50 border border-sky-100 text-xs text-sky-800 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-sky-500 shrink-0 animate-ping" />
                  <span className="font-semibold text-sky-900">Live Candidate Voice:</span>
                  <span className="italic truncate">{candidateSpeakingText || 'Candidate is speaking...'}</span>
                </div>
              )}

              <MeetingControlBar
                micOn={micOn}
                onToggleMic={handleToggleMic}
                onLeave={isAdmin ? handleAdminLeave : undefined}
                settingsEnabled={false}
              />
            </div>

            {/* Admin Live Activity & Proctoring Feed */}
            {isAdmin && (
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm space-y-3">
                <div className="flex items-center justify-between border-b border-zinc-100 pb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-zinc-600 flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-amber-500" />
                    Live Proctoring & User Events
                  </span>
                  <span className="text-[10px] font-semibold bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full">
                    {liveEvents.length} recorded
                  </span>
                </div>
                <div className="max-h-48 overflow-y-auto space-y-2 text-xs">
                  {liveEvents.length === 0 ? (
                    <p className="text-zinc-400 italic text-center py-3">No suspicious activity detected</p>
                  ) : (
                    liveEvents.map((evt) => (
                      <div
                        key={evt.id}
                        className="p-2 rounded-lg bg-zinc-50 border border-zinc-100 flex items-start justify-between gap-2"
                      >
                        <div>
                          <span className="font-semibold capitalize text-zinc-800">
                            {evt.category.replaceAll('_', ' ')}
                          </span>
                          {evt.meta?.reason && (
                            <p className="text-zinc-500 text-[11px] mt-0.5">{String(evt.meta.reason)}</p>
                          )}
                        </div>
                        <span className="text-[10px] text-zinc-400 tabular-nums shrink-0">
                          {new Date(evt.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

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
          <h1 className="text-xl font-bold text-zinc-900">Join Interview</h1>
          <p className="text-sm text-zinc-500">
            Please enter your 6-digit passcode to continue.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="interview-access-code" className="block text-xs font-semibold text-zinc-500 mb-1 text-center">
              Candidate Passcode
            </label>
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
          </div>

          <div className="pt-2 border-t border-zinc-100">
            <label htmlFor="interview-email" className="block text-xs font-semibold text-zinc-500 mb-1 text-center">
              Interviewer / Admin Email (optional)
            </label>
            <input
              id="interview-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              className="w-full text-center text-sm py-3 bg-zinc-50 border border-zinc-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#34c4f2] text-zinc-900"
            />
          </div>
        </div>

        {error && (
          <div className="flex items-center space-x-2 p-4 text-sm text-red-600 bg-red-50 rounded-xl border border-red-100">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p className="font-medium">{error}</p>
          </div>
        )}

        <button
          id="interview-verify-submit"
          type="submit"
          disabled={submitting || (accessCode.length === 0 ? !email.trim() : accessCode.length !== 6)}
          className="w-full bg-[#34c4f2] hover:bg-[#2db0db] text-zinc-900 font-black py-4 rounded-2xl transition-all shadow-xl shadow-[#34c4f2]/30 flex items-center justify-center space-x-3 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-[0.2em] text-sm"
        >
          {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <span>Continue</span>}
        </button>
      </form>
    </main>
  );
}
