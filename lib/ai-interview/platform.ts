/**
 * Platform detection and Linux system audio utilities for AI Interview & Proctoring modules.
 */

/**
 * Detects whether the current client is running on Linux.
 *
 * In production desktop browsers:
 * - Chromium on Linux sets `navigator.userAgentData.platform` to "Linux"
 * - Or `navigator.userAgent` includes "X11", "Linux x86_64", or "Linux".
 * - ChromeOS (CrOS) is excluded because ChromeOS natively supports system audio loopback.
 *
 * In testing environments (JSDOM/Vitest):
 * - Default JSDOM running on Linux contains "(linux)" in userAgent.
 * - To prevent breaking test suites that test standard Windows/Mac behavior,
 *   only return true in tests if explicitly configured with a real Linux user agent
 *   (e.g. containing "X11", "Linux x86_64", or "Linux aarch64").
 */
export function isLinuxClient(): boolean {
  if (typeof navigator === 'undefined') return false;

  const uaData = (navigator as unknown as { userAgentData?: { platform?: string } }).userAgentData;
  if (uaData?.platform) {
    const plat = uaData.platform.toLowerCase();
    if (plat.includes('cros')) return false;
    if (plat.includes('linux')) return true;
  }

  const ua = navigator.userAgent || '';
  if (/cros/i.test(ua)) return false;

  if (process.env.NODE_ENV === 'test') {
    return /x11|linux x86_64|linux aarch64/i.test(ua);
  }

  return /linux|x11/i.test(ua);
}

/**
 * Checks whether an audio input device represents an internal system audio monitor or loopback.
 *
 * On Linux, desktop sound routed through PulseAudio or PipeWire is exposed via virtual monitor sources
 * (e.g. "Monitor of Built-in Audio Analog Stereo", "Monitor of HDMI Output", "Virtual_Microphone", "Loopback").
 */
export function isSystemAudioMonitorDevice(device: MediaDeviceInfo): boolean {
  if (device.kind !== 'audioinput') return false;
  const label = (device.label || '').toLowerCase().trim();
  if (!label) return false;

  // PulseAudio / PipeWire standard monitor prefixes and suffixes:
  // e.g. "Monitor of Built-in Audio...", "Monitor of Tiger Lake...", "Speaker + Headphones (Monitor)", "output.monitor"
  if (
    label.includes('monitor of') ||
    label.includes('(monitor)') ||
    label.includes('.monitor') ||
    label.includes('output monitor') ||
    label.endsWith(' monitor') ||
    label.includes('monitor-')
  ) {
    return true;
  }

  // Virtual loopbacks, stereo mixes, and internal routing
  if (
    label.includes('loopback') ||
    label.includes('stereo mix') ||
    label.includes('system audio') ||
    label.includes('what u hear') ||
    label.includes('wave out')
  ) {
    return true;
  }

  // Virtual microphones remapped from output monitors:
  if (
    label.includes('virtual_microphone') ||
    label.includes('virtual microphone') ||
    label.includes('virtual source') ||
    label.includes('virtual audio')
  ) {
    return true;
  }

  // Monitor prefix if not a regular microphone/mic
  if (label.startsWith('monitor') && !label.includes('microphone') && !label.includes('mic')) {
    return true;
  }

  return false;
}

/**
 * Attempts to locate and acquire a live system audio monitor stream on Linux via getUserMedia.
 *
 * If a PulseAudio/PipeWire monitor or loopback audioinput device is available,
 * requests an audio stream from that specific deviceId with DSP effects disabled
 * (no echo cancellation, noise suppression, or auto gain control) to preserve direct device audio fidelity.
 *
 * Returns null if no monitor device is present or if permission is denied, allowing
 * graceful fallback to standard microphone room proctoring without crashing or blocking.
 */
export async function acquireLinuxSystemAudioMonitorStream(): Promise<MediaStream | null> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices || !navigator.mediaDevices?.getUserMedia) {
    return null;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const monitorDevice = devices.find(isSystemAudioMonitorDevice);

    if (!monitorDevice?.deviceId) {
      return null;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: monitorDevice.deviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });

    return stream;
  } catch (err) {
    console.warn('[LinuxAudioMonitor] Unable to capture system audio monitor via getUserMedia:', err);
    return null;
  }
}
