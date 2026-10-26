// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProctoringInstructions } from '@/components/ai-interview/proctoring-instructions';

describe('Proctoring Instructions & Notes Page Policy', () => {
  it('displays the 3-Warning Termination Policy and 30-Second Auto-Resume in the instructions', () => {
    render(
      <ProctoringInstructions
        cameraGranted={true}
        screenGranted={true}
        permissionError={null}
        requestingPermissions={false}
        onRequestPermissions={vi.fn()}
      />
    );

    // 1. Check compulsory instructions
    expect(
      screen.getByText(/3-Warning Termination Policy: Any proctoring infraction triggers a strike/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/On the 3rd warning, the interview is immediately and permanently terminated with no option to resume/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/30-Second Auto-Resume: If an infraction pauses your interview/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/If not clicked within 30 seconds, the session will automatically resume/i)
    ).toBeInTheDocument();

    // 2. Check active detections notice card
    expect(
      screen.getByText(/Warnings 1 & 2 offer a 30s resume window \(auto-resumes if unclicked\)\. A 3rd warning terminates the interview immediately with no resume alert\./i)
    ).toBeInTheDocument();

    // 3. Check badge shows standard active proctoring
    expect(screen.getByText(/Active AI Proctoring/i)).toBeInTheDocument();
  });

  it('hides 3-Warning Termination Policy and 30-Second Auto-Resume when isBypass is true', () => {
    render(
      <ProctoringInstructions
        cameraGranted={true}
        screenGranted={true}
        permissionError={null}
        requestingPermissions={false}
        onRequestPermissions={vi.fn()}
        isBypass={true}
      />
    );

    // 1. Check that termination and pause instructions are NOT in the document
    expect(
      screen.queryByText(/3-Warning Termination Policy/i)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/On the 3rd warning, the interview is immediately and permanently terminated with no option to resume/i)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/30-Second Auto-Resume/i)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/If not clicked within 30 seconds, the session will automatically resume/i)
    ).not.toBeInTheDocument();

    // 2. Check active detections notice card does NOT have 3-warning termination rule
    expect(
      screen.queryByText(/Warnings 1 & 2 offer a 30s resume window/i)
    ).not.toBeInTheDocument();

    // 3. Compulsory non-termination guidelines still present
    expect(
      screen.getByText(/Find a quiet, well-lit room and sit facing your camera directly/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Do not switch tabs, minimize the window, or open other applications/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Answer every question yourself in your own voice/i)
    ).toBeInTheDocument();

    // 4. Badge reflects bypass mode
    expect(
      screen.getByText(/Warning Bypass Enabled/i)
    ).toBeInTheDocument();
  });
});
