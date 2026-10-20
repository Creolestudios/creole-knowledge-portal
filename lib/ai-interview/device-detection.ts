'use client';

import { useState, useEffect } from 'react';

/**
 * Keywords identifying Bluetooth, wireless audio, headphones, or earphones.
 */
const HEADSET_KEYWORDS = [
  'bluetooth',
  'airpod',
  'airpods',
  'galaxy bud',
  'bud',
  'buds',
  'headset',
  'wireless',
  'hands-free',
  'handsfree',
  'headphone',
  'headphones',
  'earphone',
  'earphones',
  'earbud',
  'earbuds',
  'wh-1000',
  'wf-1000',
  'jbl',
  'bose',
  'beats',
  'sennheiser',
  'jabra',
  'plantronics',
  'poly',
  'pixel bud',
  'pixel buds',
  'boat',
  'airdopes',
  'rockerz',
  'noise',
  'boult',
  'realme',
  'oppo',
  'oneplus',
  'tws',
  'soundcore',
  'anker',
  'skullcandy',
  'redmi',
  'mivi',
  'truke',
  'zebronics',
  'ptron',
  'nothing',
  'in-ear',
  'bthf',
  'bt ',
  ' bt',
  '(bt)',
];

/**
 * Checks if a given device label corresponds to Bluetooth or headphone/earphone hardware.
 * Strictly ignores internal laptop soundcards and built-in mic/speakers (Realtek, Intel Smart Sound, etc.)
 * to avoid false positives when Bluetooth is on but no device is connected.
 */
export function isHeadsetOrBluetoothDevice(deviceLabel?: string | null): boolean {
  if (!deviceLabel) return false;
  const lower = deviceLabel.toLowerCase().trim();

  // Exclude built-in laptop motherboards and internal sound chipsets
  const isInternalChipset =
    lower.includes('realtek') ||
    lower.includes('intel smart sound') ||
    lower.includes('intel(r) smart sound') ||
    lower.includes('internal microphone') ||
    lower.includes('microphone array') ||
    lower.includes('conexant') ||
    lower.includes('synaptics') ||
    lower.includes('cirrus');

  if (isInternalChipset) {
    return false;
  }

  return HEADSET_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Hook detecting whether the active audio stream is using Bluetooth, wireless headset, or headphones.
 * Dynamically reacts to device changes (e.g., connecting or disconnecting Bluetooth).
 */
export function useAudioDeviceType(stream: MediaStream | null): {
  isHeadsetDevice: boolean;
  deviceLabel: string;
} {
  const [deviceLabel, setDeviceLabel] = useState<string>(() => {
    const audioTracks = stream?.getAudioTracks() || [];
    const audioTrack = audioTracks.find((t) => t.readyState !== 'ended') || audioTracks[0];
    return audioTrack?.label || '';
  });
  const [isHeadsetDevice, setIsHeadsetDevice] = useState<boolean>(() => {
    const audioTracks = stream?.getAudioTracks() || [];
    const audioTrack = audioTracks.find((t) => t.readyState !== 'ended') || audioTracks[0];
    return isHeadsetOrBluetoothDevice(audioTrack?.label);
  });

  useEffect(() => {
    let isCancelled = false;

    const updateDeviceInfo = async () => {
      const audioTracks = stream?.getAudioTracks() || [];
      const audioTrack = audioTracks.find((t) => t.readyState !== 'ended') || audioTracks[0];

      const trackLabel = audioTrack?.label || '';
      let isBluetooth = isHeadsetOrBluetoothDevice(trackLabel);
      let resolvedLabel = trackLabel;

      // If the active audio track is not explicitly identified as a Bluetooth device
      // (e.g. Windows routed mic to internal laptop mic while headset is used for listening),
      // inspect enumerated audio devices to check if any genuine Bluetooth headset/earphones are connected.
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices) {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();

          // 1. If active track has a generic label like "Default", check its specific device
          if (!isBluetooth && (trackLabel.toLowerCase().startsWith('default') || !trackLabel)) {
            const activeDeviceId = typeof audioTrack?.getSettings === 'function' ? audioTrack.getSettings().deviceId : undefined;
            const activeInput = devices.find(
              (d) => d.kind === 'audioinput' && activeDeviceId && d.deviceId === activeDeviceId
            );
            if (activeInput && isHeadsetOrBluetoothDevice(activeInput.label)) {
              isBluetooth = true;
              resolvedLabel = activeInput.label;
            }
          }

          // 2. If still not identified, check if a genuine external Bluetooth headset is connected to the system
          if (!isBluetooth) {
            const connectedHeadset = devices.find(
              (d) => (d.kind === 'audioinput' || d.kind === 'audiooutput') && isHeadsetOrBluetoothDevice(d.label)
            );
            if (connectedHeadset) {
              isBluetooth = true;
              resolvedLabel = connectedHeadset.label;
            }
          }
        } catch {
          // ignore enumeration error in restricted or test environments
        }
      }

      if (!isCancelled) {
        setDeviceLabel(resolvedLabel);
        setIsHeadsetDevice(isBluetooth);
      }
    };

    void updateDeviceInfo();

    if (typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.addEventListener === 'function') {
      navigator.mediaDevices.addEventListener('devicechange', updateDeviceInfo);
      return () => {
        isCancelled = true;
        navigator.mediaDevices?.removeEventListener?.('devicechange', updateDeviceInfo);
      };
    }

    return () => {
      isCancelled = true;
    };
  }, [stream]);

  return { isHeadsetDevice, deviceLabel };
}

