// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import AIInterviewManager from './ai-interview-manager';
import { SessionGenerationError } from '@/lib/ai-interview/create-session-and-invite';

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

function mockFetchOnce(response: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValueOnce({
    ok,
    status,
    json: () => Promise.resolve(response),
  });
}

/**
 * The list fetch fires on mount; the question bank fetch fires once the
 * question-bank selector mounts after a successful analysis. Both are
 * URL-routed so call order doesn't matter.
 */
function mockFetchByUrl(handlers: Record<string, unknown>) {
  return vi.fn().mockImplementation((url: string) => {
    for (const [match, response] of Object.entries(handlers)) {
      if (url.includes(match)) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(response) });
      }
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

async function attachResumeAndJd() {
  fireEvent.change(document.getElementById('candidate-name') as HTMLInputElement, { target: { value: 'John Doe' } });
  fireEvent.change(document.getElementById('candidate-email') as HTMLInputElement, { target: { value: 'john@example.com' } });
  fireEvent.change(document.getElementById('resume-upload') as HTMLInputElement, {
    target: { files: [new File(['resume'], 'resume.pdf', { type: 'application/pdf' })] },
  });
  fireEvent.change(screen.getByPlaceholderText('Paste the job description here...'), {
    target: { value: 'We are hiring a great engineer.' },
  });
}

describe('AIInterviewManager', () => {
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    mockCreateSession.mockReset();
  });

  it('loads and displays existing interviews', async () => {
    global.fetch = mockFetchOnce({
      interviews: [
        {
          id: 'i1',
          candidate_name: 'Jane Doe',
          candidate_email: 'jane@example.com',
          job_title: 'Frontend Engineer',
          status: 'pending',
          expires_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
      ],
    }) as any;

    render(<AIInterviewManager />);

    expect(await screen.findByText(/Jane Doe/)).toBeInTheDocument();
  });

  it('displays only the 10 most recent interviews when more than 10 are returned', async () => {
    const mockList = Array.from({ length: 15 }, (_, i) => ({
      id: `session-${i}`,
      candidate_name: `Candidate ${i + 1}`,
      candidate_email: `candidate${i + 1}@example.com`,
      job_title: 'Software Engineer',
      status: 'pending',
      expires_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }));

    global.fetch = mockFetchByUrl({
      '/api/admin/ai-interviews': { interviews: mockList },
    }) as any;

    render(<AIInterviewManager />);

    expect(await screen.findByText('Candidate 1')).toBeInTheDocument();
    expect(screen.getByText('Candidate 10')).toBeInTheDocument();
    expect(screen.queryByText('Candidate 11')).not.toBeInTheDocument();
  });

  it('renders interview status without View Report or Video buttons in recent interviews', async () => {
    global.fetch = mockFetchByUrl({
      '/api/admin/ai-interviews': {
        interviews: [
          {
            id: 'term-1',
            candidate_name: 'Priya',
            candidate_email: 'priya@example.com',
            job_title: 'Senior AI Developer',
            status: 'terminated',
            expires_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            recording_url: 'https://drive.google.com/file/d/test1234/view',
          },
        ],
      },
    }) as any;

    render(<AIInterviewManager />);

    expect(await screen.findByText('Priya')).toBeInTheDocument();
    expect(screen.getByText('terminated')).toBeInTheDocument();
    expect(screen.queryByText(/View Report/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Video/i)).not.toBeInTheDocument();
  });

  it('shows an error when submitting without candidate name', async () => {
    global.fetch = mockFetchOnce({ interviews: [] }) as any;
    render(<AIInterviewManager />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(screen.getByText(/please enter the candidate name/i)).toBeInTheDocument();
    }).catch(e => {
      console.log('DOM dump:', document.body.innerHTML);
      throw e;
    });
  });

  it('shows an error when submitting with invalid email', async () => {
    global.fetch = mockFetchOnce({ interviews: [] }) as any;
    render(<AIInterviewManager />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    fireEvent.change(document.getElementById('candidate-name') as HTMLInputElement, { target: { value: 'John Doe' } });
    fireEvent.change(document.getElementById('candidate-email') as HTMLInputElement, { target: { value: 'priya' } });
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(screen.getByText(/please enter a valid email address/i)).toBeInTheDocument();
    });
  });

  it('shows an error when submitting without files', async () => {
    global.fetch = mockFetchOnce({ interviews: [] }) as any;
    render(<AIInterviewManager />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    fireEvent.change(document.getElementById('candidate-name') as HTMLInputElement, { target: { value: 'John Doe' } });
    fireEvent.change(document.getElementById('candidate-email') as HTMLInputElement, { target: { value: 'john@example.com' } });
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => {
      expect(screen.getByText(/please attach a resume/i)).toBeInTheDocument();
    });
  });

  it('requires JD text (or a file) when a resume is attached', async () => {
    global.fetch = mockFetchOnce({ interviews: [] }) as any;
    render(<AIInterviewManager />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    fireEvent.change(document.getElementById('candidate-name') as HTMLInputElement, { target: { value: 'John Doe' } });
    fireEvent.change(document.getElementById('candidate-email') as HTMLInputElement, { target: { value: 'john@example.com' } });

    const resumeInput = document.getElementById('resume-upload') as HTMLInputElement;
    fireEvent.change(resumeInput, {
      target: { files: [new File(['resume'], 'resume.pdf', { type: 'application/pdf' })] },
    });

    fireEvent.click(screen.getByText('Analyze Resume & JD'));

    await waitFor(() => {
      expect(screen.getByText(/paste the job description text/i)).toBeInTheDocument();
    });
  });

  const extractionPayload = {
    candidateProfile: { extractedSkills: [], domains: [] },
    jdRequirements: { mustHaveSkills: [], niceToHaveSkills: [], keyResponsibilities: [] },
    analysis: {
      matchPercentage: 70,
      matchedKeywords: [],
      missingKeywords: [],
      resumeOnlyKeywords: [],
      skillGapSummary: '',
      keyStrengths: [],
      improvementAreas: [],
    },
    extractedAt: new Date().toISOString(),
  };

  it('analyzing the resume/JD shows the analysis and hands off to question selection', async () => {
    global.fetch = mockFetchByUrl({
      '/api/admin/ai-interviews': { interviews: [] },
      '/api/ai-interview/extract': extractionPayload,
      '/api/ai-interview/question-bank': { questions: [] },
    }) as any;

    render(<AIInterviewManager />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    await attachResumeAndJd();
    fireEvent.click(screen.getByText('Analyze Resume & JD'));

    // The keyword analysis from the extract call is shown...
    expect(await screen.findByText('Candidate & JD Skill Analysis')).toBeInTheDocument();
    // ...and the admin now picks exact questions instead of getting an
    // immediate link — no interview is created until they do.
    expect(await screen.findByText('Select Interview Questions')).toBeInTheDocument();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('analyzes using an uploaded JD file when file mode is selected', async () => {
    global.fetch = mockFetchByUrl({
      '/api/admin/ai-interviews': { interviews: [] },
      '/api/ai-interview/extract': extractionPayload,
      '/api/ai-interview/question-bank': { questions: [] },
    }) as any;

    render(<AIInterviewManager />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Upload File'));

    fireEvent.change(document.getElementById('candidate-name') as HTMLInputElement, { target: { value: 'John Doe' } });
    fireEvent.change(document.getElementById('candidate-email') as HTMLInputElement, { target: { value: 'john@example.com' } });

    const resumeInput = document.getElementById('resume-upload') as HTMLInputElement;
    const jdInput = document.getElementById('jd-upload') as HTMLInputElement;
    fireEvent.change(resumeInput, {
      target: { files: [new File(['resume'], 'resume.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.change(jdInput, {
      target: { files: [new File(['jd'], 'jd.pdf', { type: 'application/pdf' })] },
    });

    fireEvent.click(screen.getByText('Analyze Resume & JD'));

    expect(await screen.findByText('Select Interview Questions')).toBeInTheDocument();
  });

  it('surfaces the analysis error message when extraction fails, without reaching question selection', async () => {
    const listFetch = mockFetchOnce({ interviews: [] });
    const extractFetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'Could not read the resume file' }),
    });

    global.fetch = vi.fn().mockImplementationOnce(listFetch).mockImplementationOnce(extractFetch) as any;

    render(<AIInterviewManager />);
    await waitFor(() => expect(listFetch).toHaveBeenCalled());

    await attachResumeAndJd();
    fireEvent.click(screen.getByText('Analyze Resume & JD'));

    expect(await screen.findByText('Could not read the resume file')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Select Interview Questions')).not.toBeInTheDocument();
  });

  it('completing question selection creates the session/invite and shows the link + passcode + questions', async () => {
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

    const sessionResult = {
      extraction: extractionPayload,
      session: { id: 's1', status: 'questions_generated' },
      questions: [{ id: 'q1', question_text: 'Introduce yourself.' }],
      invite: { invite_url: 'http://localhost/interview/tok', passcode: '654321' },
    };
    mockCreateSession.mockResolvedValue(sessionResult);

    render(<AIInterviewManager />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    await attachResumeAndJd();
    fireEvent.click(screen.getByText('Analyze Resume & JD'));
    await screen.findByText('Select Interview Questions');

    fireEvent.change(await screen.findByLabelText(/Total question count/i), { target: { value: '1' } });
    fireEvent.click(screen.getByText('hr'));
    fireEvent.click(screen.getByText('Introduce yourself.'));
    fireEvent.click(screen.getByText('Generate Interview Link'));

    expect(await screen.findByDisplayValue('654321')).toBeInTheDocument();
    expect(screen.getByDisplayValue('http://localhost/interview/tok')).toBeInTheDocument();
    expect(screen.getByText('Introduce yourself.')).toBeInTheDocument();
  });

  it('surfaces a stage-specific error when session/invite creation fails after question selection', async () => {
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
    mockCreateSession.mockRejectedValue(new SessionGenerationError('session', 'Resume is required'));

    render(<AIInterviewManager />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    await attachResumeAndJd();
    fireEvent.click(screen.getByText('Analyze Resume & JD'));
    await screen.findByText('Select Interview Questions');

    fireEvent.change(await screen.findByLabelText(/Total question count/i), { target: { value: '1' } });
    fireEvent.click(screen.getByText('hr'));
    fireEvent.click(screen.getByText('Introduce yourself.'));
    fireEvent.click(screen.getByText('Generate Interview Link'));

    expect(await screen.findByText(/Resume is required/)).toBeInTheDocument();
  });

  it('opens a link + passcode popup when a recent interview name is clicked, and closes it', async () => {
    global.fetch = mockFetchByUrl({
      '/api/admin/ai-interviews': {
        interviews: [
          {
            id: 'i1',
            candidate_name: 'Jane Doe',
            candidate_email: 'jane@example.com',
            job_title: 'Frontend Engineer',
            status: 'pending',
            expires_at: null,
            created_at: new Date().toISOString(),
          },
        ],
      },
      '/api/interviews/i1/invite': { invite_url: 'http://localhost/interview/tok', passcode: '123456' },
    }) as any;

    render(<AIInterviewManager />);
    const nameButton = await screen.findByText('Jane Doe');
    fireEvent.click(nameButton);

    expect(await screen.findByText('123456')).toBeInTheDocument();
    expect(screen.getByText(/\/interview\/tok/)).toBeInTheDocument();

    fireEvent.click(document.getElementById('interview-link-modal-close')!);
    await waitFor(() => expect(screen.queryByText('123456')).not.toBeInTheDocument());
  });

  it('copies the link and passcode from the popup', async () => {
    global.fetch = mockFetchByUrl({
      '/api/admin/ai-interviews': {
        interviews: [
          {
            id: 'i1',
            candidate_name: null,
            candidate_email: null,
            job_title: null,
            status: 'pending',
            expires_at: null,
            created_at: new Date().toISOString(),
          },
        ],
      },
      '/api/interviews/i1/invite': { invite_url: 'http://localhost/interview/tok', passcode: '654321' },
    }) as any;

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<AIInterviewManager />);
    fireEvent.click(await screen.findByText('Unnamed candidate'));

    await screen.findByText('654321');
    fireEvent.click(document.getElementById('interview-link-modal-copy-code')!);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('654321'));

    fireEvent.click(document.getElementById('interview-link-modal-copy-link')!);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('http://localhost/interview/tok'));
  });

  it('allows toggling bypass proctoring with confirmation dialog when not submitting', async () => {
    global.fetch = mockFetchByUrl({
      '/api/admin/ai-interviews': { interviews: [] },
    }) as any;

    render(<AIInterviewManager />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    const toggleBtn = document.getElementById('bypass-proctoring-toggle') as HTMLButtonElement;
    expect(toggleBtn.getAttribute('aria-checked')).toBe('true');

    // Clicking toggle when active should toggle it off without modal
    fireEvent.click(toggleBtn);
    expect(toggleBtn.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByText('Confirm Bypass Proctoring')).not.toBeInTheDocument();

    // Clicking toggle when off should open confirm modal
    fireEvent.click(toggleBtn);
    expect(await screen.findByText('Confirm Bypass Proctoring')).toBeInTheDocument();

    // Confirm bypass
    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(() => {
      expect(screen.queryByText('Confirm Bypass Proctoring')).not.toBeInTheDocument();
      expect(toggleBtn.getAttribute('aria-checked')).toBe('true');
    });
  });

  it('disables the bypass proctoring toggle during analysis and prevents showing confirmation popup', async () => {
    let resolveExtract: (val: any) => void;
    const extractPromise = new Promise((resolve) => {
      resolveExtract = resolve;
    });

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/admin/ai-interviews')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ interviews: [] }) });
      }
      if (url.includes('/api/ai-interview/extract')) {
        return extractPromise;
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    }) as any;

    render(<AIInterviewManager />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    const toggleBtn = document.getElementById('bypass-proctoring-toggle') as HTMLButtonElement;
    const labelSpan = document.getElementById('bypass-proctoring-label') as HTMLSpanElement;

    expect(toggleBtn).toBeInTheDocument();
    expect(toggleBtn).not.toBeDisabled();
    expect(toggleBtn.getAttribute('aria-checked')).toBe('true');

    await attachResumeAndJd();

    // Click Analyze button
    fireEvent.click(screen.getByText('Analyze Resume & JD'));

    // During analysis, toggle must be disabled
    await waitFor(() => {
      expect(toggleBtn).toBeDisabled();
    });

    // Clicking the disabled toggle or label while submitting should NOT open confirmation modal
    fireEvent.click(toggleBtn);
    expect(screen.queryByText('Confirm Bypass Proctoring')).not.toBeInTheDocument();
    expect(toggleBtn.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(labelSpan);
    expect(screen.queryByText('Confirm Bypass Proctoring')).not.toBeInTheDocument();
    expect(toggleBtn.getAttribute('aria-checked')).toBe('true');

    // Resolve the extract call to complete submission
    resolveExtract!({
      ok: true,
      json: () => Promise.resolve(extractionPayload),
    });

    // Once finished, analysis view is shown
    expect(await screen.findByText('Candidate & JD Skill Analysis')).toBeInTheDocument();
  });
});

