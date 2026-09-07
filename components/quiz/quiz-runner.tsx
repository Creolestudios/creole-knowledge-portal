'use client';

import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  Send,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Target,
  AlertCircle,
  Clock,
  Monitor,
  Camera,
} from 'lucide-react';
import { fetchWithAuthRetry } from '@/lib/api/fetch-with-auth';
import {
  QUIZ_TIME_LIMIT_SECONDS,
  QUIZ_IDLE_GRACE_SECONDS,
  formatDuration,
} from '@/lib/quizzes/timing';
import {
  requestEntireScreenShare,
  requestCameraAccess,
} from '@/lib/quizzes/proctor';
import { QuizCameraPreview } from '@/components/quiz/quiz-camera-preview';

type PendingResume = {
  attemptId: string;
  questions: any[];
  answers: Record<string, any>;
  timeLeft: number;
  currentIndex?: number;
};

type SetupStep = 'share' | 'camera' | 'instructions';

/** Wall clock for event/timer paths — kept outside render so purity lint is clean. */
function wallClockNow(): number {
  return Date.now();
}

function isQuestionAnswered(question: any, answers: Record<string, any>): boolean {
  const ans = answers[question?.id];
  const isDescriptive = ['conceptual', 'code', 'descriptive'].includes(question?.question_type);
  if (isDescriptive) {
    return typeof ans === 'string' && ans.trim().length > 0;
  }
  return Array.isArray(ans) && ans.length > 0;
}

/** Resume at the first unanswered question, or the last one if all are answered. */
function resumeQuestionIndex(
  questions: any[],
  answers: Record<string, any>,
  preferredIndex?: number,
): number {
  if (!questions.length) return 0;
  if (
    typeof preferredIndex === 'number' &&
    Number.isFinite(preferredIndex) &&
    preferredIndex >= 0 &&
    preferredIndex < questions.length
  ) {
    return preferredIndex;
  }
  const firstUnanswered = questions.findIndex((q) => !isQuestionAnswered(q, answers));
  if (firstUnanswered === -1) return Math.max(0, questions.length - 1);
  return firstUnanswered;
}

function quizProgressStorageKey(attemptId: string) {
  return `quiz-runner-progress:${attemptId}`;
}

function saveQuizProgress(attemptId: string | null | undefined, currentIndex: number) {
  if (!attemptId || typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(
      quizProgressStorageKey(attemptId),
      JSON.stringify({ currentIndex }),
    );
  } catch {
    // Ignore storage failures (private mode, etc.).
  }
}

function loadSavedQuizIndex(attemptId: string): number | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = sessionStorage.getItem(quizProgressStorageKey(attemptId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { currentIndex?: number };
    return typeof parsed.currentIndex === 'number' ? parsed.currentIndex : undefined;
  } catch {
    return undefined;
  }
}

interface QuizRunnerProps {
  blogId: number | string;
}

