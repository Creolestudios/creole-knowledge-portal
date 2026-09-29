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
  const ambientNoiseFloorRef = useRef<number>(30);
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
      let consecutiveMusicFrames = 0;
      let prevHighBandEnergy = 0;
      let lastKeystrokeFrame = 0;
      let lastKeystrokeTime = 0;
      const recentTypingTimestamps: number[] = [];
      let frameCount = 0;

      const checkAudio = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);
        frameCount++;
        const nowMs = Date.now();

        // Speech band (bins 3 to 36, ~300Hz - 3400Hz)
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

          prevDataArray[i] = val;
        }

        const avgSpeechEnergy = speechEnergySum / (endBin - startBin);
        const avgFlux = spectralFlux / (endBin - startBin);

        // Music frequency band (bins 5 to 65, ~470Hz - 6100Hz)
        let musicEnergySum = 0;
        let musicPeakEnergy = 0;
        const musicStartBin = 5;
        const musicEndBin = Math.min(65, bufferLength);
        for (let i = musicStartBin; i < musicEndBin; i++) {
          const val = dataArray[i];
          musicEnergySum += val;
          if (val > musicPeakEnergy) musicPeakEnergy = val;
        }
        const avgMusicEnergy = musicEnergySum / (musicEndBin - musicStartBin);
        const musicTonality = musicPeakEnergy / (avgMusicEnergy + 0.001);

        // Low/mid harmonic body band (bins 3 to 22, ~260Hz - 1900Hz)
        // Keystroke clicks have virtually NO energy here, while loud music, beats, bass, chords, and speech do.
        let lowMidEnergySum = 0;
        const lowMidStartBin = 3;
        const lowMidEndBin = Math.min(23, bufferLength);
        for (let i = lowMidStartBin; i < lowMidEndBin; i++) {
          lowMidEnergySum += dataArray[i];
        }
        const avgLowMidEnergy = lowMidEnergySum / (lowMidEndBin - lowMidStartBin);

        // Typing / Transient click frequency band (bins 25 to 110, ~2.3kHz - 10.3kHz)
        let highBandEnergySum = 0;
        let highBandPeakEnergy = 0;
        const highStartBin = 25;
        const highEndBin = Math.min(110, bufferLength);
        for (let i = highStartBin; i < highEndBin; i++) {
          const val = dataArray[i];
          highBandEnergySum += val;
          if (val > highBandPeakEnergy) highBandPeakEnergy = val;
        }
        const highBandEnergy = highBandEnergySum / (highEndBin - highStartBin);

        // State check:
        // 1. If AI system prompt is speaking OR during the cooldown window after a warning,
        // suppress frame accumulation
        if (isAiSpeakingRef.current || (lastWarningTimeRef.current > 0 && nowMs - lastWarningTimeRef.current < 25000)) {
          consecutiveSuspiciousFrames = 0;
          consecutiveAiFrames = 0;
          consecutiveMusicFrames = 0;
          recentTypingTimestamps.length = 0;
          lastKeystrokeTime = 0;
        } else if (isCandidateTurnRef.current) {
          // Track candidate's own speech level when mouth is moving
          if (isCandidateMouthMovingRef.current && avgSpeechEnergy > 20) {
            actualSpeakerEnergyRef.current = actualSpeakerEnergyRef.current * 0.92 + avgSpeechEnergy * 0.08;
            if (actualSpeakerEnergyRef.current < 35) {
              actualSpeakerEnergyRef.current = 35;
            }
          }

          const actualSpeakerLevel = actualSpeakerEnergyRef.current;
          const isSilent = !isCandidateMouthMovingRef.current;

          if (isSilent) {
            // Adapt ambient room noise floor during silence when below normal speech levels
            if (avgSpeechEnergy < 60) {
              ambientNoiseFloorRef.current = ambientNoiseFloorRef.current * 0.96 + avgSpeechEnergy * 0.04;
              if (ambientNoiseFloorRef.current < 25) ambientNoiseFloorRef.current = 25;
              if (ambientNoiseFloorRef.current > 55) ambientNoiseFloorRef.current = 55;
            }
          }

          // Reading grace period for ambient background sounds
          const isReadingGracePeriod =
            candidateTurnStartedAtRef.current > 0 &&
            nowMs - candidateTurnStartedAtRef.current < readingGracePeriodMsRef.current;

          // ── MUSIC DETECTION ────────────────────────────────────────────────
          // High harmonic tonality (tonality ratio >= 2.8) and sustained energy
          const isMusic = avgMusicEnergy >= 38 && musicTonality >= 2.8 && !isReadingGracePeriod;
          if (isMusic) {
            consecutiveMusicFrames++;
            if (consecutiveMusicFrames >= 30) {
              consecutiveMusicFrames = 0;
              const confidence = Math.min(0.92, 0.75 + (avgMusicEnergy / 255) * 0.2);
              triggerVoiceWarning('Background music detected.', confidence);
            }
          } else {
            consecutiveMusicFrames = Math.max(0, consecutiveMusicFrames - 1);
          }

          // ── LOUD MUSIC & BACKGROUND PLAYBACK DISCRIMINATION ───────────────
          // Suppress typing detection during loud music playback (EDM, drums, chords, songs).
          // Loud music exhibits sustained harmonic tonality (>= 2.5) with music energy (>= 36),
          // active music frames, or high continuous broadband sound pressure across low-mids (>= 40)
          // and speech bands (>= 45).
          const isCandidateSpeaking = isCandidateMouthMovingRef.current && avgSpeechEnergy >= 40;
          const isLoudMusicPlaying =
            isMusic ||
            consecutiveMusicFrames >= 3 ||
            (avgMusicEnergy >= 36 && musicTonality >= 2.5) ||
            (avgLowMidEnergy >= 40 && avgSpeechEnergy >= 45);

          // ── TYPING SOUND DETECTION ─────────────────────────────────────────
          // Sharp transient attack in high frequency band with audible click peak (>= 52).
          // Sensitive to laptop keyboards, membrane switches, and external keypads.
          // Ignored during active loud music playback and candidate speech sibilants.
          const isAudibleClick = highBandPeakEnergy >= 52 && highBandEnergy >= 22 && !isLoudMusicPlaying;
          const typingTransientAttack =
            isAudibleClick &&
            highBandEnergy - prevHighBandEnergy >= 8 &&
            (!isCandidateSpeaking || highBandPeakEnergy >= 75) &&
            frameCount - lastKeystrokeFrame >= 3;

          if (isLoudMusicPlaying && consecutiveMusicFrames >= 10) {
            // Only flush typing timestamps during sustained loud music
            recentTypingTimestamps.length = 0;
          } else if (typingTransientAttack) {
            lastKeystrokeFrame = frameCount;
            recentTypingTimestamps.push(nowMs);
            // Retain keystrokes within a 2.5-second rolling window
            while (recentTypingTimestamps.length > 0 && nowMs - recentTypingTimestamps[0] > 2500) {
              recentTypingTimestamps.shift();
            }
            if (recentTypingTimestamps.length >= 3) {
              recentTypingTimestamps.length = 0;
              const confidence = Math.min(0.92, 0.78 + (highBandEnergy / 255) * 0.15);
              triggerVoiceWarning('Keyboard typing sounds detected.', confidence);
            }
          }
          prevHighBandEnergy = highBandEnergy;

          // ── AI / SYNTHETIC VOICE DETECTION ─────────────────────────────────
          // Synthetic / TTS voices exhibit unnaturally flat spectral flux (< 1.8) while speech energy is clearly active (avg >= 65, peak >= 75).
          // Steady ambient background drone, laptop fans, or mic hiss (< 60) are strictly filtered out.
          const isAiVoice = avgSpeechEnergy >= 65 && peakEnergy >= 75 && avgFlux < 1.8 && frameCount > 15;
          if (isAiVoice) {
            consecutiveAiFrames++;
            if (consecutiveAiFrames >= 25) {
              consecutiveAiFrames = 0;
              const confidence = Math.min(0.95, 0.75 + (avgSpeechEnergy / 255) * 0.2);
              triggerVoiceWarning('AI voice detected during interview. Only natural candidate voice is allowed.', confidence);
            }
          } else {
            consecutiveAiFrames = Math.max(0, consecutiveAiFrames - 2);
          }

          // ── HUMAN SPEECH & DUAL-SPEAKER DETECTION ──────────────────────────
          // Mild environmental noise, fans, keyboard clicks, breathing, and low background sounds (< 65) are strictly IGNORED.
          // Real human voice concentrates energy into harmonic formants (peak-to-average formant ratio >= 1.12).
          const formantRatio = peakEnergy / (avgSpeechEnergy + 0.001);
          const isClearSpeech = avgSpeechEnergy >= 68 && peakEnergy >= 80 && formantRatio >= 1.12;

          // Must be clearly above the room's ambient noise floor (at least 14 units higher)
          const isAboveNoiseFloor = avgSpeechEnergy >= ambientNoiseFloorRef.current + 14;

          // (2) Candidate is NOT speaking (mouth not moving), but clear human speech is active in background
          const isBackgroundVoiceWhileSilent =
            !isReadingGracePeriod &&
            isSilent &&
            isClearSpeech &&
            isAboveNoiseFloor &&
            avgFlux >= 2.2;

          // (1) Candidate IS speaking (mouth moving), but another loud voice is present (dual speaker)
          // Must have distinct non-formant frequency separation (>= 5 bins) and strong energy exceeding candidate level
          const isDualSpeakerPresent =
            !isSilent &&
            Math.abs(peakBin - secondaryPeakBin) >= 5 &&
            secondaryPeakEnergy >= 75 &&
            secondaryPeakEnergy > actualSpeakerLevel * 1.05 &&
            avgFlux >= 2.5;

          const isBgVoiceDetected = !isAiVoice && !isMusic && (isBackgroundVoiceWhileSilent || isDualSpeakerPresent);

          if (isBgVoiceDetected) {
            consecutiveSuspiciousFrames++;
            // Require sustained speech (~0.9-1.0s at 60fps) before triggering alert to avoid transient sounds
            if (consecutiveSuspiciousFrames >= 55) {
              consecutiveSuspiciousFrames = 0;
              const confidence = Math.min(0.95, 0.78 + (avgSpeechEnergy / 255) * 0.2);
              let reason: string;
              if (isDualSpeakerPresent) {
                reason = secondaryPeakEnergy > actualSpeakerLevel * 1.2
                  ? 'Background voice louder than speaker detected.'
                  : 'Secondary voice detected while speaking.';
              } else {
                reason = avgSpeechEnergy > actualSpeakerLevel * 1.1
                  ? 'Background voice louder than candidate detected.'
                  : 'Background voice detected while candidate was silent.';
              }
              triggerVoiceWarning(reason, confidence);
            }
          } else {
            // Rapid decay: decrease by 6 frames so intermittent noise or pauses don't slowly accumulate
            consecutiveSuspiciousFrames = Math.max(0, consecutiveSuspiciousFrames - 6);
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
