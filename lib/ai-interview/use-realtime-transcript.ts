'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { countFillerWords } from './fluency-calculator';

// Web Speech API types
interface SpeechRecognitionResultItem {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResultList {
  [index: number]: {
    [index: number]: SpeechRecognitionResultItem;
    isFinal: boolean;
    length: number;
  };
  length: number;
}
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  }
}

export interface UseRealtimeTranscriptOptions {
  interviewId: string;
  currentQuestionOrd?: number;
  isCandidateTurn: boolean;
  onTranscriptLine?: (line: { text: string; isFinal: boolean }) => void;
}

function getBestLanguage(): string {
  if (typeof navigator === 'undefined') return 'en-US';
  if (navigator.languages?.some((l) => l.toLowerCase() === 'en-in')) {
    return 'en-IN';
  }
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && (tz.includes('Calcutta') || tz.includes('Kolkata') || tz.includes('Asia/Colombo'))) {
      return 'en-IN';
    }
  } catch {
    // ignore
  }
  return navigator.languages?.[0] || navigator.language || 'en-US';
}

export function useRealtimeTranscript({
  interviewId,
  currentQuestionOrd = 1,
  isCandidateTurn,
  onTranscriptLine,
}: UseRealtimeTranscriptOptions) {
  const [interimText, setInterimText] = useState('');
  const [accumulatedText, setAccumulatedText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(
    () =>
      typeof window === 'undefined'
        ? true
        : !!(window.SpeechRecognition || window.webkitSpeechRecognition)
  );

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const isCandidateTurnRef = useRef(isCandidateTurn);
  const currentQuestionOrdRef = useRef(currentQuestionOrd);
  const turnStartTimeRef = useRef<number>(0);
  const speechStartRef = useRef<number>(0);
  const speechMsAccumRef = useRef<number>(0);
  const pausesCountRef = useRef<number>(0);
  const lastFinalTimestampRef = useRef<number>(0);
  const accumulatedTextRef = useRef('');
  const interimTextRef = useRef('');
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorRetryCountRef = useRef<number>(0);
  const isErrorRestartRef = useRef<boolean>(false);
  const activeLangRef = useRef<string>(getBestLanguage());

  useEffect(() => {
    isCandidateTurnRef.current = isCandidateTurn;
  }, [isCandidateTurn]);

  useEffect(() => {
    currentQuestionOrdRef.current = currentQuestionOrd;
  }, [currentQuestionOrd]);

  const onTranscriptLineRef = useRef(onTranscriptLine);
  useEffect(() => {
    onTranscriptLineRef.current = onTranscriptLine;
  }, [onTranscriptLine]);

  // Persists the full consolidated answer for a question turn as a single DB row.
  const persistFullAnswer = useCallback(
    async (text: string) => {
      if (!interviewId) return;
      try {
        await fetch(`/api/interview/${interviewId}/transcript`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            questionOrd: currentQuestionOrdRef.current,
            speaker: 'candidate',
            text: (text || '').trim(),
            tsMs: Date.now(),
          }),
        });
      } catch (err) {
        console.warn('[realtime-transcript] Failed to persist answer:', err);
      }
    },
    [interviewId]
  );

  // Instantiates a fresh SpeechRecognition session. Chrome often refuses to restart
  // or drops into a dead state if start() is called on an instance that already fired onend.
  const createAndStartRecognition = useCallback(() => {
    if (typeof window === 'undefined') return;
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      setIsSupported(false);
      return;
    }

    // Tear down any existing instance cleanly
    if (recognitionRef.current) {
      const prev = recognitionRef.current;
      recognitionRef.current = null;
      try {
        prev.onresult = null;
        prev.onerror = null;
        prev.onend = null;
        prev.abort();
      } catch {
        // ignore
      }
    }

    if (!isCandidateTurnRef.current) {
      setIsListening(false);
      return;
    }

    try {
      const recognition = new SpeechRec();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.lang = activeLangRef.current;

      recognition.onresult = (event: SpeechRecognitionEventLike) => {
        if (!isCandidateTurnRef.current) return;

        const now = Date.now();
        errorRetryCountRef.current = 0;
        isErrorRestartRef.current = false;
        if (speechStartRef.current === 0) {
          speechStartRef.current = now;
        }

        let currentInterim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const item = event.results[i];
          const phrase = item[0]?.transcript || '';

          if (item.isFinal) {
            const trimmed = phrase.trim();
            if (trimmed) {
              const next = accumulatedTextRef.current
                ? `${accumulatedTextRef.current} ${trimmed}`
                : trimmed;
              accumulatedTextRef.current = next;
              setAccumulatedText(next);
              onTranscriptLineRef.current?.({ text: trimmed, isFinal: true });

              if (lastFinalTimestampRef.current > 0 && now - lastFinalTimestampRef.current > 800) {
                pausesCountRef.current += 1;
              }
              speechMsAccumRef.current += Math.max(500, now - lastFinalTimestampRef.current);
              lastFinalTimestampRef.current = now;
            }
          } else {
            currentInterim += phrase;
          }
        }

        interimTextRef.current = currentInterim;
        setInterimText(currentInterim);
        if (currentInterim) {
          onTranscriptLineRef.current?.({ text: currentInterim, isFinal: false });
        }
      };

      recognition.onerror = (e: any) => {
        if (e?.error === 'not-allowed') {
          setIsListening(false);
          return;
        }
        if (e?.error === 'service-not-allowed') {
          setIsListening(false);
          return;
        }
        if (e?.error === 'language-not-supported') {
          // If regional language (e.g. en-IN) is not supported on this OS/browser, fallback to en-US
          activeLangRef.current = 'en-US';
          if (isCandidateTurnRef.current) {
            if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
            restartTimerRef.current = setTimeout(() => {
              if (isCandidateTurnRef.current) {
                createAndStartRecognition();
              }
            }, 100);
          }
          return;
        }
        if (e?.error === 'audio-capture' || e?.error === 'network') {
          // Bluetooth device profile or network lag: exponential backoff to allow audio stack to settle
          errorRetryCountRef.current = Math.min(errorRetryCountRef.current + 1, 5);
          isErrorRestartRef.current = true;
          const delay = Math.min(2500, 600 * errorRetryCountRef.current);
          if (isCandidateTurnRef.current) {
            if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
            restartTimerRef.current = setTimeout(() => {
              isErrorRestartRef.current = false;
              if (isCandidateTurnRef.current) {
                createAndStartRecognition();
              }
            }, delay);
          }
        }
        // 'no-speech' or 'aborted' happens during natural pauses or filler word hesitations.
        // We do not terminate listening; onend will automatically reconnect with a fresh session.
      };

      recognition.onend = () => {
        // If an interim phrase was in-flight when candidate paused, commit it immediately
        if (interimTextRef.current && interimTextRef.current.trim()) {
          const remainingInterim = interimTextRef.current.trim();
          const next = accumulatedTextRef.current
            ? `${accumulatedTextRef.current} ${remainingInterim}`
            : remainingInterim;
          accumulatedTextRef.current = next;
          setAccumulatedText(next);
          onTranscriptLineRef.current?.({ text: remainingInterim, isFinal: true });
          interimTextRef.current = '';
          setInterimText('');
        }

        // Cleanly restart listener if candidate turn is still active
        if (isCandidateTurnRef.current) {
          // If an error backoff restart is already pending, do not clobber it with an immediate restart
          if (isErrorRestartRef.current) return;
          if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
          restartTimerRef.current = setTimeout(() => {
            if (isCandidateTurnRef.current) {
              createAndStartRecognition();
            }
          }, 100);
        } else {
          setIsListening(false);
        }
      };

      recognition.start();
      setIsListening(true);
      recognitionRef.current = recognition;
    } catch {
      // If immediate start throws, retry cleanly after a short pause
      if (isCandidateTurnRef.current) {
        if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
        restartTimerRef.current = setTimeout(() => {
          if (isCandidateTurnRef.current) {
            createAndStartRecognition();
          }
        }, 100);
      }
    }
  }, []);

  const restartRecognition = useCallback(() => {
    createAndStartRecognition();
  }, [createAndStartRecognition]);

  const startTurn = useCallback(() => {
    turnStartTimeRef.current = Date.now();
    speechStartRef.current = 0;
    speechMsAccumRef.current = 0;
    pausesCountRef.current = 0;
    lastFinalTimestampRef.current = Date.now();
    accumulatedTextRef.current = '';
    setAccumulatedText('');
    setInterimText('');

    createAndStartRecognition();
  }, [createAndStartRecognition]);

  const startListening = useCallback(() => {
    createAndStartRecognition();
  }, [createAndStartRecognition]);

  const completeTurn = useCallback(
    async (overrideText?: string, unauthorizedVoiceDetected = false) => {
      const now = Date.now();
      const responseLatencyMs =
        speechStartRef.current > 0
          ? Math.max(0, speechStartRef.current - turnStartTimeRef.current)
          : 0;

      const totalSpeechMs = speechMsAccumRef.current;
      const fullAnswerText =
        overrideText !== undefined && overrideText !== null && overrideText.trim()
          ? overrideText.trim()
          : accumulatedTextRef.current.trim();
      const totalWords = fullAnswerText ? fullAnswerText.split(/\s+/).filter(Boolean).length : 0;
      const { count: fillerCount } = countFillerWords(fullAnswerText);

      if (fullAnswerText) {
        await persistFullAnswer(fullAnswerText);
      }

      if (!interviewId) return;

      try {
        await fetch(`/api/interview/${interviewId}/turn-metrics`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            questionOrd: currentQuestionOrdRef.current,
            speechMs: totalSpeechMs,
            pauseMsTotal: Math.max(0, now - turnStartTimeRef.current - totalSpeechMs),
            pauseCount: pausesCountRef.current,
            wordCount: totalWords,
            fillerCount,
            responseLatencyMs,
            unauthorizedVoiceDetected,
            rawText: fullAnswerText,
          }),
        });
      } catch (err) {
        console.warn('[realtime-transcript] Turn metrics save error:', err);
      }
    },
    [interviewId, persistFullAnswer]
  );

  useEffect(() => {
    if (isCandidateTurn) {
      createAndStartRecognition();
    } else {
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      if (recognitionRef.current) {
        const prev = recognitionRef.current;
        recognitionRef.current = null;
        try {
          prev.onresult = null;
          prev.onerror = null;
          prev.onend = null;
          prev.abort();
        } catch {
          // ignore
        }
      }
      setIsListening(false);
    }
    return () => {
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      if (recognitionRef.current) {
        const prev = recognitionRef.current;
        recognitionRef.current = null;
        try {
          prev.onresult = null;
          prev.onerror = null;
          prev.onend = null;
          prev.abort();
        } catch {
          // ignore
        }
      }
    };
  }, [isCandidateTurn, createAndStartRecognition]);

  // Re-bind recognition session whenever a Bluetooth headset connects or disconnects
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.addEventListener) return;
    const handleDeviceChange = () => {
      if (isCandidateTurnRef.current) {
        if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
        restartTimerRef.current = setTimeout(() => {
          if (isCandidateTurnRef.current) {
            createAndStartRecognition();
          }
        }, 300);
      }
    };
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [createAndStartRecognition]);

  return {
    isSupported,
    isListening,
    interimText,
    accumulatedText,
    startTurn,
    startListening,
    completeTurn,
  };
}
