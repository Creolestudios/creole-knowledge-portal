'use client';

import { useState, useEffect } from 'react';

/**
 * Keywords identifying Bluetooth, wireless audio, headphones, or earphones.
 */
const HEADSET_KEYWORDS = [
  'bluetooth',
  'airpod',
  'galaxy bud',
  'bud',
  'headset',
  'wireless',
  'hands-free',
  'headphone',
  'earphone',
  'earbud',
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
    const updateDeviceInfo = () => {
      const audioTrack = stream?.getAudioTracks()[0];
      const label = audioTrack?.label || '';
      setDeviceLabel(label);
      setIsHeadsetDevice(isHeadsetOrBluetoothDevice(label));
    };

    updateDeviceInfo();

    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener('devicechange', updateDeviceInfo);
      return () => {
        navigator.mediaDevices?.removeEventListener('devicechange', updateDeviceInfo);
      };
    }
  }, [stream]);

  return { isHeadsetDevice, deviceLabel };
}
