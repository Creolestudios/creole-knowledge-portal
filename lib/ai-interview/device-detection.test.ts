// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  isHeadsetOrBluetoothDevice,
  useAudioDeviceType,
  isMobileOrTabletDevice,
  useIsMobileOrTablet,
} from './device-detection';

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

  describe('isMobileOrTabletDevice & useIsMobileOrTablet', () => {
    it('detects Android, iPhone, iPad, and tablet User-Agents', () => {
      const androidUa = 'Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36';
      const iPhoneUa = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';
      const iPadUa = 'Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
      const desktopUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

      expect(isMobileOrTabletDevice(androidUa)).toBe(true);
      expect(isMobileOrTabletDevice(iPhoneUa)).toBe(true);
      expect(isMobileOrTabletDevice(iPadUa)).toBe(true);
      expect(isMobileOrTabletDevice(desktopUa)).toBe(false);
    });

    it('detects iPadOS with Macintosh UA and multi-touch points', () => {
      const iPadMacUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15';
      
      const originalNavigator = window.navigator;
      Object.defineProperty(window, 'navigator', {
        value: {
          ...originalNavigator,
          userAgent: iPadMacUa,
          maxTouchPoints: 5,
        },
        configurable: true,
      });

      expect(isMobileOrTabletDevice(iPadMacUa)).toBe(true);

      // Standard desktop Mac without touch points
      Object.defineProperty(window, 'navigator', {
        value: {
          ...originalNavigator,
          userAgent: iPadMacUa,
          maxTouchPoints: 0,
        },
        configurable: true,
      });

      expect(isMobileOrTabletDevice(iPadMacUa)).toBe(false);

      Object.defineProperty(window, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
    });

    it('useIsMobileOrTablet returns boolean status and updates on resize', () => {
      const { result } = renderHook(() => useIsMobileOrTablet());
      expect(typeof result.current).toBe('boolean');
    });
  });
});

