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
    // Eagerly detect speech API support so we never call setState synchronously
    // inside the effect body (react-hooks/set-state-in-effect).
    () =>
      typeof window === 'undefined'
        ? true // SSR: assume supported, effect will correct if needed
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
  // Accumulates the full answer text across all final phrases; flushed in completeTurn as a
  // single DB row instead of one row per phrase.
  const accumulatedTextRef = useRef('');

  useEffect(() => {
    isCandidateTurnRef.current = isCandidateTurn;
  }, [isCandidateTurn]);

  useEffect(() => {
    currentQuestionOrdRef.current = currentQuestionOrd;
  }, [currentQuestionOrd]);

  // Persists the full consolidated answer for a question turn as a single DB row.
  // Called only once per question (inside completeTurn) to avoid fragmented storage.
  const persistFullAnswer = useCallback(
    async (text: string) => {
      if (!interviewId || !text || !text.trim()) return;
      try {
        await fetch(`/api/interview/${interviewId}/transcript`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            questionOrd: currentQuestionOrdRef.current,
            speaker: 'candidate',
            text: text.trim(),
            tsMs: Date.now(),
          }),
        });
      } catch (err) {
        console.warn('[realtime-transcript] Failed to persist answer:', err);
      }
    },
    [interviewId]
  );

  // Safely restarts the speech recognition engine with a clean audio session
  const restartRecognition = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    try {
      rec.abort();
    } catch {
      // ignore
    }
    window.setTimeout(() => {
      if (isCandidateTurnRef.current && recognitionRef.current) {
        try {
          recognitionRef.current.start();
          setIsListening(true);
        } catch {
          // already started or transitioning
        }
      }
    }, 70);
  }, []);

  // Starts real-time listening for a question turn
  const startTurn = useCallback(() => {
    turnStartTimeRef.current = Date.now();
    speechStartRef.current = 0;
    speechMsAccumRef.current = 0;
    pausesCountRef.current = 0;
    lastFinalTimestampRef.current = Date.now();
    accumulatedTextRef.current = '';
    setAccumulatedText('');
    setInterimText('');

    restartRecognition();
  }, [restartRecognition]);

  // Explicit manual trigger for the candidate to start speaking if recognition stopped
  const startListening = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    try {
      rec.start();
      setIsListening(true);
    } catch {
      // If already active or in another state, cycle it cleanly
      restartRecognition();
    }
  }, [restartRecognition]);

  // Completes a turn: flushes the full accumulated answer as ONE transcript row and saves turn metrics.
  const completeTurn = useCallback(
    async (unauthorizedVoiceDetected = false) => {
      const now = Date.now();
      const responseLatencyMs = speechStartRef.current > 0
        ? Math.max(0, speechStartRef.current - turnStartTimeRef.current)
        : 0;

      const totalSpeechMs = speechMsAccumRef.current;
      // Use the ref so we always get the latest value even if called right after state update.
      const fullAnswerText = accumulatedTextRef.current;
      const totalWords = fullAnswerText.split(/\s+/).filter(Boolean).length;
      const { count: fillerCount } = countFillerWords(fullAnswerText);

      // Persist the whole answer as a single consolidated DB row.
      await persistFullAnswer(fullAnswerText);

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

  const onTranscriptLineRef = useRef(onTranscriptLine);
  useEffect(() => {
    onTranscriptLineRef.current = onTranscriptLine;
  }, [onTranscriptLine]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      // Defer to avoid calling setState synchronously inside an effect body.
      window.setTimeout(() => setIsSupported(false), 0);
      return;
    }

    const recognition = new SpeechRec();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    const browserLang = typeof navigator !== 'undefined' ? navigator.language : 'en-US';
    recognition.lang = browserLang && browserLang.startsWith('en') ? browserLang : 'en-US';

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      if (!isCandidateTurnRef.current) return;

      const now = Date.now();
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
            // Accumulate locally — do NOT write to DB here; the full answer is
            // flushed as a single row in completeTurn when the question ends.
            const next = accumulatedTextRef.current
              ? `${accumulatedTextRef.current} ${trimmed}`
              : trimmed;
            accumulatedTextRef.current = next;
            setAccumulatedText(next);
            onTranscriptLineRef.current?.({ text: trimmed, isFinal: true });

            // Check if there was a pause since the last final chunk (>800ms)
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

      setInterimText(currentInterim);
      if (currentInterim) {
        onTranscriptLineRef.current?.({ text: currentInterim, isFinal: false });
      }
    };

    recognition.onerror = (e: any) => {
      if (e?.error === 'not-allowed') {
        setIsListening(false);
      }
    };

    recognition.onend = () => {
      // If candidate turn is still active, restart listener cleanly after a short pause
      if (isCandidateTurnRef.current) {
        window.setTimeout(() => {
          if (isCandidateTurnRef.current && recognitionRef.current) {
            try {
              recognitionRef.current.start();
              setIsListening(true);
            } catch {
              // ignore
            }
          }
        }, 150);
      } else {
        setIsListening(false);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      try {
        recognition.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (isCandidateTurn) {
      const timer = window.setTimeout(() => {
        startListening();
      }, 0);
      return () => window.clearTimeout(timer);
    } else {
      try {
        recognitionRef.current?.stop();
      } catch {
        // ignore
      }
      const timer = window.setTimeout(() => {
        setIsListening(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [isCandidateTurn, startListening]);

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
