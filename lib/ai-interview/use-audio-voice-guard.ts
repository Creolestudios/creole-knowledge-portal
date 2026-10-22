'use client';

import { useEffect, useRef, useCallback } from 'react';

export interface VoiceGuardOptions {
  interviewId: string;
  stream: MediaStream | null;
  systemAudioStream?: MediaStream | null;
  isAiSpeaking: boolean;
  isCandidateTurn: boolean;
  isCandidateMouthMoving?: boolean;
  isHeadset?: boolean;
  onUnauthorizedVoiceDetected: (info: { reason: string; confidence: number; durationMs?: number }) => void;
  takeSnapshot?: () => Promise<string | null>;
  readingGracePeriodMs?: number;
  continuousVoiceMs?: number;
  continuousSystemVoiceMs?: number;
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
  systemAudioStream,
  isAiSpeaking,
  isCandidateTurn,
  isCandidateMouthMoving,
  isHeadset = false,
  onUnauthorizedVoiceDetected,
  takeSnapshot,
  readingGracePeriodMs = 0,
  continuousVoiceMs = 8000,
  continuousSystemVoiceMs = 10000,
  cooldownMs = 10000,
}: VoiceGuardOptions) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const lastWarningTimeRef = useRef<number>(0);
  const actualSpeakerEnergyRef = useRef<number>(45);
  const ambientNoiseFloorRef = useRef<number>(24);
  const isAiSpeakingRef = useRef<boolean>(isAiSpeaking);
  const isCandidateTurnRef = useRef<boolean>(isCandidateTurn);
  const isCandidateMouthMovingRef = useRef<boolean>(isCandidateMouthMoving ?? false);
  const isHeadsetRef = useRef<boolean>(isHeadset ?? false);
  const candidateTurnStartedAtRef = useRef<number>(0);
  const readingGracePeriodMsRef = useRef<number>(readingGracePeriodMs);
  const continuousVoiceMsRef = useRef<number>(continuousVoiceMs);
  const continuousSystemVoiceMsRef = useRef<number>(continuousSystemVoiceMs);
  const cooldownMsRef = useRef<number>(cooldownMs);
  const systemAudioStreamRef = useRef<MediaStream | null>(systemAudioStream ?? null);

  // Cross-stream activity indicators: prevent physical microphone from misclassifying
  // speaker output from device/system audio as external background room voice.
  const isSystemVoiceActiveRef = useRef<boolean>(false);
  const isSystemAudioActiveRef = useRef<boolean>(false);
  const lastSystemVoiceTimeRef = useRef<number>(0);
  const lastSystemAudioTimeRef = useRef<number>(0);
  const lastCandidateSpeechTimeRef = useRef<number>(0);

  useEffect(() => {
    systemAudioStreamRef.current = systemAudioStream ?? null;
  }, [systemAudioStream]);

  useEffect(() => {
    isHeadsetRef.current = isHeadset ?? false;
  }, [isHeadset]);

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
    continuousSystemVoiceMsRef.current = continuousSystemVoiceMs;
  }, [continuousSystemVoiceMs]);

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
      let consecutiveMicDeviceVoiceFrames = 0;
      let micDeviceVoiceStartAt = 0;
      let lastMicDeviceVoiceFrameTime = 0;
      let lastAcousticDeviceVoiceTime = 0;
      let consecutiveAiFrames = 0;
      let consecutiveMusicFrames = 0;
      let consecutiveRoomMusicFrames = 0;
      let prevHighBandEnergy = 0;
      let prevHighBandPeakEnergy = 0;
      let lastKeystrokeFrame = 0;
      let lastPenClickFrame = 0;
      let lastVoiceFrameTime = 0;
      const recentTypingTimestamps: number[] = [];
      const recentPenClickTimestamps: number[] = [];
      let consecutivePenWritingFrames = 0;
      let lastCandidateSpeechTime = 0;
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
        const formantRatio = peakEnergy / (avgSpeechEnergy + 0.001);

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
          consecutiveMicDeviceVoiceFrames = 0;
          micDeviceVoiceStartAt = 0;
          consecutiveAiFrames = 0;
          consecutiveMusicFrames = 0;
          consecutiveRoomMusicFrames = 0;
          recentTypingTimestamps.length = 0;
          recentPenClickTimestamps.length = 0;
          consecutivePenWritingFrames = 0;
        } else if (isCandidateTurnRef.current) {
          // Track candidate's own speech level when mouth is moving
          if (isCandidateMouthMovingRef.current && avgSpeechEnergy > 20) {
            lastCandidateSpeechTime = nowMs;
            lastCandidateSpeechTimeRef.current = nowMs;
            actualSpeakerEnergyRef.current = actualSpeakerEnergyRef.current * 0.92 + avgSpeechEnergy * 0.08;
            if (actualSpeakerEnergyRef.current < 35) {
              actualSpeakerEnergyRef.current = 35;
            }
          }

          const actualSpeakerLevel = actualSpeakerEnergyRef.current;
          const isSilent = !isCandidateMouthMovingRef.current;

          if (isSilent) {
            // Adapt ambient room noise floor during stationary quiet room periods (fan drone, AC, room hiss)
            // Exclude dynamic speech/media/music tonality so audio playback never pulls up the noise floor
            const isStationaryNoise = (avgSpeechEnergy < 30 && formantRatio < 1.08 && musicTonality < 1.6) || avgSpeechEnergy < 20;
            if (isStationaryNoise) {
              ambientNoiseFloorRef.current = ambientNoiseFloorRef.current * 0.96 + avgSpeechEnergy * 0.04;
              if (ambientNoiseFloorRef.current < 20) ambientNoiseFloorRef.current = 20;
              if (ambientNoiseFloorRef.current > 32) ambientNoiseFloorRef.current = 32;
            }
          }

          // Reading grace period for ambient background sounds
          const isReadingGracePeriod =
            readingGracePeriodMsRef.current > 0 &&
            candidateTurnStartedAtRef.current > 0 &&
            nowMs >= candidateTurnStartedAtRef.current &&
            nowMs - candidateTurnStartedAtRef.current < readingGracePeriodMsRef.current;

          // ── MUSIC DETECTION & DISCRIMINATION ──────────────────────────────
          // High harmonic tonality (tonality ratio >= 2.8) and sustained energy.
          // Note: In-device sound warnings are strictly triggered by digital systemAudioStream.
          // The room microphone only tracks music presence to suppress keyboard typing false-positives
          // and prevent background music from interfering with legitimate candidate speech.
          const isSpeakingOnBluetooth =
            isHeadsetRef.current &&
            (isCandidateMouthMovingRef.current || (lastCandidateSpeechTime > 0 && nowMs - lastCandidateSpeechTime < 1500)) &&
            avgSpeechEnergy >= 30;

          const isMusic =
            !isSpeakingOnBluetooth &&
            avgMusicEnergy >= 26 &&
            musicTonality >= 2.2 &&
            !isReadingGracePeriod;

          if (isSpeakingOnBluetooth) {
            consecutiveMusicFrames = 0;
          } else if (isMusic) {
            consecutiveMusicFrames++;
          } else {
            consecutiveMusicFrames = Math.max(0, consecutiveMusicFrames - 1);
          }

          // ── LOUD MUSIC & BACKGROUND PLAYBACK DISCRIMINATION ───────────────
          // Suppress typing detection during loud music playback (EDM, drums, chords, songs).
          // Loud music exhibits sustained harmonic tonality (>= 2.5) with music energy (>= 36),
          // active music frames, or high continuous broadband sound pressure across low-mids (>= 40)
          // and speech bands (>= 45).
          const isCandidateSpeaking = isCandidateMouthMovingRef.current && avgSpeechEnergy >= 36;
          const isLoudMusicPlaying =
            (isMusic && consecutiveMusicFrames >= 3) ||
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

          // Check if system audio is actively playing or recently played on device (within last 1500ms)
          // When device voice plays through laptop speakers, the physical microphone picks it up acoustically.
          // We MUST NOT treat speaker bleed as an external background voice!
          const isDeviceAudioActive =
            isSystemVoiceActiveRef.current ||
            isSystemAudioActiveRef.current ||
            (lastSystemVoiceTimeRef.current > 0 && nowMs - lastSystemVoiceTimeRef.current < 1500) ||
            (lastSystemAudioTimeRef.current > 0 && nowMs - lastSystemAudioTimeRef.current < 1500);

          // ── HUMAN SPEECH FREQUENCY METRICS ─────────────────────────────────
          // Environmental silence, fan drone, distant road traffic, and door/window thuds are strictly filtered out.
          // True human vocalization requires clear formant concentration (ratio >= 1.10) and speech energy.
          const isClearSpeech = avgSpeechEnergy >= 38 && peakEnergy >= 52 && formantRatio >= 1.10;

          // Must be clearly above the room's ambient noise floor (+10 units higher to ignore mild fan/traffic murmurs)
          const isAboveNoiseFloor = avgSpeechEnergy >= ambientNoiseFloorRef.current + 10;

          // ── ACOUSTIC SPEAKER-BLEED (DEVICE VOICE) DISCRIMINATION ───────────
          // On laptops/computers where system audio stream has 0 tracks (such as Linux Chromium entire-screen sharing),
          // audio played from the device (e.g. YouTube, media) plays physically through laptop speakers and is captured
          // by the physical microphone.
          // Acoustic discrimination:
          // 1. Laptop micro-speakers physically roll off heavily below ~260Hz. Live human room voices have fundamental pitch F0 in bins 1-2 (85Hz-255Hz).
          // 2. High speech formant mid-range energy (bins 6-24, ~550Hz-2250Hz >= 32).
          // 3. Low fundamental bass (bins 1-2 < 22) and elevated acoustic ratio (>= 2.4).
          const fundamentalBassEnergy = (dataArray[1] + dataArray[2]) / 2;
          let midSpeechEnergySum = 0;
          const midSpeechStart = 6;
          const midSpeechEnd = Math.min(25, bufferLength);
          for (let i = midSpeechStart; i < midSpeechEnd; i++) {
            midSpeechEnergySum += dataArray[i];
          }
          const avgMidSpeechEnergy = midSpeechEnergySum / (midSpeechEnd - midSpeechStart);
          const speakerAcousticRatio = avgMidSpeechEnergy / (fundamentalBassEnergy + 1);

          const isAcousticSpeakerBleedVoice =
            !isHeadsetRef.current &&
            isClearSpeech &&
            isSilent &&
            fundamentalBassEnergy >= 2 &&
            avgMidSpeechEnergy >= 24 &&
            speakerAcousticRatio >= 0.5;

          if (isAcousticSpeakerBleedVoice) {
            lastAcousticDeviceVoiceTime = nowMs;
          }

          const isAcousticDeviceVoiceActive =
            isAcousticSpeakerBleedVoice ||
            (lastAcousticDeviceVoiceTime > 0 && nowMs - lastAcousticDeviceVoiceTime < 1800);

          const isDeviceVoiceActive = isDeviceAudioActive || isAcousticDeviceVoiceActive;

          // ── AI / SYNTHETIC VOICE DETECTION ─────────────────────────────────
          // Synthetic / TTS voices exhibit unnaturally flat spectral flux (< 1.8) while speech energy is clearly active (avg >= 65, peak >= 75).
          // Steady ambient background drone, laptop fans, or mic hiss (< 60) are strictly filtered out.
          const isAiVoice =
            !isSpeakingOnBluetooth &&
            !isDeviceVoiceActive &&
            avgSpeechEnergy >= 65 &&
            peakEnergy >= 75 &&
            avgFlux < 1.8 &&
            frameCount > 15;

          // (2) Candidate is NOT speaking (mouth not moving), but clear human speech is active in background
          // CRITICAL: Suppressed if device voice is active, as that voice is coming from the computer/speakers!
          const isBackgroundVoiceWhileSilent =
            !isReadingGracePeriod &&
            !isDeviceVoiceActive &&
            isSilent &&
            isClearSpeech &&
            isAboveNoiseFloor &&
            avgFlux >= 1.2;

          // (1) Candidate IS speaking (mouth moving), but another loud voice is present (dual speaker in the room)
          // Must have distinct non-formant frequency separation (>= 5 bins) and strong energy exceeding candidate level
          const isDualSpeakerPresent =
            !isSilent &&
            !isDeviceVoiceActive &&
            Math.abs(peakBin - secondaryPeakBin) >= 5 &&
            secondaryPeakEnergy >= 52 &&
            secondaryPeakEnergy > actualSpeakerLevel * 1.05 &&
            avgFlux >= 1.5;

          // ── DEVICE VOICE DETECTION VIA MICROPHONE (FOR LINUX / MISSING SYSTEM AUDIO TRACK) ──
          // If digital system audio stream is not actively reporting voice, but acoustic speaker bleed
          // is heard on the microphone, track continuous device voice for 10 seconds.
          if (isAcousticDeviceVoiceActive && !isSystemVoiceActiveRef.current) {
            lastMicDeviceVoiceFrameTime = nowMs;
            consecutiveMicDeviceVoiceFrames++;
            if (micDeviceVoiceStartAt === 0) {
              micDeviceVoiceStartAt = nowMs;
            }
            const continuousDurationMs = nowMs - micDeviceVoiceStartAt;
            const targetMs = continuousSystemVoiceMsRef.current ?? 10000;
            const requiredFrames = Math.max(35, Math.round(targetMs / 45));

            // While acoustic device voice is accumulating, decay the background voice frames so it doesn't fire
            consecutiveSuspiciousFrames = Math.max(0, consecutiveSuspiciousFrames - 1);

            if (continuousDurationMs >= targetMs && consecutiveMicDeviceVoiceFrames >= requiredFrames) {
              micDeviceVoiceStartAt = 0;
              consecutiveMicDeviceVoiceFrames = 0;
              lastAcousticDeviceVoiceTime = 0;
              const confidence = Math.min(0.95, 0.8 + (avgSpeechEnergy / 255) * 0.15);
              triggerVoiceWarning(
                'Device voice detected. Voice is playing from within the computer.',
                confidence,
                continuousDurationMs
              );
            }
          } else {
            if (nowMs - lastMicDeviceVoiceFrameTime > 1500) {
              micDeviceVoiceStartAt = 0;
              consecutiveMicDeviceVoiceFrames = 0;
            } else {
              consecutiveMicDeviceVoiceFrames = Math.max(0, consecutiveMicDeviceVoiceFrames - 1);
            }
          }

          // Any kind of background room voice (AI voice, human background voice while silent, or secondary speaker)
          // Runs independently of music so background music can NEVER be used to mask cheating voices!
          const isVoiceDetected = isAiVoice || isBackgroundVoiceWhileSilent || isDualSpeakerPresent;

          // ── ROOM BACKGROUND MUSIC DETECTION (PHYSICAL MICROPHONE) ───────────
          // Detects acoustic music, background songs, radio, or TV soundtrack in the candidate's room.
          // High harmonic tonality (>= 2.5) across musical frequency band without human vocal formants.
          const isRoomMusicActive =
            !isSpeakingOnBluetooth &&
            !isReadingGracePeriod &&
            !isVoiceDetected &&
            !isClearSpeech &&
            (isMusic ||
              (avgMusicEnergy >= 28 && musicTonality >= 2.5 && avgMusicEnergy >= ambientNoiseFloorRef.current + 3) ||
              (avgLowMidEnergy >= 34 && avgMusicEnergy >= 30 && musicTonality >= 2.2 && avgMusicEnergy >= ambientNoiseFloorRef.current + 3));

          if (isRoomMusicActive) {
            consecutiveRoomMusicFrames++;
            if (!isCandidateSpeaking && consecutiveRoomMusicFrames >= 30) {
              consecutiveRoomMusicFrames = 0;
              const confidence = Math.min(0.95, 0.8 + (avgMusicEnergy / 255) * 0.15);
              triggerVoiceWarning('Background music detected', confidence);
            } else if (isCandidateSpeaking && consecutiveRoomMusicFrames >= 45) {
              consecutiveRoomMusicFrames = 0;
              const confidence = Math.min(0.95, 0.85 + (avgMusicEnergy / 255) * 0.15);
              triggerVoiceWarning('Background music detected', confidence);
            }
          } else {
            consecutiveRoomMusicFrames = Math.max(0, consecutiveRoomMusicFrames - 1);
          }

          if (isVoiceDetected) {
            lastVoiceFrameTime = nowMs;
            consecutiveSuspiciousFrames++;
            if (voiceDetectedStartAt === 0) {
              voiceDetectedStartAt = nowMs;
            }
            const continuousDurationMs = nowMs - voiceDetectedStartAt;
            const targetMs = continuousVoiceMsRef.current ?? 8000;
            const requiredFrames = Math.max(40, Math.round(targetMs / 40));

            // Requires continuous duration and sustained phonemic speech frame density
            if (continuousDurationMs >= targetMs && consecutiveSuspiciousFrames >= requiredFrames) {
              voiceDetectedStartAt = 0;
              consecutiveSuspiciousFrames = 0;
              const confidence = Math.min(0.95, 0.78 + (avgSpeechEnergy / 255) * 0.2);
              triggerVoiceWarning('Background voice detected', confidence, continuousDurationMs);
            }
          } else {
            // If silence or non-speech exceeds 1000ms, completely break the streak so sporadic ambient sounds never build up
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

  // ── DEVICE SYSTEM AUDIO MONITORING ─────────────────────────────────────────
  // When the candidate shares system audio via screen share, monitor the direct
  // digital device audio track.
  // 1. Device Voice: If active speech/voice is detected originating from the device
  //    (YouTube video, meeting, AI voice, call) continuously for 10 seconds, trigger
  //    the specific device voice warning: "Device voice detected. Voice is playing from within the computer."
  // 2. Internal Media / Music: If non-voice sound / media is detected, trigger internal sound warning.
  useEffect(() => {
    if (!systemAudioStream || typeof systemAudioStream.getAudioTracks !== 'function') return;
    const audioTracks = systemAudioStream.getAudioTracks();
    if (!audioTracks || !audioTracks.length) return;
    const sysTrack = audioTracks[0];
    if (!sysTrack || sysTrack.readyState === 'ended') return;

    let sysAudioCtx: AudioContext | null = null;
    let sysAnalyser: AnalyserNode | null = null;
    let sysSource: MediaStreamAudioSourceNode | null = null;
    let animId: number | null = null;

    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      sysAudioCtx = new AudioCtx();
      if (sysAudioCtx.state === 'suspended') {
        sysAudioCtx.resume().catch(() => {});
      }

      sysAnalyser = sysAudioCtx.createAnalyser();
      sysAnalyser.fftSize = 512;
      sysAnalyser.smoothingTimeConstant = 0.6;

      sysSource = sysAudioCtx.createMediaStreamSource(systemAudioStream);
      sysSource.connect(sysAnalyser);

      const bufferLength = sysAnalyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      const prevDataArray = new Uint8Array(bufferLength);
      let consecutiveSysAudioFrames = 0;
      let consecutiveSysVoiceFrames = 0;
      let sysVoiceStartAt = 0;
      let lastSysVoiceFrameTime = 0;

      const checkSystemAudio = () => {
        if (!sysAnalyser) return;
        sysAnalyser.getByteFrequencyData(dataArray);
        const nowMs = Date.now();

        let energySum = 0;
        let peakEnergy = 0;
        for (let i = 0; i < bufferLength; i++) {
          const val = dataArray[i];
          energySum += val;
          if (val > peakEnergy) peakEnergy = val;
        }
        const avgEnergy = energySum / bufferLength;

        // Digital speech band analysis (bins 3 to 36, ~300Hz - 3400Hz)
        const sysStartBin = 3;
        const sysEndBin = Math.min(36, bufferLength);
        let sysSpeechEnergySum = 0;
        let sysSpeechPeakEnergy = 0;
        let sysSpectralFlux = 0;

        for (let i = sysStartBin; i < sysEndBin; i++) {
          const val = dataArray[i];
          sysSpeechEnergySum += val;
          if (val > sysSpeechPeakEnergy) sysSpeechPeakEnergy = val;
          sysSpectralFlux += Math.abs(val - prevDataArray[i]);
          prevDataArray[i] = val;
        }

        const avgSysSpeechEnergy = sysSpeechEnergySum / (sysEndBin - sysStartBin);
        const sysFormantRatio = sysSpeechPeakEnergy / (avgSysSpeechEnergy + 0.001);

        // System audio is active if sound pressure exists on digital track
        const isSysAudioActive = avgEnergy >= 14 || peakEnergy >= 25;
        isSystemAudioActiveRef.current = isSysAudioActive;
        if (isSysAudioActive) {
          lastSystemAudioTimeRef.current = nowMs;
        }

        // Voice on system audio exhibits formant energy concentration and speech energy.
        // Digital audio has no background room noise, so speech is crisp and distinct.
        const isSysVoiceActive =
          isSysAudioActive &&
          avgSysSpeechEnergy >= 20 &&
          sysSpeechPeakEnergy >= 32 &&
          sysFormantRatio >= 1.08;

        isSystemVoiceActiveRef.current = isSysVoiceActive;
        if (isSysVoiceActive) {
          lastSystemVoiceTimeRef.current = nowMs;
        }

        const cooldown = cooldownMsRef.current ?? 10000;
        const isCooldownOrAiSpeaking =
          isAiSpeakingRef.current ||
          (lastWarningTimeRef.current > 0 && nowMs - lastWarningTimeRef.current < cooldown);

        if (isCooldownOrAiSpeaking) {
          consecutiveSysAudioFrames = 0;
          consecutiveSysVoiceFrames = 0;
          sysVoiceStartAt = 0;
        } else if (isCandidateTurnRef.current) {
          if (isSysVoiceActive) {
            // Check if candidate is actively speaking into their headset/microphone
            // (prevents loopback/echo across all system types from falsely flagging candidate's own spoken answer)
            const isCandidateOwnSpokenVoice =
              isCandidateMouthMovingRef.current ||
              (lastCandidateSpeechTimeRef.current > 0 && nowMs - lastCandidateSpeechTimeRef.current < 1500);

            if (isCandidateOwnSpokenVoice) {
              consecutiveSysVoiceFrames = Math.max(0, consecutiveSysVoiceFrames - 1);
            } else {
              // Candidate is silent or mouth not moving, but voice is playing through the system! (Audio note, YouTube, incoming call)
              lastSysVoiceFrameTime = nowMs;
              consecutiveSysVoiceFrames++;
              if (sysVoiceStartAt === 0) {
                sysVoiceStartAt = nowMs;
              }
              const continuousDurationMs = nowMs - sysVoiceStartAt;
              const targetMs = continuousSystemVoiceMsRef.current ?? 10000;
              const requiredFrames = Math.max(40, Math.round(targetMs / 40));

              if (continuousDurationMs >= targetMs && consecutiveSysVoiceFrames >= requiredFrames) {
                sysVoiceStartAt = 0;
                consecutiveSysVoiceFrames = 0;
                const confidence = Math.min(0.98, 0.85 + (avgSysSpeechEnergy / 255) * 0.15);
                triggerVoiceWarning(
                  'Device voice detected. Voice is playing from within the computer.',
                  confidence,
                  continuousDurationMs
                );
              }
            }
          } else {
            // If silence or non-speech exceeds 1000ms, reset streak
            if (nowMs - lastSysVoiceFrameTime > 1000) {
              sysVoiceStartAt = 0;
              consecutiveSysVoiceFrames = 0;
            } else {
              consecutiveSysVoiceFrames = Math.max(0, consecutiveSysVoiceFrames - 1);
            }

            // Non-voice media playback detection (e.g. background music / sound effects)
            if (isSysAudioActive && !isSysVoiceActive) {
              consecutiveSysAudioFrames++;
              if (consecutiveSysAudioFrames >= 12) {
                consecutiveSysAudioFrames = 0;
                const confidence = Math.min(0.95, 0.8 + (avgEnergy / 255) * 0.15);
                triggerVoiceWarning(
                  'Internal sound / music detected. Please stop all media playback.',
                  confidence
                );
              }
            } else {
              consecutiveSysAudioFrames = Math.max(0, consecutiveSysAudioFrames - 1);
            }
          }
        }

        animId = requestAnimationFrame(checkSystemAudio);
      };

      animId = requestAnimationFrame(checkSystemAudio);

      return () => {
        if (animId) cancelAnimationFrame(animId);
        isSystemAudioActiveRef.current = false;
        isSystemVoiceActiveRef.current = false;
        try {
          if (sysSource) sysSource.disconnect();
          if (sysAudioCtx && sysAudioCtx.state !== 'closed') {
            sysAudioCtx.close().catch(() => {});
          }
        } catch {
          // ignore cleanup errors
        }
      };
    } catch (err) {
      console.warn('[voice-guard] System audio initialization failed:', err);
    }

    return () => {
      if (animId) cancelAnimationFrame(animId);
      isSystemAudioActiveRef.current = false;
      isSystemVoiceActiveRef.current = false;
      try {
        if (sysSource) sysSource.disconnect();
        if (sysAudioCtx && sysAudioCtx.state !== 'closed') {
          sysAudioCtx.close().catch(() => {});
        }
      } catch {
        // ignore cleanup errors
      }
    };
  }, [systemAudioStream, triggerVoiceWarning]);

  return {
    isAiSpeakingRef,
  };
}
