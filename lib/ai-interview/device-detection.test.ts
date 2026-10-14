// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { isHeadsetOrBluetoothDevice, useAudioDeviceType } from './device-detection';

describe('device-detection module', () => {
  it('correctly identifies Bluetooth, AirPods, and headphones from device labels', () => {
    expect(isHeadsetOrBluetoothDevice('AirPods Pro (Bluetooth)')).toBe(true);
    expect(isHeadsetOrBluetoothDevice('Bluetooth Hands-Free AG Audio')).toBe(true);
    expect(isHeadsetOrBluetoothDevice('Galaxy Buds2 Pro')).toBe(true);
    expect(isHeadsetOrBluetoothDevice('Sony WH-1000XM4')).toBe(true);
    expect(isHeadsetOrBluetoothDevice('JBL Tune Wireless Headset')).toBe(true);
    expect(isHeadsetOrBluetoothDevice('USB Headphone / Earphone')).toBe(true);
    expect(isHeadsetOrBluetoothDevice('Bose QuietComfort 45')).toBe(true);
  });

  it('correctly returns false for built-in microphones and internal laptop audio', () => {
    expect(isHeadsetOrBluetoothDevice('Internal Microphone (Realtek(R) Audio)')).toBe(false);
    expect(isHeadsetOrBluetoothDevice('Microphone Array (Intel Smart Sound)')).toBe(false);
    expect(isHeadsetOrBluetoothDevice('Default - Realtek High Definition Audio')).toBe(false);
    expect(isHeadsetOrBluetoothDevice('')).toBe(false);
    expect(isHeadsetOrBluetoothDevice(null)).toBe(false);
    expect(isHeadsetOrBluetoothDevice(undefined)).toBe(false);
  });

  it('useAudioDeviceType hook reacts to stream track and device changes', () => {
    let deviceChangeHandler: (() => void) | null = null;
    const mockAddEventListener = vi.fn((event: string, handler: () => void) => {
      if (event === 'devicechange') {
        deviceChangeHandler = handler;
      }
    });
    const mockRemoveEventListener = vi.fn();

    vi.stubGlobal('navigator', {
      mediaDevices: {
        addEventListener: mockAddEventListener,
        removeEventListener: mockRemoveEventListener,
      },
    });

    let mockLabel = 'AirPods Pro (Bluetooth)';
    const fakeStream = {
      getAudioTracks: () => [{ label: mockLabel }],
    } as unknown as MediaStream;

    const { result, rerender } = renderHook(() => useAudioDeviceType(fakeStream));

    expect(result.current.isHeadsetDevice).toBe(true);
    expect(result.current.deviceLabel).toBe('AirPods Pro (Bluetooth)');

    // Switch device to internal mic on devicechange
    act(() => {
      mockLabel = 'Internal Microphone (Realtek Audio)';
      if (deviceChangeHandler) {
        deviceChangeHandler();
      }
    });

    expect(result.current.isHeadsetDevice).toBe(false);
    expect(result.current.deviceLabel).toBe('Internal Microphone (Realtek Audio)');

    vi.unstubAllGlobals();
  });
});
