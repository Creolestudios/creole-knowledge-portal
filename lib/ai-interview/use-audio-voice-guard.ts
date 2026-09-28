'use client';

import { useEffect, useRef, useCallback } from 'react';

export interface VoiceGuardOptions {
  interviewId: string;
  stream: MediaStream | null;
  isAiSpeaking: boolean;
  isCandidateTurn: boolean;
  isCandidateMouthMoving?: boolean;
  onUnauthorizedVoiceDetected: (info: { reason: string; confidence: number }) => void;
  takeSnapshot?: () => Promise<string | null>;
  readingGracePeriodMs?: number;
}

/**
 * Monitors mic audio levels and discriminates between:
 * 1. System AI Speech (suppresses false voice alarms while AI speaks)
 * 2. Candidate's own speech
 * 3. Unauthorized Secondary Human / External AI Voice
 *
 * If unauthorized speech is detected during the candidate turn, emits a warning event.
 */
export function useAudioVoiceGuard({
  interviewId,
  stream,
  isAiSpeaking,
  isCandidateTurn,
  isCandidateMouthMoving,
  onUnauthorizedVoiceDetected,
  takeSnapshot,
  readingGracePeriodMs = 0,
}: VoiceGuardOptions) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const lastWarningTimeRef = useRef<number>(0);
  const actualSpeakerEnergyRef = useRef<number>(45);
  const isAiSpeakingRef = useRef<boolean>(isAiSpeaking);
  const isCandidateTurnRef = useRef<boolean>(isCandidateTurn);
  const isCandidateMouthMovingRef = useRef<boolean>(isCandidateMouthMoving ?? false);
  const candidateTurnStartedAtRef = useRef<number>(0);
  const readingGracePeriodMsRef = useRef<number>(readingGracePeriodMs);

  useEffect(() => {
    isAiSpeakingRef.current = isAiSpeaking;
  }, [isAiSpeaking]);

  useEffect(() => {
    if (isCandidateTurn && candidateTurnStartedAtRef.current === 0) {
      candidateTurnStartedAtRef.current = Date.now();
    } else if (!isCandidateTurn) {
      candidateTurnStartedAtRef.current = 0;
    }
    isCandidateTurnRef.current = isCandidateTurn;
  }, [isCandidateTurn]);

  useEffect(() => {
    readingGracePeriodMsRef.current = readingGracePeriodMs;
  }, [readingGracePeriodMs]);

  useEffect(() => {
    isCandidateMouthMovingRef.current = isCandidateMouthMoving ?? false;
  }, [isCandidateMouthMoving]);

  const onUnauthorizedVoiceDetectedRef = useRef(onUnauthorizedVoiceDetected);
  const takeSnapshotRef = useRef(takeSnapshot);

  useEffect(() => {
    onUnauthorizedVoiceDetectedRef.current = onUnauthorizedVoiceDetected;
    takeSnapshotRef.current = takeSnapshot;
  });

  const triggerVoiceWarning = useCallback(
    async (reason: string, confidence: number) => {
      const now = Date.now();
      // Debounce voice warnings: enforce a 35-second cooldown between consecutive
      // voice detection alerts (30-40 second break as required).
      if (now - lastWarningTimeRef.current < 35000) return;
      lastWarningTimeRef.current = now;

      onUnauthorizedVoiceDetectedRef.current({ reason, confidence });

      // Capture snapshot if available
      if (takeSnapshotRef.current) {
        try {
          await takeSnapshotRef.current();
        } catch (e) {
          console.warn('[voice-guard] Snapshot capture error:', e);
        }
      }
      // Note: We deliberately do NOT fetch /api/interview/events here because
      // onUnauthorizedVoiceDetected delegate handles proctor strikes & event logging in page.tsx.
      // This prevents storing duplicate rows for the same alert.
    },
    []
  );

  useEffect(() => {
    if (!stream || !stream.getAudioTracks().length) return;

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const resumeAudio = () => {
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
      };
      window.addEventListener('click', resumeAudio, { once: true });

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      // Lower smoothing so brief noise spikes decay quickly and don't accumulate
      analyser.smoothingTimeConstant = 0.6;

      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);

      audioContextRef.current = ctx;
      analyserRef.current = analyser;
      sourceRef.current = source;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      const prevDataArray = new Uint8Array(bufferLength);

      let consecutiveSuspiciousFrames = 0;
      let consecutiveAiFrames = 0;
      let frameCount = 0;

      const checkAudio = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        frameCount++;

        // Calculate average energy in speech frequency band (approx 300Hz - 3400Hz)
        // With fftSize 512 at 48kHz, each bin is ~93.75Hz. Speech is bins 3 to 36.
        let speechEnergySum = 0;
        let peakEnergy = 0;
        let peakBin = 0;
        let secondaryPeakEnergy = 0;
        let secondaryPeakBin = 0;

        const startBin = 3;
        const endBin = Math.min(36, bufferLength);
        let spectralFlux = 0;

        for (let i = startBin; i < endBin; i++) {
          const val = dataArray[i];
          speechEnergySum += val;

          // Spectral flux calculation (frame-to-frame variation)
          spectralFlux += Math.abs(val - prevDataArray[i]);

          // Peak tracking
          if (val > peakEnergy) {
            secondaryPeakEnergy = peakEnergy;
            secondaryPeakBin = peakBin;
            peakEnergy = val;
            peakBin = i;
          } else if (val > secondaryPeakEnergy) {
            secondaryPeakEnergy = val;
            secondaryPeakBin = i;
          }

          // Cache for next frame
          prevDataArray[i] = val;
        }

        const avgSpeechEnergy = speechEnergySum / (endBin - startBin);
        const avgFlux = spectralFlux / (endBin - startBin);

        // State check:
        // 1. If AI system prompt is speaking OR during the 35-second cooldown window after a voice warning,
        // suppress and freeze frame accumulation so warnings have genuine spacing
        if (isAiSpeakingRef.current || (lastWarningTimeRef.current > 0 && Date.now() - lastWarningTimeRef.current < 35000)) {
          consecutiveSuspiciousFrames = 0;
          consecutiveAiFrames = 0;
        } else if (isCandidateTurnRef.current) {
          // Track actual candidate speech level when candidate mouth is moving and speaking
          if (isCandidateMouthMovingRef.current && avgSpeechEnergy > 20) {
            actualSpeakerEnergyRef.current = actualSpeakerEnergyRef.current * 0.92 + avgSpeechEnergy * 0.08;
            if (actualSpeakerEnergyRef.current < 35) {
              actualSpeakerEnergyRef.current = 35;
            }
          }

          const actualSpeakerLevel = actualSpeakerEnergyRef.current;

          // 2. AI / Synthetic voice detection during interview:
          // Synthetic / TTS voices exhibit unnaturally flat spectral flux (< 2.0) while speech energy is active (> 50)
          // Raised from 35 → 50 to avoid false triggers from quiet background sounds
          const isAiVoice = avgSpeechEnergy > 50 && avgFlux < 2.0 && frameCount > 25;
          if (isAiVoice) {
            consecutiveAiFrames++;
            if (consecutiveAiFrames > 25) {
              consecutiveAiFrames = 0;
              const confidence = Math.min(0.95, 0.75 + (avgSpeechEnergy / 255) * 0.2);
              triggerVoiceWarning('AI voice detected during interview. Only natural candidate voice is allowed.', confidence);
            }
          } else {
            consecutiveAiFrames = Math.max(0, consecutiveAiFrames - 1);
          }

          // Reading grace period: allow candidate initial peaceful time to read questions without background voice warnings
          const isReadingGracePeriod =
            candidateTurnStartedAtRef.current > 0 &&
            Date.now() - candidateTurnStartedAtRef.current < readingGracePeriodMsRef.current;

          // Only show warning if the background voice is clearly LOUDER than the candidate.
          // Thresholds raised to avoid triggering on room noise, fans, distant TV, or quiet ambient speech.
          const isBackgroundVoiceWhileSilent =
            !isReadingGracePeriod &&
            !isCandidateMouthMovingRef.current &&
            avgSpeechEnergy > Math.max(65, actualSpeakerLevel) &&
            peakEnergy > Math.max(78, actualSpeakerLevel * 1.25) &&
            avgFlux > 2.0;

          // Dual speaker: Overlapping voice only triggers if secondary voice is significantly louder than speaker
          // Raised coefficient 1.1 → 1.25 to ignore nearby quiet talking or background murmur
          const isDualSpeakerLouder =
            isCandidateMouthMovingRef.current &&
            Math.abs(peakBin - secondaryPeakBin) >= 3 &&
            secondaryPeakEnergy > actualSpeakerLevel * 1.25 &&
            secondaryPeakEnergy >= peakEnergy * 0.9 &&
            avgFlux > 2.0;

          const isBgVoiceHigherThanSpeaker = !isAiVoice && (isBackgroundVoiceWhileSilent || isDualSpeakerLouder);

          if (isBgVoiceHigherThanSpeaker) {
            consecutiveSuspiciousFrames++;
            // If sustained for >= 30 frames (~500ms of clearly louder speech before triggering)
            // Raised from 20 → 30 to avoid false positives from brief noise spikes
            if (consecutiveSuspiciousFrames >= 30) {
              consecutiveSuspiciousFrames = 0;
              const confidence = Math.min(0.95, 0.75 + (avgSpeechEnergy / 255) * 0.2);
              const reason = isDualSpeakerLouder
                ? 'Background voice louder than speaker detected.'
                : 'Background voice louder than candidate detected.';
              triggerVoiceWarning(reason, confidence);
            }
          } else {
            consecutiveSuspiciousFrames = Math.max(0, consecutiveSuspiciousFrames - 1);
          }
        }

        animFrameRef.current = requestAnimationFrame(checkAudio);
      };

      animFrameRef.current = requestAnimationFrame(checkAudio);
    } catch (err) {
      console.warn('[voice-guard] Web Audio initialization failed:', err);
    }

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (sourceRef.current) sourceRef.current.disconnect();
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [stream, triggerVoiceWarning]);

  return {
    isAiSpeakingRef,
  };
}
