'use client';

import { useEffect, useRef, useCallback } from 'react';

export interface VoiceGuardOptions {
  interviewId: string;
  stream: MediaStream | null;
  isAiSpeaking: boolean;
  isCandidateTurn: boolean;
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
  onUnauthorizedVoiceDetected,
  takeSnapshot,
}: VoiceGuardOptions) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const lastWarningTimeRef = useRef<number>(0);
  const isAiSpeakingRef = useRef<boolean>(isAiSpeaking);
  const isCandidateTurnRef = useRef<boolean>(isCandidateTurn);

  useEffect(() => {
    isAiSpeakingRef.current = isAiSpeaking;
  }, [isAiSpeaking]);

  useEffect(() => {
    isCandidateTurnRef.current = isCandidateTurn;
  }, [isCandidateTurn]);

  const triggerVoiceWarning = useCallback(
    async (reason: string, confidence: number) => {
      const now = Date.now();
      // Debounce voice warnings: max 1 per 7 seconds
      if (now - lastWarningTimeRef.current < 7000) return;
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
          // 2. AI / Synthetic voice detection:
          // Synthetic / TTS voices exhibit unnaturally flat spectral flux (< 2.8) while speech energy is active (> 50)
          if (avgSpeechEnergy > 50 && avgFlux < 2.8 && frameCount > 30) {
            consecutiveAiFrames++;
            if (consecutiveAiFrames > 35) { // ~1 second of sustained robotic/synthetic voice
              consecutiveAiFrames = 0;
              const confidence = Math.min(0.95, 0.75 + (avgSpeechEnergy / 255) * 0.2);
              triggerVoiceWarning('AI or synthetic voice detected. Only natural candidate voice is allowed.', confidence);
            }
          } else {
            consecutiveAiFrames = Math.max(0, consecutiveAiFrames - 1);
          }

          // 3. Secondary human voice detection:
          // Multiple non-harmonic energy peaks (two distinct voices talking simultaneously)
          const isDualSpeaker =
            secondaryPeakEnergy > 60 &&
            peakEnergy > 75 &&
            Math.abs(peakBin - secondaryPeakBin) > 3 &&
            peakBin % secondaryPeakBin !== 0 &&
            secondaryPeakBin % peakBin !== 0;

          if (isDualSpeaker || avgSpeechEnergy > 68) {
            consecutiveSuspiciousFrames++;
            // If sustained for ~1.2 seconds (~36 frames)
            if (consecutiveSuspiciousFrames > 36) {
              consecutiveSuspiciousFrames = 0;
              const confidence = Math.min(0.95, 0.72 + (avgSpeechEnergy / 255) * 0.23);
              const reason = isDualSpeaker
                ? 'Multiple distinct voices detected in room.'
                : 'Unauthorized background or secondary voice detected.';
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
