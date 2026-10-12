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
  });
});
