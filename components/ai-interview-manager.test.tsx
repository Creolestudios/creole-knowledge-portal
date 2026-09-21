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

    fireEvent.click(screen.getByText('Analyze Resume & JD'));

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
      invite: { invite_url: 'http://localhost/assess/tok', passcode: '654321' },
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
    expect(screen.getByDisplayValue('http://localhost/assess/tok')).toBeInTheDocument();
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
    const nameButton = await screen.findByText('Jane Doe');
    fireEvent.click(nameButton);

    expect(await screen.findByText('123456')).toBeInTheDocument();
    expect(screen.getByText(/\/interview\/i1/)).toBeInTheDocument();

    fireEvent.click(document.getElementById('interview-link-modal-close')!);
    await waitFor(() => expect(screen.queryByText('123456')).not.toBeInTheDocument());
  });

  it('copies the link and passcode from the popup', async () => {
    global.fetch = mockFetchOnce({
      interviews: [
        {
          id: 'i1',
          candidate_name: null,
          candidate_email: null,
          job_title: null,
          access_code: '654321',
          status: 'pending',
          expires_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
      ],
    }) as any;

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<AIInterviewManager />);
    fireEvent.click(await screen.findByText('Unnamed candidate'));

    fireEvent.click(document.getElementById('interview-link-modal-copy-code')!);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('654321'));

    fireEvent.click(document.getElementById('interview-link-modal-copy-link')!);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/interview/i1')));
  });
});
