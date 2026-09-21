// @vitest-environment jsdom
/**
 * QA scenario suite for the AI Interview module's UI:
 * - Admin "create interview" form (components/ai-interview-manager.tsx)
 * - Candidate passcode entry page (app/interview/[id]/page.tsx)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import AIInterviewManager from '@/components/ai-interview-manager';

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'interview-1' }),
}));

const { mockCreateSession } = vi.hoisted(() => ({
  mockCreateSession: vi.fn(),
}));

vi.mock('@/lib/ai-interview/create-session-and-invite', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai-interview/create-session-and-invite')>(
    '@/lib/ai-interview/create-session-and-invite',
  );
  return { ...actual, createInterviewSessionWithInvite: mockCreateSession };
});

const originalFetch = global.fetch;

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response);
}

/** URL-routed so call order (list / extract / question-bank) doesn't matter. */
function mockFetchByUrl(handlers: Record<string, unknown>) {
  return vi.fn().mockImplementation((url: string) => {
    for (const [match, response] of Object.entries(handlers)) {
      if (url.includes(match)) return jsonResponse(response);
    }
    return jsonResponse({});
  });
}

describe('Admin create-interview form — UI scenarios', () => {
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    mockCreateSession.mockReset();
  });

  it('TC-UI-01 Defaults to "paste text" mode for the job description', async () => {
    global.fetch = vi.fn().mockReturnValueOnce(jsonResponse({ interviews: [] })) as any;
    render(<AIInterviewManager />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    expect(screen.getByPlaceholderText('Paste the job description here...')).toBeInTheDocument();
    expect(screen.queryByLabelText(/upload job description/i)).not.toBeInTheDocument();
  });

  it('TC-UI-02 Switching to "Upload File" mode swaps the textarea for a file picker', async () => {
    global.fetch = vi.fn().mockReturnValueOnce(jsonResponse({ interviews: [] })) as any;
    render(<AIInterviewManager />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Upload File'));
    expect(screen.getByText('Upload Job Description')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Paste the job description here...')).not.toBeInTheDocument();
  });

  it('TC-UI-03 Blocks submission with no resume attached', async () => {
    global.fetch = vi.fn().mockReturnValueOnce(jsonResponse({ interviews: [] })) as any;
    render(<AIInterviewManager />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Analyze Resume & JD'));
    expect(await screen.findByText(/please attach a resume/i)).toBeInTheDocument();
  });

  it('TC-UI-04 Blocks submission with a resume but empty JD text', async () => {
    global.fetch = vi.fn().mockReturnValueOnce(jsonResponse({ interviews: [] })) as any;
    render(<AIInterviewManager />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    fireEvent.change(document.getElementById('resume-upload') as HTMLInputElement, {
      target: { files: [new File(['r'], 'resume.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.click(screen.getByText('Analyze Resume & JD'));
    expect(await screen.findByText(/paste the job description text/i)).toBeInTheDocument();
  });

  it('TC-UI-05 Blocks submission in file mode with no JD file selected', async () => {
    global.fetch = vi.fn().mockReturnValueOnce(jsonResponse({ interviews: [] })) as any;
    render(<AIInterviewManager />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Upload File'));
    fireEvent.change(document.getElementById('resume-upload') as HTMLInputElement, {
      target: { files: [new File(['r'], 'resume.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.click(screen.getByText('Analyze Resume & JD'));
    expect(await screen.findByText(/attach a job description file/i)).toBeInTheDocument();
  });

  const extractionPayload = {
    candidateProfile: { extractedSkills: [], domains: [] },
    jdRequirements: { mustHaveSkills: [], niceToHaveSkills: [], keyResponsibilities: [] },
    analysis: {
      matchPercentage: 80,
      matchedKeywords: [],
      missingKeywords: [],
      resumeOnlyKeywords: [],
      skillGapSummary: '',
      keyStrengths: [],
      improvementAreas: [],
    },
    extractedAt: new Date().toISOString(),
  };

  it('TC-UI-06 Successful analysis reaches question selection, then generation surfaces the link + passcode + questions', async () => {
    global.fetch = mockFetchByUrl({
      '/api/admin/ai-interviews': { interviews: [] },
      '/api/ai-interview/extract': extractionPayload,
      '/api/ai-interview/question-bank': {
        questions: [
          {
            id: 'b1',
            title: 'HR 1',
            question_text: 'Introduce yourself.',
            category: 'hr',
            difficulty: 'easy',
            is_mandatory: false,
            default_order: 1,
          },
        ],
      },
    }) as any;
    mockCreateSession.mockResolvedValue({
      extraction: extractionPayload,
      session: { id: 's1', status: 'questions_generated' },
      questions: [{ id: 'q1', question_text: 'Introduce yourself.' }],
      invite: { invite_url: 'http://x/assess/tok', passcode: '987654' },
    });

    render(<AIInterviewManager />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    fireEvent.change(document.getElementById('resume-upload') as HTMLInputElement, {
      target: { files: [new File(['r'], 'resume.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.change(screen.getByPlaceholderText('Paste the job description here...'), {
      target: { value: 'A job description.' },
    });
    fireEvent.click(screen.getByText('Analyze Resume & JD'));

    await screen.findByText('Select Interview Questions');
    fireEvent.change(await screen.findByLabelText(/Total question count/i), { target: { value: '1' } });
    fireEvent.click(screen.getByText('hr'));
    fireEvent.click(screen.getByText('Introduce yourself.'));
    fireEvent.click(screen.getByText('Generate Interview Link'));

    expect(await screen.findByDisplayValue('987654')).toBeInTheDocument();
    expect(screen.getByDisplayValue('http://x/assess/tok')).toBeInTheDocument();
  });

  it('TC-UI-07 A backend validation error from analysis is surfaced to the admin verbatim', async () => {
    global.fetch = vi
      .fn()
      .mockReturnValueOnce(jsonResponse({ interviews: [] }))
      .mockReturnValueOnce(jsonResponse({ error: 'Job description text too long (max 20,000 characters)' }, false)) as any;

    render(<AIInterviewManager />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    fireEvent.change(document.getElementById('resume-upload') as HTMLInputElement, {
      target: { files: [new File(['r'], 'resume.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.change(screen.getByPlaceholderText('Paste the job description here...'), {
      target: { value: 'A job description.' },
    });
    fireEvent.click(screen.getByText('Analyze Resume & JD'));

    expect(await screen.findByText(/job description text too long/i)).toBeInTheDocument();
    expect(screen.queryByText('Select Interview Questions')).not.toBeInTheDocument();
  });

  it('TC-UI-08 Network failure during analysis shows a generic error, not a crash', async () => {
    global.fetch = vi
      .fn()
      .mockReturnValueOnce(jsonResponse({ interviews: [] }))
      .mockImplementationOnce(() => Promise.reject(new Error('network down'))) as any;

    render(<AIInterviewManager />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    fireEvent.change(document.getElementById('resume-upload') as HTMLInputElement, {
      target: { files: [new File(['r'], 'resume.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.change(screen.getByPlaceholderText('Paste the job description here...'), {
      target: { value: 'A job description.' },
    });
    fireEvent.click(screen.getByText('Analyze Resume & JD'));

    // The component surfaces the thrown error's message verbatim rather than
    // a generic fallback — still an inline message, not a crash.
    expect(await screen.findByText('network down')).toBeInTheDocument();
  });

  it('TC-UI-09 Renders an empty state when no interviews exist yet', async () => {
    global.fetch = vi.fn().mockReturnValueOnce(jsonResponse({ interviews: [] })) as any;
    render(<AIInterviewManager />);
    expect(await screen.findByText('No interviews created yet.')).toBeInTheDocument();
  });

  it('TC-UI-10 Renders a status badge for each interview in the recent list', async () => {
    global.fetch = vi.fn().mockReturnValueOnce(
      jsonResponse({
        interviews: [
          {
            id: 'i1',
            candidate_name: 'Jane Doe',
            candidate_email: 'jane@x.com',
            job_title: 'Backend Engineer',
            access_code: '123456',
            status: 'completed',
            expires_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
          },
        ],
      }),
    ) as any;
    render(<AIInterviewManager />);
    expect(await screen.findByText('Jane Doe', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Candidate passcode entry page
// ---------------------------------------------------------------------------
import InterviewEntryPage from '@/app/interview/[id]/page';

describe('Candidate passcode entry page — UI scenarios', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('TC-UI-11 Strips non-digit characters as the candidate types', () => {
    render(<InterviewEntryPage />);
    const input = screen.getByPlaceholderText('000000') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'a1b2c3d4' } });
    expect(input.value).toBe('1234');
  });

  it('TC-UI-12 Disables Continue until exactly 6 digits are entered', () => {
    render(<InterviewEntryPage />);
    const input = screen.getByPlaceholderText('000000') as HTMLInputElement;
    const button = screen.getByText('Continue').closest('button')!;

    fireEvent.change(input, { target: { value: '123' } });
    expect(button).toBeDisabled();

    fireEvent.change(input, { target: { value: '123456' } });
    expect(button).not.toBeDisabled();
  });

  it('TC-UI-13 Shows the server error message on an incorrect passcode', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'Incorrect passcode' }) }) as any;
    render(<InterviewEntryPage />);

    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '000000' } });
    fireEvent.click(screen.getByText('Continue'));

    expect(await screen.findByText('Incorrect passcode')).toBeInTheDocument();
  });

  it('TC-UI-14 Shows the instructions/permissions gate on a correct passcode', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ verified: true }) }) as any;
    render(<InterviewEntryPage />);

    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '123456' } });
    fireEvent.click(screen.getByText('Continue'));

    expect(await screen.findByText('Before you begin')).toBeInTheDocument();
    expect(screen.getByText('Allow & Start Interview')).toBeInTheDocument();
  });

  it('TC-UI-15 A network failure during verification shows a generic error, not a crash', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as any;
    render(<InterviewEntryPage />);

    fireEvent.change(screen.getByPlaceholderText('000000'), { target: { value: '123456' } });
    fireEvent.click(screen.getByText('Continue'));

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
  });
});
