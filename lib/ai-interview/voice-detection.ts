/**
 * voice-detection.ts
 *
 * Background voice / noise detection using the Web Audio API AnalyserNode.
 *
 * Strategy:
 *   1. Accept an existing MediaStream (mic already captured by the interview page).
 *   2. Fork the stream into an AudioContext → AnalyserNode → ScriptProcessorNode.
 *   3. Compute RMS energy of every audio chunk.
 *   4. If sustained energy stays above NOISE_THRESHOLD for > SUSTAINED_MS,
 *      fire a `background_voice` warning event.
 *   5. Debounce subsequent warnings with DEBOUNCE_MS.
 *
 * This approach works offline with no extra model download.
 * All callbacks run on the main thread (audio worklets not needed for this use case).
 */

export interface VoiceDetectionConfig {
  /** RMS level above which audio is considered "significant noise" (0–1). Default: 0.04 */
  noiseThreshold?: number;
  /** How long (ms) noise must be sustained before firing a warning. Default: 3000 */
  sustainedMs?: number;
  /** Minimum gap (ms) between consecutive warnings. Default: 20000 */
  debounceMs?: number;
  /** Called when a background voice / noise event is sustained long enough */
  onBackgroundVoice: (meta: { duration_ms: number; rms_level: number }) => void;
}

export class VoiceDetector {
  private audioCtx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private animationFrame = 0;

  private readonly noiseThreshold: number;
  private readonly sustainedMs: number;
  private readonly debounceMs: number;
  private readonly onBackgroundVoice: VoiceDetectionConfig['onBackgroundVoice'];

  // State
  private noiseStartAt: number | null = null;
  private lastWarningAt = 0;

  constructor(config: VoiceDetectionConfig) {
    this.noiseThreshold = config.noiseThreshold ?? 0.04;
    this.sustainedMs = config.sustainedMs ?? 3000;
    this.debounceMs = config.debounceMs ?? 20000;
    this.onBackgroundVoice = config.onBackgroundVoice;
  }

  /** Start monitoring the given MediaStream for background voice. */
  start(stream: MediaStream): void {
    if (this.audioCtx) return; // already running

    try {
      this.audioCtx = new AudioContext();
      this.source = this.audioCtx.createMediaStreamSource(stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 2048;

      // ScriptProcessorNode for per-buffer RMS computation
      // bufferSize 4096 ≈ ~85ms at 48kHz — lightweight enough
      this.scriptProcessor = this.audioCtx.createScriptProcessor(4096, 1, 1);

      this.source.connect(this.analyser);
      this.analyser.connect(this.scriptProcessor);
      // Connect to destination (required by some browsers, but muted via gain 0)
      const silentGain = this.audioCtx.createGain();
      silentGain.gain.value = 0;
      this.scriptProcessor.connect(silentGain);
      silentGain.connect(this.audioCtx.destination);

      this.scriptProcessor.onaudioprocess = (event: AudioProcessingEvent) => {
        this.handleAudioChunk(event);
      };
    } catch (err) {
      console.warn('[voice-detection] Failed to start AudioContext:', err);
    }
  }

  /** Stop monitoring and release all audio resources. */
  stop(): void {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = 0;
    }
    try {
      this.scriptProcessor?.disconnect();
      this.analyser?.disconnect();
      this.source?.disconnect();
      void this.audioCtx?.close();
    } catch (_) {
      // ignore disconnect errors
    }
    this.audioCtx = null;
    this.source = null;
    this.analyser = null;
    this.scriptProcessor = null;
    this.noiseStartAt = null;
  }

  private handleAudioChunk(event: AudioProcessingEvent): void {
    const input = event.inputBuffer.getChannelData(0);
    const rms = this.computeRms(input);
    const nowMs = Date.now();

    if (rms > this.noiseThreshold) {
      // Noise above threshold — start or continue tracking sustained duration
      if (this.noiseStartAt === null) {
        this.noiseStartAt = nowMs;
      }

      const elapsed = nowMs - this.noiseStartAt;
      const timeSinceLast = nowMs - this.lastWarningAt;

      if (elapsed >= this.sustainedMs && timeSinceLast >= this.debounceMs) {
        this.lastWarningAt = nowMs;
        this.noiseStartAt = null; // reset after triggering
        this.onBackgroundVoice({ duration_ms: elapsed, rms_level: Math.round(rms * 1000) / 1000 });
      }
    } else {
      // Below threshold — reset the sustained timer
      this.noiseStartAt = null;
    }
  }

  /** Root Mean Square energy of a PCM buffer (returns 0–1). */
  private computeRms(buffer: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      const sample = buffer[i] ?? 0;
      sum += sample * sample;
    }
    return Math.sqrt(sum / buffer.length);
  }
}
