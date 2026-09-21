// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MeetingControlBar } from './meeting-control-bar';

describe('MeetingControlBar', () => {
  afterEach(() => cleanup());

  it('shows the mic as on and calls onToggleMic when clicked', () => {
    const onToggleMic = vi.fn();
    render(<MeetingControlBar micOn onToggleMic={onToggleMic} />);

    const micButton = screen.getByTitle('Mute microphone');
    expect(micButton.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(micButton);
    expect(onToggleMic).toHaveBeenCalledTimes(1);
  });

  it('shows the mic as off with the unmute title', () => {
    render(<MeetingControlBar micOn={false} onToggleMic={vi.fn()} />);
    expect(screen.getByTitle('Unmute microphone')).toBeInTheDocument();
  });

  it('camera control is always disabled (proctoring requires it stay on)', () => {
    render(<MeetingControlBar micOn onToggleMic={vi.fn()} />);
    expect(document.getElementById('meeting-camera-locked')).toBeDisabled();
  });

  it('does not render a settings button when onOpenSettings is omitted', () => {
    render(<MeetingControlBar micOn onToggleMic={vi.fn()} />);
    expect(document.getElementById('meeting-open-settings')).not.toBeInTheDocument();
  });

  it('renders an enabled settings button and calls onOpenSettings', () => {
    const onOpenSettings = vi.fn();
    render(<MeetingControlBar micOn onToggleMic={vi.fn()} onOpenSettings={onOpenSettings} settingsEnabled />);
    const settingsButton = document.getElementById('meeting-open-settings') as HTMLButtonElement;
    expect(settingsButton).not.toBeDisabled();
    fireEvent.click(settingsButton);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('disables the settings button when settingsEnabled is false', () => {
    render(<MeetingControlBar micOn onToggleMic={vi.fn()} onOpenSettings={vi.fn()} settingsEnabled={false} />);
    expect(document.getElementById('meeting-open-settings')).toBeDisabled();
  });
});