export function QuizRunner({ blogId }: QuizRunnerProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  
  // Quiz State
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentIndexRef = useRef(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  
  // Elapsed Time & 20-Min Idle Check State
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showIdleModal, setShowIdleModal] = useState(false);
  const [idleCountdown, setIdleCountdown] = useState(60);
  const [saving, setSaving] = useState(false);
  
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  // Absolute start instant. The timer derives elapsed time from this rather than
  // counting interval ticks, which browsers throttle in a background tab and
  // drop entirely while the machine sleeps.
  const startedAtMsRef = useRef<number>(0);
  /** Wall-clock moment pause began; null when timer is running. */
  const pausedAtMsRef = useRef<number | null>(null);
  /** Elapsed seconds frozen at pause — display/submit use this while halted. */
  const frozenElapsedRef = useRef(0);
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const requestingMediaRef = useRef(false);
  const submittingRef = useRef(false);
  /** Prevents double-firing while the tab stays hidden. */
  const leaveArmedRef = useRef(true);
  const attemptIdRef = useRef<string | null>(null);
  const pendingResumeRef = useRef<PendingResume | null>(null);
  const handleSubmitQuizRef = useRef<() => Promise<void>>(async () => {});
  const handleTabLeaveRef = useRef<() => void>(() => {});
  const handleScreenEndedRef = useRef<() => void>(() => {});
  const handleCameraEndedRef = useRef<() => void>(() => {});
  const haltScreenRef = useRef(false);
  const haltCameraRef = useRef(false);

  const [result, setResult] = useState<any>(null);
  const [setupStep, setSetupStep] = useState<SetupStep>('share');
  const [haltScreen, setHaltScreen] = useState(false);
  const [haltCamera, setHaltCamera] = useState(false);
  const [cameraPreviewStream, setCameraPreviewStream] = useState<MediaStream | null>(null);
  const isHalted = haltScreen || haltCamera;

  const releaseScreenShare = () => {
    const stream = screenStreamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) {
        track.onended = null;
        track.stop();
      }
    }
    screenStreamRef.current = null;
  };

  const releaseCamera = () => {
    const stream = cameraStreamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) {
        // Clear handler first so intentional stop during replace does not
        // look like a user-ended camera mid-quiz.
        track.onended = null;
        track.stop();
      }
    }
    cameraStreamRef.current = null;
    setCameraPreviewStream(null);
  };

  const releaseAllMedia = () => {
    releaseScreenShare();
    releaseCamera();
  };

  const clearQuizTimerInterval = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const clearIdleTimerInterval = () => {
    if (idleTimerRef.current) {
      clearInterval(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  };

  /** Fully stop every background countdown — quiz elapsed + idle grace. */
  const pauseQuizTimer = () => {
    if (pausedAtMsRef.current != null) {
      clearQuizTimerInterval();
      clearIdleTimerInterval();
      return;
    }
    clearQuizTimerInterval();
    clearIdleTimerInterval();
    frozenElapsedRef.current = Math.max(
      0,
      Math.floor((wallClockNow() - startedAtMsRef.current) / 1000),
    );
    setElapsedSeconds(frozenElapsedRef.current);
    pausedAtMsRef.current = wallClockNow();
  };

  const resumeQuizTimer = () => {
    if (pausedAtMsRef.current == null) return;
    if (haltScreenRef.current || haltCameraRef.current) return;
    // Rebuild start instant so only active (non-paused) time counts.
    startedAtMsRef.current = wallClockNow() - frozenElapsedRef.current * 1000;
    pausedAtMsRef.current = null;
    startTimer(startedAtMsRef.current);
  };

  const getClientElapsedSeconds = () => {
    if (pausedAtMsRef.current != null) {
      return frozenElapsedRef.current;
    }
    if (!startedAtMsRef.current) return undefined;
    return Math.max(0, Math.floor((wallClockNow() - startedAtMsRef.current) / 1000));
  };

  const setScreenHalt = (value: boolean) => {
    haltScreenRef.current = value;
    setHaltScreen(value);
  };

  const setCameraHalt = (value: boolean) => {
    haltCameraRef.current = value;
    setHaltCamera(value);
  };

  /** Tab leave once → auto-submit (unchanged scoring path). */
  const handleTabLeave = () => {
    if (submittingRef.current || requestingMediaRef.current) return;
    if (!leaveArmedRef.current) return;
    leaveArmedRef.current = false;

    if (!attemptIdRef.current) {
      setSetupStep('share');
      releaseAllMedia();
      setError('Stay on this tab. Please share your screen and camera again to continue.');
      return;
    }

    void handleSubmitQuizRef.current();
  };

  /** Screen share stopped mid-quiz → warning + halt (keep attempt + question index). */
  const handleScreenEnded = () => {
    if (submittingRef.current || requestingMediaRef.current) return;

    if (!attemptIdRef.current) {
      setSetupStep('share');
      releaseScreenShare();
      setError('Screen sharing stopped. Please share your entire screen again.');
      return;
    }

    saveQuizProgress(attemptIdRef.current, currentIndexRef.current);
    setScreenHalt(true);
    pauseQuizTimer();
  };

  /** Camera stopped mid-quiz → warning + halt (keep attempt + question index). */
  const handleCameraEnded = () => {
    if (submittingRef.current || requestingMediaRef.current) return;

    if (!attemptIdRef.current) {
      setSetupStep('camera');
      releaseCamera();
      setError('Camera stopped. Please allow camera access again.');
      return;
    }

    // Never tear down the attempt — only pause until camera is restored.
    saveQuizProgress(attemptIdRef.current, currentIndexRef.current);
    setCameraHalt(true);
    pauseQuizTimer();
  };

  const attachScreenShare = (stream: MediaStream) => {
    releaseScreenShare();
    screenStreamRef.current = stream;
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    track.onended = () => {
      handleScreenEndedRef.current();
    };
  };

  const attachCamera = (stream: MediaStream) => {
    releaseCamera();
    cameraStreamRef.current = stream;
    setCameraPreviewStream(stream);
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    track.onended = () => {
      handleCameraEndedRef.current();
    };
  };

  /**
   * @param startedAtMs absolute instant the attempt began. On resume this is
   *   rebuilt so paused wall-clock time does not count toward elapsed.
   */
  const startTimer = (startedAtMs?: number) => {
    clearQuizTimerInterval();
    // Never start a background tick while monitoring is halted.
    if (haltScreenRef.current || haltCameraRef.current || pausedAtMsRef.current != null) {
      return;
    }
    startedAtMsRef.current =
      typeof startedAtMs === 'number' && Number.isFinite(startedAtMs)
        ? startedAtMs
        : wallClockNow();

    const tick = () => {
      // Hard stop — do not advance elapsed while paused/halted.
      if (pausedAtMsRef.current != null || haltScreenRef.current || haltCameraRef.current) {
        clearQuizTimerInterval();
        return;
      }
      const next = Math.max(0, Math.floor((wallClockNow() - startedAtMsRef.current) / 1000));
      frozenElapsedRef.current = next;
      setElapsedSeconds(next);
      // At 20 minutes of elapsed time, trigger the Idle Check Modal.
      if (next >= QUIZ_TIME_LIMIT_SECONDS) {
        setShowIdleModal(prev => {
          if (!prev) setIdleCountdown(QUIZ_IDLE_GRACE_SECONDS);
          return true;
        });
      }
    };

    tick();
    timerRef.current = setInterval(tick, 1000);
  };

  const startQuizAttempt = async () => {
    try {
      const res = await fetchWithAuthRetry('/api/quizzes/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blogId }),
      });
      const data = await res.json();

      if (res.ok && data.success !== false && data.attemptId) {
        setAttemptId(data.attemptId);
        attemptIdRef.current = data.attemptId;
        setQuestions(data.questions);
        if (data.warning) setWarning(data.warning);
        const startedAtMs = data.startedAt ? new Date(data.startedAt).getTime() : Number.NaN;
        setShowIdleModal(false);
        leaveArmedRef.current = true;
        pausedAtMsRef.current = null;
        frozenElapsedRef.current = 0;
        startTimer(startedAtMs);
        return true;
      }
      setError(data.error || 'Failed to start quiz. You may have already taken it.');
      return false;
    } catch {
      setError('An error occurred while starting the quiz.');
      return false;
    }
  };

  const applyPendingResume = (pending: PendingResume) => {
    const questions = pending.questions || [];
    const answers = pending.answers || {};
    const savedIndex = loadSavedQuizIndex(pending.attemptId);
    const nextIndex = resumeQuestionIndex(
      questions,
      answers,
      pending.currentIndex ?? savedIndex,
    );

    setAttemptId(pending.attemptId);
    attemptIdRef.current = pending.attemptId;
    setQuestions(questions);
    setAnswers(answers);
    setCurrentIndex(nextIndex);
    currentIndexRef.current = nextIndex;
    saveQuizProgress(pending.attemptId, nextIndex);
    leaveArmedRef.current = true;
    pausedAtMsRef.current = null;
    frozenElapsedRef.current = 0;
    if (pending.timeLeft <= 0) {
      setError('Your previous active attempt timed out. Submitting saved progress...');
      startTimer(wallClockNow() - QUIZ_TIME_LIMIT_SECONDS * 1000);
    } else {
      const resumedElapsed = Math.max(
        0,
        QUIZ_TIME_LIMIT_SECONDS - (pending.timeLeft ?? QUIZ_TIME_LIMIT_SECONDS),
      );
      frozenElapsedRef.current = resumedElapsed;
      startTimer(wallClockNow() - resumedElapsed * 1000);
    }
  };

  /** Step 1: share entire screen. */
  const handleShareScreen = async () => {
    setLoading(true);
    setError('');
    setWarning('');
    requestingMediaRef.current = true;
    try {
      const stream = await requestEntireScreenShare();
      attachScreenShare(stream);
      setSetupStep('camera');
    } catch (err: any) {
      releaseScreenShare();
      setSetupStep('share');
      setError(err?.message || 'Screen sharing is required to start the quiz.');
    } finally {
      requestingMediaRef.current = false;
      setLoading(false);
    }
  };

  /** Step 2: allow camera. */
  const handleEnableCamera = async () => {
    setLoading(true);
    setError('');
    requestingMediaRef.current = true;
    try {
      const stream = await requestCameraAccess();
      attachCamera(stream);
      setSetupStep('instructions');
    } catch (err: any) {
      releaseCamera();
      setSetupStep('camera');
      setError(err?.message || 'Camera access is required to start the quiz.');
    } finally {
      requestingMediaRef.current = false;
      setLoading(false);
    }
  };

  /** Step 3: user acknowledges rules, then start or resume the attempt. */
  const handleAcknowledgeInstructions = async () => {
    setLoading(true);
    setError('');
    try {
      if (pendingResumeRef.current) {
        applyPendingResume(pendingResumeRef.current);
        pendingResumeRef.current = null;
        setSetupStep('share');
      } else {
        const started = await startQuizAttempt();
        if (!started) {
          releaseAllMedia();
          setSetupStep('share');
        } else {
          setSetupStep('share');
        }
      }
    } finally {
      setLoading(false);
    }
  };

  /** Restore screen share while halted mid-quiz. */
  const handleRestoreScreen = async () => {
    setLoading(true);
    setError('');
    requestingMediaRef.current = true;
    try {
      const stream = await requestEntireScreenShare();
      attachScreenShare(stream);
      setScreenHalt(false);
      if (!haltCameraRef.current) {
        resumeQuizTimer();
      }
    } catch (err: any) {
      setError(err?.message || 'Screen sharing is required to continue the quiz.');
    } finally {
      requestingMediaRef.current = false;
      setLoading(false);
    }
  };

  /** Restore camera while halted mid-quiz — stay on the same question. */
  const handleRestoreCamera = async () => {
    setLoading(true);
    setError('');
    requestingMediaRef.current = true;
    try {
      const stream = await requestCameraAccess();
      attachCamera(stream);
      setCameraHalt(false);
      // Keep the same question the user was on when the camera stopped.
      const idx = currentIndexRef.current;
      setCurrentIndex(idx);
      if (!haltScreenRef.current) {
        resumeQuizTimer();
      }
    } catch (err: any) {
      // Stay halted on the same attempt/question — do not restart setup.
      setCameraHalt(true);
      setError(err?.message || 'Camera access is required to continue the quiz.');
    } finally {
      requestingMediaRef.current = false;
      setLoading(false);
    }
  };

  // Autosave when moving to next question
  const saveCurrentAnswer = async () => {
    const qId = questions[currentIndex]?.id;
    const ans = answers[qId];
    if (ans && attemptId) {
      try {
        const res = await fetchWithAuthRetry('/api/quizzes/evaluate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            attemptId,
            questionId: qId,
            userAnswer: ans
          })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          console.error('Autosave evaluation failed:', res.status, data?.error);
          setError(
            res.status === 401
              ? 'Your session expired. Please refresh the page and sign in again to save your answer.'
              : 'Could not save your answer. Please try again.'
          );
          return false;
        }
        setError('');
      } catch (err) {
        console.error('Autosave evaluation error:', err);
        setError('Could not save your answer. Please check your connection and try again.');
        return false;
      }
    }
    return true;
  };

  const handleSubmitQuiz = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    clearQuizTimerInterval();
    clearIdleTimerInterval();
    pausedAtMsRef.current = null;
    setShowIdleModal(false);
    setLoading(true);
    await saveCurrentAnswer();

    try {
      const res = await fetchWithAuthRetry('/api/quizzes/finish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attemptId: attemptIdRef.current || attemptId,
          clientElapsedSeconds: getClientElapsedSeconds(),
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        releaseAllMedia();
        setResult(data.result);
      } else {
        setError(data.error || 'Failed to submit quiz.');
      }
    } catch (err) {
      setError('An error occurred while submitting.');
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  // Keep callback refs in sync outside render (required by react-hooks/refs).
  useLayoutEffect(() => {
    handleTabLeaveRef.current = handleTabLeave;
    handleScreenEndedRef.current = handleScreenEnded;
    handleCameraEndedRef.current = handleCameraEnded;
    handleSubmitQuizRef.current = handleSubmitQuiz;
  });

  // Idle grace countdown — must not run while the quiz is halted/paused.
  useEffect(() => {
    if (showIdleModal && !isHalted) {
      clearIdleTimerInterval();
      idleTimerRef.current = setInterval(() => {
        if (pausedAtMsRef.current != null || haltScreenRef.current || haltCameraRef.current) {
          clearIdleTimerInterval();
          return;
        }
        setIdleCountdown(prev => {
          if (prev <= 1) {
            clearIdleTimerInterval();
            setShowIdleModal(false);
            handleSubmitQuiz();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      clearIdleTimerInterval();
    }

    return () => {
      clearIdleTimerInterval();
    };
  }, [showIdleModal, isHalted]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleContinueQuiz = () => {
    setShowIdleModal(false);
    setElapsedSeconds(0); // Reset idle timer for another 20 minutes
    setIdleCountdown(60);
  };

  useEffect(() => {
    let mounted = true;

    const initializeQuiz = async () => {
      try {
        const statusRes = await fetch(`/api/quizzes/status?blogId=${blogId}`);
        const statusData = await statusRes.json();
        
        if (!mounted) return;

        if (statusData.completed) {
          setResult(statusData.result);
          setInitializing(false);
        } else if (statusData.inProgress) {
          const savedIndex = loadSavedQuizIndex(statusData.attemptId);
          pendingResumeRef.current = {
            attemptId: statusData.attemptId,
            questions: statusData.questions || [],
            answers: statusData.answers || {},
            timeLeft: statusData.timeLeft ?? QUIZ_TIME_LIMIT_SECONDS,
            currentIndex: savedIndex,
          };
          setInitializing(false);
        } else {
          pendingResumeRef.current = null;
          setInitializing(false);
        }
      } catch (err) {
        if (mounted) {
          setError('Network error while checking quiz status.');
          setInitializing(false);
        }
      }
    };

    initializeQuiz();

    return () => {
      mounted = false;
      // Stop screen/camera + timers when the quiz page unmounts or blogId changes.
      releaseAllMedia();
      if (timerRef.current) clearInterval(timerRef.current);
      if (idleTimerRef.current) clearInterval(idleTimerRef.current);
    };
  }, [blogId]); // eslint-disable-line react-hooks/exhaustive-deps -- releaseAllMedia is stable per mount; re-run only on blog change

  useEffect(() => {
    if (!attemptId || result) return;

    const onVisibility = () => {
      if (document.hidden) {
        handleTabLeaveRef.current();
      } else {
        // Re-arm so a later leave can fire once (guards against duplicate events while hidden).
        leaveArmedRef.current = true;
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [attemptId, result]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
    if (attemptId) {
      saveQuizProgress(attemptId, currentIndex);
    }
  }, [attemptId, currentIndex]);

  // Handle Answer Selection
  const handleOptionSelect = (qId: string, option: string, isMultiple: boolean) => {
    if (isHalted) return;
    setAnswers(prev => {
      const current = prev[qId];
      if (isMultiple) {
        let arr = Array.isArray(current) ? [...current] : [];
        if (arr.includes(option)) {
          arr = arr.filter(o => o !== option);
        } else {
          arr.push(option);
        }
        return { ...prev, [qId]: arr };
      } else {
        return { ...prev, [qId]: [option] };
      }
    });
  };

  const handleTextChange = (qId: string, text: string) => {
    if (isHalted) return;
    setAnswers(prev => ({ ...prev, [qId]: text }));
  };

  const handleNext = async () => {
    if (saving || isHalted) return;
    setSaving(true);
    try {
      const saved = await saveCurrentAnswer();
      if (!saved) return;
      if (currentIndex < questions.length - 1) {
        const next = currentIndex + 1;
        currentIndexRef.current = next;
        setCurrentIndex(next);
        saveQuizProgress(attemptIdRef.current, next);
      }
    } finally {
      setSaving(false);
    }
  };

  const handlePrev = () => {
    if (isHalted) return;
    if (currentIndex > 0) {
      const prev = currentIndex - 1;
      currentIndexRef.current = prev;
      setCurrentIndex(prev);
      saveQuizProgress(attemptIdRef.current, prev);
    }
  };

  const hasAnsweredAll = () => {
    if (questions.length === 0) return false;
    return questions.every(q => {
      const ans = answers[q.id];
      const isDescriptive = ['conceptual', 'code', 'descriptive'].includes(q.question_type);
      if (isDescriptive) {
        return typeof ans === 'string' && ans.trim().length > 0;
      } else {
        return Array.isArray(ans) && ans.length > 0;
      }
    });
  };

  // Render Functions
  if (result) {
    return (
      <div className="space-y-6 mt-8">
        <div className="bg-[#0f0f11] border border-zinc-800 rounded-2xl p-8 max-w-3xl mx-auto text-center shadow-2xl">
          <div className="w-20 h-20 bg-brand/10 text-brand rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 size={40} />
          </div>
          <h2 className="text-3xl font-black text-white mb-2">Quiz Completed!</h2>
          <p className="text-zinc-400 mb-4">Your AI evaluation is complete.</p>

          {(() => {
            const count = result.attemptsCount || 1;
            const remaining = result.attemptsRemaining ?? Math.max(0, 3 - count);
            const isPassed = Boolean(result.passed);
            return (
              <div className="mb-6 space-y-2">
                <span className={`inline-block px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider ${isPassed ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'}`}>
                  {isPassed ? 'Quiz Passed! 🎉' : `Attempt ${count} of 3 Completed • ${remaining} ${remaining === 1 ? 'attempt' : 'attempts'} remaining`}
                </span>
              </div>
            );
          })()}

          <div className="grid grid-cols-2 gap-4 mb-8">
            <div className="bg-zinc-900/50 rounded-xl p-4 border border-zinc-800">
              <div className="text-xs text-zinc-500 font-bold uppercase tracking-wider mb-1">Correct Answers</div>
              <div className="text-2xl font-black text-green-400">{result.correctAnswers} / {result.totalQuestions || 5}</div>
            </div>
            <div className="bg-zinc-900/50 rounded-xl p-4 border border-zinc-800">
              <div className="text-xs text-zinc-500 font-bold uppercase tracking-wider mb-1">Time Taken</div>
              <div className="text-2xl font-black text-white">{formatDuration(result.timeTaken ?? elapsedSeconds)}</div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button 
              onClick={() => router.push('/dashboard')}
              className="w-full sm:w-1/2 py-4 bg-zinc-800 hover:bg-zinc-700 text-white font-black uppercase tracking-widest text-xs rounded-xl transition-all cursor-pointer"
            >
              Back to Dashboard
            </button>
            {(!result.passed && ((result.attemptsRemaining ?? (3 - (result.attemptsCount || 1))) > 0)) && (
              <button 
                onClick={() => {
                  setResult(null);
                  setAttemptId(null);
                  attemptIdRef.current = null;
                  setQuestions([]);
                  setCurrentIndex(0);
                  setAnswers({});
                  setWarning('');
                  pendingResumeRef.current = null;
                  setSetupStep('share');
                  setScreenHalt(false);
                  setCameraHalt(false);
                  leaveArmedRef.current = true;
                  setError('');
                }}
                disabled={loading}
                className="w-full sm:w-1/2 py-4 bg-brand hover:bg-brand/90 text-black font-black uppercase tracking-widest text-xs rounded-xl transition-all shadow-brand cursor-pointer disabled:opacity-50"
              >
                {loading ? 'Starting Attempt...' : `Retake Quiz — Attempt ${(result.attemptsCount || 1) + 1} of 3`}
              </button>
            )}
          </div>
        </div>

        {result.reviewData && result.reviewData.length > 0 && (
          <div className="max-w-3xl mx-auto space-y-4">
            <h3 className="text-xl font-black text-white mb-6 border-b border-zinc-800 pb-2">Detailed Review</h3>
            {result.reviewData.map((review: any, idx: number) => (
              <div key={review.questionId} className={`p-6 rounded-xl border ${review.isCorrect ? 'bg-green-950/20 border-green-900/50' : 'bg-red-950/20 border-red-900/50'} text-left`}>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-zinc-400 text-sm font-bold uppercase tracking-wider">Question {idx + 1}</span>
                  <div className="flex items-center gap-2">

                    <span className={`text-sm font-bold px-3 py-1 rounded-full ${review.isCorrect ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                      {review.isCorrect ? 'Correct' : 'Incorrect'} ({review.pointsAwarded} pts)
                    </span>
                  </div>
                </div>
                <p className="text-white font-medium mb-6 text-lg">{review.question}</p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div className="bg-black/20 p-4 rounded-lg border border-white/5 relative">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs text-zinc-500 uppercase font-bold tracking-wider block">Your Answer</span>
                      {['conceptual', 'code', 'descriptive'].includes(review.questionType) && review.matchPercentage !== undefined && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${review.matchPercentage >= 70 ? 'bg-green-500/20 text-green-400 border-green-500/30' : review.matchPercentage >= 50 ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30'}`}>
                          {review.matchPercentage}% AI Semantic Match
                        </span>
                      )}
                    </div>
                    <div className="text-zinc-300 font-medium">{Array.isArray(review.userAnswer) ? review.userAnswer.join(', ') : review.userAnswer || 'No answer provided'}</div>
                  </div>
                  <div className="bg-emerald-950/20 p-4 rounded-lg border border-emerald-900/30">
                    <span className="text-xs text-emerald-500 uppercase font-bold tracking-wider mb-2 block">Correct Answer</span>
                    <div className="text-emerald-400 font-medium">{Array.isArray(review.correctAnswers) ? review.correctAnswers.join(', ') : review.correctAnswers}</div>
                  </div>
                </div>

                {(review.evaluationReason || review.explanation) && (
                  <div className="bg-black/40 p-5 rounded-lg mt-4 border border-zinc-800">
                    <span className="text-xs text-brand uppercase font-bold tracking-wider mb-2 block flex items-center gap-2">
                      <Target size={14} /> AI Explanation
                    </span>
                    <p className="text-zinc-400 text-sm leading-relaxed">{review.evaluationReason || review.explanation}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (initializing) {
    return (
      <div className="bg-[#0f0f11] border border-zinc-800 rounded-2xl p-12 max-w-2xl mx-auto mt-8 text-center shadow-2xl flex flex-col items-center justify-center space-y-4">
        <div className="w-10 h-10 border-4 border-brand border-t-transparent rounded-full animate-spin"></div>
        <p className="text-zinc-500 font-bold uppercase tracking-widest text-sm">Initializing Quiz Environment...</p>
      </div>
    );
  }

  if (!attemptId) {
    if (setupStep === 'instructions') {
      return (
        <div className="bg-[#0f0f11] border border-brand/20 rounded-2xl p-8 mt-8 max-w-2xl mx-auto shadow-brand space-y-6">
          <div className="text-center space-y-3">
            <div className="w-16 h-16 bg-brand/10 border border-brand/20 rounded-2xl mx-auto flex items-center justify-center text-brand">
              <AlertCircle size={32} />
            </div>
            <h3 className="text-xl font-black text-white">Quiz instructions</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Read these rules carefully before you start. Scoring and answers work the same as usual —
              this only covers monitoring while you take the quiz.
            </p>
          </div>

          <ul className="space-y-3 text-left text-sm text-zinc-300 leading-relaxed">
            <li className="flex gap-3">
              <span className="text-brand font-black">1.</span>
              <span>
                Keep your <strong className="text-white">entire screen shared</strong> and your{' '}
                <strong className="text-white">camera on</strong> until you finish the quiz.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-brand font-black">2.</span>
              <span>
                If you <strong className="text-white">stop screen sharing</strong> or{' '}
                <strong className="text-white">turn off the camera</strong>, the quiz will{' '}
                <strong className="text-white">pause</strong> with a warning until you turn it back on.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-brand font-black">3.</span>
              <span>
                If you switch away from this tab <strong className="text-white">even once</strong>, the quiz will be{' '}
                <strong className="text-white">auto-submitted</strong> with the score you have earned up to that point
                (answers saved so far).
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-brand font-black">4.</span>
              <span>We do not record or store your screen or camera video.</span>
            </li>
          </ul>

          {error && <p className="text-red-400 text-sm font-medium text-center">{error}</p>}

          <button
            type="button"
            onClick={() => void handleAcknowledgeInstructions()}
            disabled={loading}
            className="w-full px-6 py-3 bg-white text-black hover:bg-zinc-200 transition-colors font-bold text-sm rounded-xl disabled:opacity-50"
          >
            {loading ? 'Starting quiz...' : 'I understand — start quiz'}
          </button>
        </div>
      );
    }

    if (setupStep === 'camera') {
      return (
        <div className="bg-[#0f0f11] border border-brand/20 rounded-2xl p-8 mt-8 max-w-2xl mx-auto shadow-brand text-center space-y-5">
          <div className="w-16 h-16 bg-brand/10 border border-brand/20 rounded-2xl mx-auto flex items-center justify-center text-brand">
            <Camera size={32} />
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-bold text-white">Allow camera access</h3>
            <p className="text-zinc-400 text-sm leading-relaxed">
              Screen sharing is on. Next, allow your camera. It stays on as a monitoring lock —
              we do not record or store the video.
            </p>
          </div>
          {error && <p className="text-red-400 text-sm font-medium">{error}</p>}
          <button
            type="button"
            onClick={() => void handleEnableCamera()}
            disabled={loading}
            className="px-6 py-3 bg-white text-black hover:bg-zinc-200 transition-colors font-bold text-sm rounded-xl disabled:opacity-50"
          >
            {loading ? 'Waiting for camera...' : 'Allow camera to continue'}
          </button>
        </div>
      );
    }

    return (
      <div className="bg-[#0f0f11] border border-brand/20 rounded-2xl p-8 mt-8 max-w-2xl mx-auto shadow-brand text-center space-y-5">
        <div className="w-16 h-16 bg-brand/10 border border-brand/20 rounded-2xl mx-auto flex items-center justify-center text-brand">
          <Monitor size={32} />
        </div>
        <div className="space-y-2">
          <h3 className="text-lg font-bold text-white flex items-center justify-center gap-2">
            <Target className="text-brand" /> Test Your Knowledge
          </h3>
          <p className="text-zinc-400 text-sm leading-relaxed">
            Share your entire screen first, then allow your camera, then read the quiz rules.
            We do not record or store the shared video.
          </p>
        </div>
        {error && <p className="text-red-400 text-sm font-medium">{error}</p>}
        <button
          type="button"
          onClick={() => void handleShareScreen()}
          disabled={loading}
          className="px-6 py-3 bg-white text-black hover:bg-zinc-200 transition-colors font-bold text-sm rounded-xl disabled:opacity-50"
        >
          {loading ? 'Waiting for screen share...' : 'Share entire screen to begin'}
        </button>
      </div>
    );
  }

  const q = questions[currentIndex];

  if (!q) {
    return (
      <div className="bg-[#0f0f11] border border-zinc-800 rounded-2xl p-12 max-w-2xl mx-auto mt-8 text-center shadow-2xl flex flex-col items-center justify-center space-y-4">
        <p className="text-zinc-400 font-bold uppercase tracking-widest text-sm">No questions available for this attempt.</p>
        <div className="flex gap-4">
          <button 
            onClick={() => router.push('/dashboard')}
            className="px-6 py-3 bg-zinc-800 text-white hover:bg-zinc-700 transition-colors font-bold text-sm rounded-xl"
          >
            Back to Dashboard
          </button>
          <button 
            onClick={() => void handleShareScreen()}
            disabled={loading}
            className="px-6 py-3 bg-brand text-black hover:bg-brand/90 transition-colors font-bold text-sm rounded-xl"
          >
            {loading ? 'Waiting for screen share...' : 'Restart Quiz'}
          </button>
        </div>
      </div>
    );
  }

  const isMultiple = q.question_type === 'multiple';
  const isDescriptive = ['conceptual', 'code', 'descriptive'].includes(q.question_type);

  return (
    <div className="bg-[#0f0f11] border border-zinc-800 rounded-2xl overflow-hidden mt-8 max-w-4xl mx-auto shadow-2xl relative">
      <QuizCameraPreview
        stream={cameraPreviewStream}
        visible={Boolean(attemptId && !result && !haltCamera && cameraPreviewStream)}
      />
      {/* Halt when screen share and/or camera stop — monitoring only */}
      <AnimatePresence>
        {isHalted && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[#16161a] border border-amber-500/30 rounded-3xl p-8 max-w-md w-full shadow-2xl text-center space-y-6"
            >
              <div className="w-16 h-16 bg-amber-500/10 border border-amber-500/30 rounded-2xl mx-auto flex items-center justify-center text-amber-400">
                {haltScreen && haltCamera ? (
                  <AlertCircle size={32} />
                ) : haltScreen ? (
                  <Monitor size={32} />
                ) : (
                  <Camera size={32} />
                )}
              </div>
              <div className="space-y-2">
                <h3 className="text-2xl font-black text-white tracking-tight">
                  Quiz paused
                </h3>
                <p className="text-zinc-400 text-sm leading-relaxed">
                  {haltScreen && haltCamera
                    ? 'Screen sharing and camera both stopped. Restore both to continue. Your timer is paused.'
                    : haltScreen
                      ? 'Screen sharing stopped. Restore screen sharing to continue. Your timer is paused.'
                      : 'Camera stopped. Allow camera access again to continue. Your timer is paused.'}
                </p>
              </div>
              {error && <p className="text-red-400 text-sm font-medium">{error}</p>}
              <div className="space-y-3 pt-2">
                {haltScreen && (
                  <button
                    type="button"
                    onClick={() => void handleRestoreScreen()}
                    disabled={loading}
                    className="w-full py-4 bg-brand hover:bg-brand/90 text-black font-black uppercase tracking-widest text-xs rounded-xl transition-all shadow-brand cursor-pointer disabled:opacity-50"
                  >
                    {loading ? 'Waiting...' : 'Restore screen share'}
                  </button>
                )}
                {haltCamera && (
                  <button
                    type="button"
                    onClick={() => void handleRestoreCamera()}
                    disabled={loading}
                    className="w-full py-4 bg-white hover:bg-zinc-200 text-black font-black uppercase tracking-widest text-xs rounded-xl transition-all cursor-pointer disabled:opacity-50"
                  >
                    {loading ? 'Waiting...' : 'Restore camera'}
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 20-Minute Idle Check Popup Modal */}
      <AnimatePresence>
        {showIdleModal && !isHalted && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[#16161a] border border-amber-500/30 rounded-3xl p-8 max-w-md w-full shadow-2xl text-center space-y-6"
            >
              <div className="w-16 h-16 bg-amber-500/10 border border-amber-500/30 rounded-2xl mx-auto flex items-center justify-center text-amber-400">
                <Clock size={32} />
              </div>

              <div className="space-y-2">
                <h3 className="text-2xl font-black text-white tracking-tight">
                  Still working on your quiz?
                </h3>
                <p className="text-zinc-400 text-sm leading-relaxed">
                  You have been on this attempt for 20 minutes. Please confirm if you would like to keep working.
                </p>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-amber-400 text-xs font-mono font-bold flex items-center justify-center gap-2">
                <AlertCircle size={16} /> Auto-submitting in {idleCountdown}s...
              </div>

              <div className="space-y-3 pt-2">
                <button
                  type="button"
                  onClick={handleContinueQuiz}
                  className="w-full py-4 bg-brand hover:bg-brand/90 text-black font-black uppercase tracking-widest text-xs rounded-xl transition-all shadow-brand cursor-pointer"
                >
                  Yes, Continue Quiz
                </button>
                <button
                  type="button"
                  onClick={() => handleSubmitQuiz()}
                  className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer"
                >
                  Submit Quiz Now
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-[#16161a]">
        <div className="text-sm font-bold text-zinc-400 uppercase tracking-widest">
          Question {currentIndex + 1} of {questions.length}
        </div>
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-2 font-mono text-xs font-bold px-3 py-1.5 rounded-lg border ${haltScreen ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'}`}>
            <Monitor size={14} />
            {haltScreen ? 'Screen off' : 'Screen on'}
          </div>
          <div className={`flex items-center gap-2 font-mono text-xs font-bold px-3 py-1.5 rounded-lg border ${haltCamera ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'}`}>
            <Camera size={14} />
            {haltCamera ? 'Camera off' : 'Camera on'}
          </div>
          <div className="flex items-center gap-2 font-mono text-sm font-bold text-brand bg-brand/10 border border-brand/20 px-3 py-1.5 rounded-lg">
            <Clock size={16} />
            Time Elapsed: {formatDuration(elapsedSeconds)}
            {isHalted ? ' (paused)' : ''}
          </div>
        </div>
      </div>

      {warning && (
        <div className="px-6 py-3 bg-amber-500/10 border-b border-amber-500/20 flex items-start gap-3 text-amber-400">
          <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
          <div className="text-xs leading-relaxed font-medium">
            {warning}
          </div>
        </div>
      )}

      {/* Progress */}
      <div className="h-1 w-full bg-zinc-900">
        <motion.div 
          className="h-full bg-brand"
          initial={{ width: 0 }}
          animate={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
        />
      </div>

      {/* Question Content */}
      <div className="p-8">
        <span className="inline-block px-3 py-1 bg-zinc-800 text-zinc-300 text-[10px] font-bold uppercase tracking-widest rounded-md mb-4">
          {q.question_type} • {q.difficulty}
        </span>
        <h2 className="text-xl md:text-2xl font-semibold text-white leading-relaxed mb-6">
          {q.question}
        </h2>

        {q.code_snippet && (
          <div className="mb-6 rounded-xl overflow-hidden border border-zinc-800 font-mono text-sm shadow-lg">
            <div className="px-4 py-2 bg-zinc-900 border-b border-zinc-800 text-zinc-500 text-xs">Code Snippet</div>
            <pre className="p-4 bg-[#0a0a0c] text-zinc-300 overflow-x-auto">
              <code>{q.code_snippet}</code>
            </pre>
          </div>
        )}

        {/* Options / Input */}
        {isDescriptive ? (
          <textarea 
            value={answers[q.id] || ''}
            onChange={(e) => handleTextChange(q.id, e.target.value)}
            placeholder="Type your detailed answer here... (AI evaluated)"
            aria-label="Your detailed answer"
            disabled={isHalted}
            className="w-full h-40 bg-zinc-900/50 border border-zinc-700 rounded-xl p-4 text-white placeholder-zinc-500 focus:outline-none focus:border-brand focus:ring-1 focus:ring-brand resize-none disabled:opacity-50"
          />
        ) : (
          <div className="space-y-3" role={isMultiple ? "group" : "radiogroup"}>
            {q.options?.map((opt: string, i: number) => {
              const isSelected = (answers[q.id] || []).includes(opt);
              return (
                <button
                  key={i}
                  role={isMultiple ? "checkbox" : "radio"}
                  aria-checked={isSelected}
                  disabled={isHalted}
                  onClick={() => handleOptionSelect(q.id, opt, isMultiple)}
                  className={`w-full text-left p-4 rounded-xl border transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                    isSelected 
                      ? 'bg-brand/10 border-brand text-white shadow-brand' 
                      : 'bg-zinc-900/30 border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:bg-zinc-900'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-5 h-5 flex items-center justify-center border rounded flex-shrink-0 ${isMultiple ? 'rounded-md' : 'rounded-full'} ${isSelected ? 'border-brand bg-brand text-black' : 'border-zinc-600'}`}>
                      {isSelected && <CheckCircle2 size={14} strokeWidth={4} />}
                    </div>
                    <span className="text-[15px] font-medium leading-relaxed">{opt}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer Controls */}
      <div className="px-8 py-5 border-t border-zinc-800 bg-[#16161a] flex items-center justify-between">
        <button 
          onClick={handlePrev}
          disabled={currentIndex === 0 || loading || isHalted}
          className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors text-sm font-semibold disabled:opacity-30 disabled:hover:text-zinc-400"
        >
          <ArrowLeft size={16} /> Previous
        </button>

        {currentIndex === questions.length - 1 ? (
          <div className="flex flex-col items-end gap-1.5">
            {!hasAnsweredAll() && (
              <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                Answer all questions to submit
              </span>
            )}
            <button 
              onClick={() => handleSubmitQuiz()}
              disabled={loading || !hasAnsweredAll() || isHalted}
              className="flex items-center gap-2 bg-brand text-black hover:bg-brand/90 transition-colors px-6 py-2.5 rounded-lg text-sm font-black uppercase tracking-wider disabled:opacity-30 disabled:hover:bg-brand disabled:cursor-not-allowed"
            >
              {loading ? 'Submitting...' : 'Submit Quiz'} <Send size={16} />
            </button>
          </div>
        ) : (
          <button 
            onClick={handleNext}
            disabled={saving || isHalted}
            className="flex items-center gap-2 bg-white text-black hover:bg-zinc-200 transition-colors px-6 py-2.5 rounded-lg text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Next'} <ArrowRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
