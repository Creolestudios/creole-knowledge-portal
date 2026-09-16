// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AIInterviewManager from './ai-interview-manager';

const originalFetch = global.fetch;

function mockFetchOnce(response: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValueOnce({
    ok,
    status,
    json: () => Promise.resolve(response),
  });
}

describe('AIInterviewManager', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('loads and displays existing interviews', async () => {
    global.fetch = mockFetchOnce({
      interviews: [
        {
          id: 'i1',
          candidate_name: 'Jane Doe',
          candidate_email: 'jane@example.com',
          job_title: 'Frontend Engineer',
          access_code: '123456',
          status: 'pending',
          expires_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
      ],
    }) as any;

    render(<AIInterviewManager />);

    expect(await screen.findByText(/Jane Doe/)).toBeInTheDocument();
  });

  it('shows an error when submitting without files', async () => {
    global.fetch = mockFetchOnce({ interviews: [] }) as any;
    render(<AIInterviewManager />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Generate Interview Link'));

    await waitFor(() => {
      expect(screen.getByText(/please attach a resume/i)).toBeInTheDocument();
    });
  });

  it('requires JD text (or a file) when a resume is attached', async () => {
    global.fetch = mockFetchOnce({ interviews: [] }) as any;
    render(<AIInterviewManager />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    const resumeInput = document.getElementById('resume-upload') as HTMLInputElement;
    fireEvent.change(resumeInput, {
      target: { files: [new File(['resume'], 'resume.pdf', { type: 'application/pdf' })] },
    });

    fireEvent.click(screen.getByText('Generate Interview Link'));

    await waitFor(() => {
      expect(screen.getByText(/paste the job description text/i)).toBeInTheDocument();
    });
  });

  it('creates an interview and shows the link + passcode', async () => {
    const listFetch = mockFetchOnce({ interviews: [] });
    const createFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          interviewId: 'i1',
          link: 'http://localhost/interview/i1',
          accessCode: '654321',
        }),
    });
    const refetchFetch = mockFetchOnce({ interviews: [] });

    global.fetch = vi
      .fn()
      .mockImplementationOnce(listFetch)
      .mockImplementationOnce(createFetch)
      .mockImplementationOnce(refetchFetch) as any;

    render(<AIInterviewManager />);
    await waitFor(() => expect(listFetch).toHaveBeenCalled());

    const resumeInput = document.getElementById('resume-upload') as HTMLInputElement;
    fireEvent.change(resumeInput, {
      target: { files: [new File(['resume'], 'resume.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.change(screen.getByPlaceholderText('Paste the job description here...'), {
      target: { value: 'We are hiring a great engineer.' },
    });

    fireEvent.click(screen.getByText('Generate Interview Link'));

    expect(await screen.findByText('654321')).toBeInTheDocument();
    expect(screen.getByText('http://localhost/interview/i1')).toBeInTheDocument();
  });

  it('creates an interview using an uploaded JD file when file mode is selected', async () => {
    const listFetch = mockFetchOnce({ interviews: [] });
    const createFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          interviewId: 'i2',
          link: 'http://localhost/interview/i2',
          accessCode: '111222',
        }),
    });
    const refetchFetch = mockFetchOnce({ interviews: [] });

    global.fetch = vi
      .fn()
      .mockImplementationOnce(listFetch)
      .mockImplementationOnce(createFetch)
      .mockImplementationOnce(refetchFetch) as any;

    render(<AIInterviewManager />);
    await waitFor(() => expect(listFetch).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Upload File'));

    const resumeInput = document.getElementById('resume-upload') as HTMLInputElement;
    const jdInput = document.getElementById('jd-upload') as HTMLInputElement;
    fireEvent.change(resumeInput, {
      target: { files: [new File(['resume'], 'resume.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.change(jdInput, {
      target: { files: [new File(['jd'], 'jd.pdf', { type: 'application/pdf' })] },
    });

    fireEvent.click(screen.getByText('Generate Interview Link'));

    expect(await screen.findByText('111222')).toBeInTheDocument();
  });

  it('surfaces the server error message when creation fails', async () => {
    const listFetch = mockFetchOnce({ interviews: [] });
    const createFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'Resume is required' }),
    });

    global.fetch = vi.fn().mockImplementationOnce(listFetch).mockImplementationOnce(createFetch) as any;

    render(<AIInterviewManager />);
    await waitFor(() => expect(listFetch).toHaveBeenCalled());

    const resumeInput = document.getElementById('resume-upload') as HTMLInputElement;
    fireEvent.change(resumeInput, {
      target: { files: [new File(['resume'], 'resume.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.change(screen.getByPlaceholderText('Paste the job description here...'), {
      target: { value: 'We are hiring a great engineer.' },
    });

    fireEvent.click(screen.getByText('Generate Interview Link'));

    expect(await screen.findByText('Resume is required')).toBeInTheDocument();
  });
});
