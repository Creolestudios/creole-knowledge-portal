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

  useEffect(() => {
    isAiSpeakingRef.current = isAiSpeaking;
  }, [isAiSpeaking]);

  useEffect(() => {
    isCandidateTurnRef.current = isCandidateTurn;
  }, [isCandidateTurn]);

  useEffect(() => {
    isCandidateMouthMovingRef.current = isCandidateMouthMoving ?? false;
  }, [isCandidateMouthMoving]);

  const triggerVoiceWarning = useCallback(
    async (reason: string, confidence: number) => {
      const now = Date.now();
      // Debounce voice warnings: max 1 per 6 seconds
      if (now - lastWarningTimeRef.current < 6000) return;
      lastWarningTimeRef.current = now;

      onUnauthorizedVoiceDetected({ reason, confidence });

      // Capture snapshot if available
      let snapshotPath: string | null = null;
      if (takeSnapshot) {
        try {
          snapshotPath = await takeSnapshot();
        } catch (e) {
          console.warn('[voice-guard] Snapshot capture error:', e);
        }
      }

      // Log to /api/interview/events for proctoring audit
      try {
        await fetch('/api/interview/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            interviewId,
            category: 'unauthorized_voice',
            severity: 'warning',
            confidence,
            snapshotPath,
            meta: {
              reason,
              timestamp: now,
            },
          }),
        });
      } catch (err) {
        console.warn('[voice-guard] Event logging error:', err);
      }
    },
    [interviewId, onUnauthorizedVoiceDetected, takeSnapshot]
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
      analyser.smoothingTimeConstant = 0.8;

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
        // 1. If AI system prompt is speaking, suppress everything
        if (isAiSpeakingRef.current) {
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
          // Synthetic / TTS voices exhibit unnaturally flat spectral flux (< 2.0) while speech energy is active (> 35)
          const isAiVoice = avgSpeechEnergy > 35 && avgFlux < 2.0 && frameCount > 25;
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

          // 3. Background Voice Detection:
          // Only show warning if the background voice is HIGHER than the actual speaker.
          // Lower background voices (whispers, ambient murmur, quiet background chatter) are ignored.
          const isBackgroundVoiceWhileSilent =
            !isCandidateMouthMovingRef.current &&
            avgSpeechEnergy > actualSpeakerLevel &&
            peakEnergy > actualSpeakerLevel * 1.15 &&
            avgFlux > 1.2;

          // Dual speaker: Overlapping voice only triggers if secondary voice is higher than speaker
          const isDualSpeakerLouder =
            isCandidateMouthMovingRef.current &&
            Math.abs(peakBin - secondaryPeakBin) >= 2 &&
            secondaryPeakEnergy > actualSpeakerLevel * 1.1 &&
            secondaryPeakEnergy >= peakEnergy * 0.9 &&
            avgFlux > 1.2;

          const isBgVoiceHigherThanSpeaker = !isAiVoice && (isBackgroundVoiceWhileSilent || isDualSpeakerLouder);

          if (isBgVoiceHigherThanSpeaker) {
            consecutiveSuspiciousFrames++;
            // If sustained for >= 12 frames (~200ms of active louder speech)
            if (consecutiveSuspiciousFrames >= 12) {
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