/**
 * Detects whether the current client device is a mobile phone, tablet, or non-desktop device.
 * Considers User-Agent patterns (including in-app webviews), Client Hints, iPadOS touch points,
 * media pointer queries, and physical screen dimensions.
 */
export function isMobileOrTabletDevice(customUserAgent?: string): boolean {
  if (typeof window === 'undefined') return false;

  // In test environment, default to desktop unless custom UA or mock flag is explicitly provided
  if (process.env.NODE_ENV === 'test' && !customUserAgent) {
    if (typeof window !== 'undefined' && window.sessionStorage?.getItem('mock_mobile_device') === 'true') {
      return true;
    }
    return false;
  }

  const ua = customUserAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';
  const lowerUa = ua.toLowerCase();

  // 1. Standard mobile and tablet platforms + In-App WebViews (Slack, WhatsApp, Gmail, FB, Instagram, etc.)
  const isMobileUa =
    /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile|silk|kindle|tablet|cfnetwork|wv|fban|fbav|instagram|linkedinapp|micromessenger|snapchat|line\/|gsa\//i.test(ua);

  if (isMobileUa) {
    return true;
  }

  // 2. User-Agent Client Hints (Modern Chrome / Edge on Android / Mobile)
  if (typeof navigator !== 'undefined') {
    const nav = navigator as { userAgentData?: { mobile?: boolean } };
    if (nav.userAgentData?.mobile === true) {
      return true;
    }
  }

  // 3. iPadOS 13+ reports as Macintosh in user agent but has multi-touch support
  const maxTouchPoints = typeof navigator !== 'undefined' ? (navigator.maxTouchPoints ?? 0) : 0;
  if (maxTouchPoints > 1 && (lowerUa.includes('macintosh') || lowerUa.includes('mac os'))) {
    return true;
  }

  // 4. Media query: Touch-only devices with coarse pointer and no hover (smartphones & tablets)
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    try {
      const isCoarseNoHover = window.matchMedia('(pointer: coarse) and (hover: none)').matches;
      if (isCoarseNoHover) {
        return true;
      }
    } catch {
      // ignore
    }
  }

  // 5. Screen & Viewport dimensions check (phones & mini tablets under 768px width)
  if (typeof window !== 'undefined') {
    const screenWidth = typeof window.screen !== 'undefined' ? Math.min(window.screen.width, window.screen.height) : 0;
    const innerDim = Math.min(window.innerWidth || screenWidth, window.innerHeight || screenWidth);
    const hasTouch = maxTouchPoints > 0;
    if (hasTouch && ((screenWidth > 0 && screenWidth < 768) || (innerDim > 0 && innerDim < 768))) {
      return true;
    }
  }

  return false;
}

/**
 * Hook to reactively determine if the user is visiting on a mobile device or tablet.
 */
export function useIsMobileOrTablet(): boolean {
  const [isMobileOrTablet, setIsMobileOrTablet] = useState<boolean>(() => {
    return isMobileOrTabletDevice();
  });

  useEffect(() => {
    const checkDevice = () => {
      setIsMobileOrTablet((prev) => {
        const next = isMobileOrTabletDevice();
        return prev === next ? prev : next;
      });
    };

    const rafId = requestAnimationFrame(checkDevice);
    window.addEventListener('resize', checkDevice);
    window.addEventListener('orientationchange', checkDevice);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', checkDevice);
      window.removeEventListener('orientationchange', checkDevice);
    };
  }, []);

  return isMobileOrTablet;
}


