// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { DeviceSettingsPanel } from './device-settings-panel';

describe('DeviceSettingsPanel', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([
          { kind: 'videoinput', deviceId: 'cam-1', label: 'Front Camera' },
          { kind: 'videoinput', deviceId: 'cam-2', label: 'Back Camera' },
          { kind: 'audioinput', deviceId: 'mic-1', label: 'Default Mic' },
          { kind: 'audiooutput', deviceId: 'spk-1', label: 'Speakers' },
        ]),
      },
      configurable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('lists only video/audio input devices, pre-selecting the current ones', async () => {
    render(
      <DeviceSettingsPanel
        currentCameraId="cam-2"
        currentMicId="mic-1"
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.getByText('Front Camera')).toBeInTheDocument());
    expect(screen.queryByText('Speakers')).not.toBeInTheDocument();

    const cameraSelect = document.getElementById('device-settings-camera-select') as HTMLSelectElement;
    expect(cameraSelect.value).toBe('cam-2');
  });

  it('calls onApply with the selected devices and closes on success', async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<DeviceSettingsPanel currentCameraId="cam-1" currentMicId="mic-1" onClose={onClose} onApply={onApply} />);

    await waitFor(() => expect(document.getElementById('device-settings-apply')).not.toBeDisabled());
    fireEvent.click(document.getElementById('device-settings-apply')!);

    await waitFor(() => expect(onApply).toHaveBeenCalledWith({ videoDeviceId: 'cam-1', audioDeviceId: 'mic-1' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('shows an error and does not close when onApply rejects', async () => {
    const onApply = vi.fn().mockRejectedValue(new Error('boom'));
    const onClose = vi.fn();
    render(<DeviceSettingsPanel currentCameraId="cam-1" currentMicId="mic-1" onClose={onClose} onApply={onApply} />);

    await waitFor(() => expect(document.getElementById('device-settings-apply')).not.toBeDisabled());
    fireEvent.click(document.getElementById('device-settings-apply')!);

    await waitFor(() =>
      expect(
        screen.getByText('Could not switch to the selected devices. Please try a different camera or microphone.'),
      ).toBeInTheDocument(),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    render(<DeviceSettingsPanel currentCameraId={null} currentMicId={null} onClose={onClose} onApply={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Front Camera')).toBeInTheDocument());

    fireEvent.click(document.getElementById('device-settings-close')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes the panel when Escape is pressed while focused', async () => {
    const onClose = vi.fn();
    render(<DeviceSettingsPanel currentCameraId="cam-1" currentMicId="mic-1" onClose={onClose} onApply={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Front Camera')).toBeInTheDocument());

    fireEvent.keyDown(document.getElementById('device-settings-panel')!, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
