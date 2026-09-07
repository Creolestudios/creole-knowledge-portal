// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QuizCameraPreview } from './quiz-camera-preview';

describe('QuizCameraPreview', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders nothing when not visible', () => {
    const { container } = render(<QuizCameraPreview stream={null} visible={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a mirrored video when a stream is visible', () => {
    const track = { stop: vi.fn(), kind: 'video' };
    const stream = {
      getVideoTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream;

    render(<QuizCameraPreview stream={stream} visible />);
    expect(screen.getByLabelText('Your camera preview')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
    const video = document.querySelector('video');
    expect(video).toBeTruthy();
    expect(video?.className).toContain('scale-x-[-1]');
  });
});
