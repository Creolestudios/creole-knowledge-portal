// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ResumeJDUploader } from './resume-jd-uploader';

function renderUploader(onExtracted = vi.fn()) {
  const setIsLoading = vi.fn();
  const utils = render(
    <ResumeJDUploader onExtracted={onExtracted} isLoading={false} setIsLoading={setIsLoading} />,
  );
  return { ...utils, onExtracted, setIsLoading };
}

describe('ResumeJDUploader — extraction step, hands off to question selection', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders a single analyze button, no separate generate/session buttons', () => {
    renderUploader();
    expect(screen.getByText('Analyze Resume & JD')).toBeInTheDocument();
    expect(screen.queryByText('Generate Interview Link')).not.toBeInTheDocument();
    expect(screen.queryByText(/Create Session/i)).not.toBeInTheDocument();
  });

  it('requires both resume and JD text before allowing extraction', async () => {
    renderUploader();
    fireEvent.click(screen.getByText('Analyze Resume & JD'));
    await waitFor(() =>
      expect(
        screen.getByText('Please provide both a Resume (file or text) and a Job Description (file or text).'),
      ).toBeInTheDocument(),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('on success: extracts keywords and reports the extraction via onExtracted', async () => {
    const extraction = {
      candidateProfile: { name: 'Jane', extractedSkills: [], domains: [] },
      jdRequirements: { mustHaveSkills: [], niceToHaveSkills: [], keyResponsibilities: [] },
      analysis: { matchPercentage: 80, matchedKeywords: [], missingKeywords: [], resumeOnlyKeywords: [], skillGapSummary: '', keyStrengths: [], improvementAreas: [] },
      extractedAt: new Date().toISOString(),
    };
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => extraction,
    });

    const onExtracted = vi.fn();
    renderUploader(onExtracted);

    fireEvent.click(screen.getAllByText('Paste Text')[0]);
    const textareas = screen.getAllByPlaceholderText(/Paste (candidate resume|Job Description)/);
    fireEvent.change(textareas[0], { target: { value: 'resume text' } });

    const pasteButtons = screen.getAllByText('Paste Text');
    fireEvent.click(pasteButtons[1]);
    const textareasAfter = screen.getAllByPlaceholderText(/Paste (candidate resume|Job Description)/);
    fireEvent.change(textareasAfter[1], { target: { value: 'jd text' } });

    fireEvent.click(screen.getByText('Analyze Resume & JD'));

    await waitFor(() => expect(onExtracted).toHaveBeenCalledWith(extraction));
    expect(fetch).toHaveBeenCalledWith('/api/ai-interview/extract', expect.objectContaining({ method: 'POST' }));
  });

  it('on extraction failure: shows the error and does not call onExtracted', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Gemini could not parse the resume' }),
    });
    const onExtracted = vi.fn();
    renderUploader(onExtracted);

    fireEvent.click(screen.getAllByText('Paste Text')[0]);
    fireEvent.change(screen.getAllByPlaceholderText(/Paste (candidate resume|Job Description)/)[0], {
      target: { value: 'resume text' },
    });
    fireEvent.click(screen.getAllByText('Paste Text')[1]);
    fireEvent.change(screen.getAllByPlaceholderText(/Paste (candidate resume|Job Description)/)[1], {
      target: { value: 'jd text' },
    });

    fireEvent.click(screen.getByText('Analyze Resume & JD'));

    await waitFor(() => expect(screen.getByText('Gemini could not parse the resume')).toBeInTheDocument());
    expect(onExtracted).not.toHaveBeenCalled();
  });

  it('handles file uploads and resetting files', async () => {
    const extraction = {
      candidateProfile: { name: 'Jane', extractedSkills: [], domains: [] },
      jdRequirements: { mustHaveSkills: [], niceToHaveSkills: [], keyResponsibilities: [] },
      analysis: { matchPercentage: 80, matchedKeywords: [], missingKeywords: [], resumeOnlyKeywords: [], skillGapSummary: '', keyStrengths: [], improvementAreas: [] },
      extractedAt: new Date().toISOString(),
    };
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => extraction,
    });

    const onExtracted = vi.fn();
    renderUploader(onExtracted);

    // Initial state is upload. Upload files.
    const fileInputs = document.querySelectorAll('input[type="file"]');
    const resumeInput = fileInputs[0];
    const jdInput = fileInputs[1];

    const resumeFile = new File(['resume'], 'resume.pdf', { type: 'application/pdf' });
    const jdFile = new File(['jd'], 'jd.pdf', { type: 'application/pdf' });

    fireEvent.change(resumeInput, { target: { files: [resumeFile] } });
    fireEvent.change(jdInput, { target: { files: [jdFile] } });

    expect(screen.getByText('resume.pdf')).toBeInTheDocument();
    expect(screen.getByText('jd.pdf')).toBeInTheDocument();

    // Click analyze
    fireEvent.click(screen.getByText('Analyze Resume & JD'));
    await waitFor(() => expect(onExtracted).toHaveBeenCalledWith(extraction));

    // Clear files
    // Find the svg icons for X
    const buttons = document.querySelectorAll('button');
    const closeButtons = Array.from(buttons).filter(b => b.innerHTML.includes('lucide-x'));
    fireEvent.click(closeButtons[0]);
    fireEvent.click(closeButtons[1]);

    // Also test upload mode buttons
    const uploadButtons = screen.getAllByText('File Upload');
    fireEvent.click(uploadButtons[0]);
    fireEvent.click(uploadButtons[1]);
  });
});
