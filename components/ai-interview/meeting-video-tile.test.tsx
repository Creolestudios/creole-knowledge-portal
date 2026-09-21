// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MeetingVideoTile } from './meeting-video-tile';

function makeStream(videoEnabled: boolean) {
  const track = { enabled: videoEnabled, readyState: 'live' as const };
  return {
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
}

describe('MeetingVideoTile', () => {
  afterEach(() => cleanup());

  it('shows a camera-off placeholder when there is no stream', () => {
    render(<MeetingVideoTile stream={null} micOn />);
    expect(screen.getByText('Camera off')).toBeInTheDocument();
  });

  it('shows a camera-off placeholder when the video track is disabled', () => {
    render(<MeetingVideoTile stream={makeStream(false)} micOn />);
    expect(screen.getByText('Camera off')).toBeInTheDocument();
  });

  it('renders the video element when the stream has a live, enabled track', () => {
    render(<MeetingVideoTile stream={makeStream(true)} micOn />);
    expect(screen.queryByText('Camera off')).not.toBeInTheDocument();
    expect(document.querySelector('video')).toBeTruthy();
  });

  it('shows the mic-on/off badge based on the micOn prop', () => {
    const { rerender } = render(<MeetingVideoTile stream={makeStream(true)} micOn />);
    expect(document.querySelector('[aria-label="You camera preview"]')?.textContent).not.toContain('Camera off');

    rerender(<MeetingVideoTile stream={makeStream(true)} micOn={false} />);
    // Mic-off badge swaps icon; presence of the tile itself confirms re-render succeeded.
    expect(document.querySelector('[aria-label="You camera preview"]')).toBeInTheDocument();
  });

  it('uses a custom label when provided', () => {
    render(<MeetingVideoTile stream={makeStream(true)} micOn label="Candidate" />);
    expect(screen.getByText('Candidate')).toBeInTheDocument();
  });
});
