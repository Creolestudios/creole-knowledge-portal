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
 */
export function isHeadsetOrBluetoothDevice(deviceLabel?: string | null): boolean {
  if (!deviceLabel) return false;
  const lower = deviceLabel.toLowerCase().trim();
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
  const [deviceLabel, setDeviceLabel] = useState<string>('');
  const [isHeadsetDevice, setIsHeadsetDevice] = useState<boolean>(false);

  useEffect(() => {
    let isCancelled = false;

    const updateDeviceInfo = async () => {
      const audioTrack = stream?.getAudioTracks()[0];
      const trackLabel = audioTrack?.label || '';
      let isBluetooth = isHeadsetOrBluetoothDevice(trackLabel);
      let resolvedLabel = trackLabel;

      // If active track label is missing or generic (e.g. "Default - Microphone Array" on Windows),
      // inspect enumerated audio devices to check if any Bluetooth or headset device is active.
      if (!isBluetooth && typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices) {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const headsetDevice = devices.find(
            (d) => (d.kind === 'audioinput' || d.kind === 'audiooutput') && isHeadsetOrBluetoothDevice(d.label),
          );
          if (headsetDevice) {
            isBluetooth = true;
            if (!resolvedLabel || resolvedLabel.toLowerCase().includes('default')) {
              resolvedLabel = headsetDevice.label;
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
 * Considers User-Agent patterns, iPadOS touch points, and small touch viewport fallbacks.
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

  // Standard mobile and tablet platforms in user agent
  const isMobileUa =
    /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile|silk|kindle|tablet/i.test(ua);

  if (isMobileUa) {
    return true;
  }

  // iPadOS 13+ reports as Macintosh in user agent but has multi-touch support
  if (typeof navigator !== 'undefined') {
    const isIPadOS =
      (navigator.maxTouchPoints ?? 0) > 1 &&
      (lowerUa.includes('macintosh') || lowerUa.includes('mac os'));
    if (isIPadOS) {
      return true;
    }
  }

  // Viewport & touch fallback: small touchscreens (e.g. phones / mini tablets under 768px width)
  if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
    const isSmallTouchDevice =
      (navigator.maxTouchPoints ?? 0) > 0 &&
      window.innerWidth > 0 &&
      window.innerWidth < 768;
    if (isSmallTouchDevice) {
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
      setIsMobileOrTablet(isMobileOrTabletDevice());
    };

    checkDevice();
    window.addEventListener('resize', checkDevice);
    return () => window.removeEventListener('resize', checkDevice);
  }, []);

  return isMobileOrTablet;
}

