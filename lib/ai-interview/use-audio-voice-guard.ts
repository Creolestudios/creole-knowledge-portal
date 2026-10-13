'use client';

import { useEffect, useRef, useCallback } from 'react';

export interface VoiceGuardOptions {
  interviewId: string;
  stream: MediaStream | null;
  isAiSpeaking: boolean;
  isCandidateTurn: boolean;
  isCandidateMouthMoving?: boolean;
  onUnauthorizedVoiceDetected: (info: { reason: string; confidence: number; durationMs?: number }) => void;
  takeSnapshot?: () => Promise<string | null>;
  readingGracePeriodMs?: number;
  continuousVoiceMs?: number;
  cooldownMs?: number;
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
  continuousVoiceMs = 8000,
  cooldownMs = 10000,
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
  const continuousVoiceMsRef = useRef<number>(continuousVoiceMs);
  const cooldownMsRef = useRef<number>(cooldownMs);

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
    continuousVoiceMsRef.current = continuousVoiceMs;
  }, [continuousVoiceMs]);

  useEffect(() => {
    cooldownMsRef.current = cooldownMs;
  }, [cooldownMs]);

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
    async (reason: string, confidence: number, durationMs?: number) => {
      const now = Date.now();
      // Debounce voice warnings: enforce a 10-second cooldown between consecutive
      // voice detection alerts (10-second break as required).
      const cooldown = cooldownMsRef.current ?? 10000;
      if (now - lastWarningTimeRef.current < cooldown) return;
      lastWarningTimeRef.current = now;

      const finalReason = reason.trim();
      onUnauthorizedVoiceDetectedRef.current({ reason: finalReason, confidence, durationMs });

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
      if (!AudioCtx) {
        console.warn('[voice-guard] AudioContext not supported in this environment (likely JSDOM). Skipping voice guard.');
        return;
      }
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
      let voiceDetectedStartAt = 0;
      let consecutiveAiFrames = 0;
      let consecutiveMusicFrames = 0;
      let prevHighBandEnergy = 0;
      let prevHighBandPeakEnergy = 0;
      let lastKeystrokeFrame = 0;
      let lastPenClickFrame = 0;
      let lastVoiceFrameTime = 0;
      const recentTypingTimestamps: number[] = [];
      const recentPenClickTimestamps: number[] = [];
      let consecutivePenWritingFrames = 0;
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
        // 1. If AI system prompt is speaking OR during the 10-second cooldown window after a warning,
        // suppress frame accumulation
        const cooldown = cooldownMsRef.current ?? 10000;
        if (isAiSpeakingRef.current || (lastWarningTimeRef.current > 0 && nowMs - lastWarningTimeRef.current < cooldown)) {
          consecutiveSuspiciousFrames = 0;
          voiceDetectedStartAt = 0;
          consecutiveAiFrames = 0;
          consecutiveMusicFrames = 0;
          recentTypingTimestamps.length = 0;
          recentPenClickTimestamps.length = 0;
          consecutivePenWritingFrames = 0;
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
            readingGracePeriodMsRef.current > 0 &&
            candidateTurnStartedAtRef.current > 0 &&
            nowMs >= candidateTurnStartedAtRef.current &&
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
          // Check if transient energy extends down into keyboard mechanical body / click band (bins 25 to 34)
          let typingBandEnergySum = 0;
          for (let i = 25; i < 35 && i < bufferLength; i++) {
            typingBandEnergySum += dataArray[i];
          }
          const isTypingBandActive = typingBandEnergySum / 10 >= 22;

          const isAudibleClick = highBandPeakEnergy >= 36 && highBandEnergy >= 6 && !isLoudMusicPlaying;
          const typingTransientAttack =
            isAudibleClick &&
            isTypingBandActive &&
            (highBandPeakEnergy - prevHighBandPeakEnergy >= 10 || highBandEnergy - prevHighBandEnergy >= 4) &&
            (!isCandidateSpeaking || highBandPeakEnergy >= 60) &&
            frameCount - lastKeystrokeFrame >= 2;

          if (isLoudMusicPlaying && consecutiveMusicFrames >= 10) {
            recentTypingTimestamps.length = 0;
            recentPenClickTimestamps.length = 0;
            consecutivePenWritingFrames = 0;
          } else if (typingTransientAttack) {
            lastKeystrokeFrame = frameCount;
            recentTypingTimestamps.push(nowMs);
            while (recentTypingTimestamps.length > 0 && nowMs - recentTypingTimestamps[0] > 2500) {
              recentTypingTimestamps.shift();
            }
            if (recentTypingTimestamps.length >= 3) {
              recentTypingTimestamps.length = 0;
              recentPenClickTimestamps.length = 0;
              const confidence = Math.min(0.92, 0.78 + (highBandEnergy / 255) * 0.15);
              triggerVoiceWarning('Keyboard typing sounds detected.', confidence);
            }
          }

          // ── PEN CLICKING & WRITING SOUND DETECTION ─────────────────────────
          // 1. Pen Clicking: Ultra-high frequency click impulse (> 36) in upper spectrum (bins 35+) with minimal low-mid body (< 24)
          // Operates independently so distinct click-clack pulses are caught immediately
          const isPenClickImpulse =
            !isLoudMusicPlaying &&
            !isCandidateSpeaking &&
            !isTypingBandActive &&
            highBandPeakEnergy >= 36 &&
            avgLowMidEnergy < 24 &&
            (highBandPeakEnergy - prevHighBandPeakEnergy >= 10 || highBandEnergy - prevHighBandEnergy >= 4) &&
            frameCount - lastPenClickFrame >= 2;

          if (isPenClickImpulse) {
            lastPenClickFrame = frameCount;
            recentPenClickTimestamps.push(nowMs);
            while (recentPenClickTimestamps.length > 0 && nowMs - recentPenClickTimestamps[0] > 2500) {
              recentPenClickTimestamps.shift();
            }
            if (recentPenClickTimestamps.length >= 2) {
              recentPenClickTimestamps.length = 0;
              recentTypingTimestamps.length = 0;
              triggerVoiceWarning('Pen clicking / writing sounds detected.', 0.88);
            }
          }

          // 2. Pen Writing / Scribbling: Continuous paper friction scratch in high band without speech or ambient drone
          const isPenWritingScratch =
            !isLoudMusicPlaying &&
            isSilent &&
            highBandPeakEnergy >= 32 &&
            highBandEnergy >= 6 &&
            avgSpeechEnergy < 32 &&
            avgLowMidEnergy < 24 &&
            avgFlux >= 1.4;

          if (isPenWritingScratch) {
            consecutivePenWritingFrames++;
            if (consecutivePenWritingFrames >= 15) {
              consecutivePenWritingFrames = 0;
              triggerVoiceWarning('Pen clicking / writing sounds detected.', 0.85);
            }
          } else {
            consecutivePenWritingFrames = Math.max(0, consecutivePenWritingFrames - 1);
          }

          prevHighBandEnergy = highBandEnergy;
          prevHighBandPeakEnergy = highBandPeakEnergy;

          // ── AI / SYNTHETIC VOICE DETECTION ─────────────────────────────────
          // Synthetic / TTS voices exhibit unnaturally flat spectral flux (< 1.8) while speech energy is clearly active (avg >= 65, peak >= 75).
          // Steady ambient background drone, laptop fans, or mic hiss (< 60) are strictly filtered out.
          const isAiVoice = avgSpeechEnergy >= 65 && peakEnergy >= 75 && avgFlux < 1.8 && frameCount > 15;

          // ── HUMAN SPEECH & DUAL-SPEAKER DETECTION ──────────────────────────
          // Environmental silence, fan drone, distant road traffic, and door/window thuds are strictly filtered out.
          // True human vocalization requires clear formant concentration (ratio >= 1.15) and energy >= 50.
          const formantRatio = peakEnergy / (avgSpeechEnergy + 0.001);
          const isClearSpeech = avgSpeechEnergy >= 50 && peakEnergy >= 66 && formantRatio >= 1.15;

          // Must be clearly above the room's ambient noise floor (+18 units higher to ignore mild fan/traffic murmurs)
          const isAboveNoiseFloor = avgSpeechEnergy >= ambientNoiseFloorRef.current + 18;

          // (2) Candidate is NOT speaking (mouth not moving), but clear human speech is active in background
          const isBackgroundVoiceWhileSilent =
            !isReadingGracePeriod &&
            isSilent &&
            isClearSpeech &&
            isAboveNoiseFloor &&
            avgFlux >= 1.8;

          // (1) Candidate IS speaking (mouth moving), but another loud voice is present (dual speaker)
          // Must have distinct non-formant frequency separation (>= 5 bins) and strong energy exceeding candidate level
          const isDualSpeakerPresent =
            !isSilent &&
            Math.abs(peakBin - secondaryPeakBin) >= 5 &&
            secondaryPeakEnergy >= 58 &&
            secondaryPeakEnergy > actualSpeakerLevel * 1.05 &&
            avgFlux >= 2.0;

          // Any kind of background voice (AI voice, human background voice while silent, or secondary speaker)
          // Runs independently of music so background music can NEVER be used to mask cheating voices!
          const isVoiceDetected = isAiVoice || isBackgroundVoiceWhileSilent || isDualSpeakerPresent;

          if (isVoiceDetected) {
            lastVoiceFrameTime = nowMs;
            consecutiveSuspiciousFrames++;
            if (voiceDetectedStartAt === 0) {
              voiceDetectedStartAt = nowMs;
            }
            const continuousDurationMs = nowMs - voiceDetectedStartAt;
            const targetMs = continuousVoiceMsRef.current ?? 8000;
            const requiredFrames = Math.max(100, Math.round(targetMs / 25));

            // Strictly requires BOTH full duration (10s in interview) AND high active speech frame density
            if (continuousDurationMs >= targetMs && consecutiveSuspiciousFrames >= requiredFrames) {
              voiceDetectedStartAt = 0;
              consecutiveSuspiciousFrames = 0;
              const confidence = Math.min(0.95, 0.78 + (avgSpeechEnergy / 255) * 0.2);
              triggerVoiceWarning('Background voice detected', confidence, continuousDurationMs);
            }
          } else {
            // If silence or non-speech exceeds 1000ms, completely break the streak so sporadic ambient sounds never build up to 10s
            if (nowMs - lastVoiceFrameTime > 1000) {
              voiceDetectedStartAt = 0;
              consecutiveSuspiciousFrames = 0;
            } else {
              consecutiveSuspiciousFrames = Math.max(0, consecutiveSuspiciousFrames - 1);
            }
          }
        }

        animFrameRef.current = requestAnimationFrame(checkAudio);
      };

      // In addition to acoustic keystroke detection, capture physical keyboard typing
      // during candidate turn so typing notes/prompts on the keyboard is caught immediately
      let keyStrokeTimestamps: number[] = [];
      const handleKeyDown = (e: KeyboardEvent) => {
        if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab'].includes(e.key)) return;
        if (!isCandidateTurnRef.current || isAiSpeakingRef.current) return;
        const now = Date.now();
        keyStrokeTimestamps.push(now);
        while (keyStrokeTimestamps.length > 0 && now - keyStrokeTimestamps[0] > 2000) {
          keyStrokeTimestamps.shift();
        }
        if (keyStrokeTimestamps.length >= 3) {
          keyStrokeTimestamps = [];
          triggerVoiceWarning('Keyboard typing sounds detected.', 0.95);
        }
      };

      if (typeof window !== 'undefined') {
        window.addEventListener('keydown', handleKeyDown);
      }

      animFrameRef.current = requestAnimationFrame(checkAudio);

      return () => {
        if (typeof window !== 'undefined') {
          window.removeEventListener('keydown', handleKeyDown);
        }
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        if (sourceRef.current) sourceRef.current.disconnect();
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
          audioContextRef.current.close().catch(() => {});
        }
      };
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
