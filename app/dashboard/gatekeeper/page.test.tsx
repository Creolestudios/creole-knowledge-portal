// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GatekeeperPage from './page';

const mockPush = vi.fn();
const mockRouter = { push: mockPush };
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn().mockReturnValue({
    auth: { getUser: (...args: any[]) => mockGetUser(...args), signOut: vi.fn().mockResolvedValue({}) },
  }),
}));

function submission(overrides: Partial<any> = {}) {
  return {
    id: 'sub-1',
    title: 'My Article',
    content: 'body',
    author: 'dev@creolestudios.com',
    status: 'PENDING_QUIZ',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    quiz: {
      questions: [
        { id: 'q1', question: 'Q1?', options: ['A', 'B'], correctOptionIndex: 0 },
        { id: 'q2', question: 'Q2?', options: ['A', 'B'], correctOptionIndex: 1 },
        { id: 'q3', question: 'Q3?', options: ['A', 'B'], correctOptionIndex: 0 },
      ],
    },
    ...overrides,
  };
}

function fetchImpl(map: Record<string, any>) {
  return vi.fn().mockImplementation((url: string, opts?: any) => {
    if (url === '/api/submissions' && (!opts || opts.method === undefined)) {
      return Promise.resolve({ ok: true, json: async () => ({ submissions: map.list ?? [] }) });
    }
    if (url === '/api/submissions' && opts?.method === 'POST') {
      return Promise.resolve(map.submitPost ?? { ok: true, json: async () => ({ submission: submission() }) });
    }
    if (url.includes('/quiz')) {
      return Promise.resolve(map.quizPost ?? { ok: true, json: async () => ({ submission: { ...submission(), status: 'APPROVED', quiz: { score: 3 } } }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

describe('GatekeeperPage', () => {
  const originalFetch = global.fetch;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('redirects to login when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    global.fetch = fetchImpl({});
    render(<GatekeeperPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/');
    });
  });

  it('shows the empty submission-history state', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'dev@x.com' } } });
    global.fetch = fetchImpl({ list: [] });
    render(<GatekeeperPage />);

    await waitFor(() => {
      expect(screen.getByText('No submissions yet')).toBeInTheDocument();
    });
  });

  it('lists past submissions with their status badge', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'dev@x.com' } } });
    global.fetch = fetchImpl({ list: [submission({ status: 'APPROVED' })] });
    render(<GatekeeperPage />);

    await waitFor(() => {
      expect(screen.getByText('My Article')).toBeInTheDocument();
    });
    expect(screen.getByText('Approved')).toBeInTheDocument();
  });

  it('switches to the submit-new-blog tab and shows the form', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'dev@x.com' } } });
    global.fetch = fetchImpl({ list: [] });
    render(<GatekeeperPage />);
    await waitFor(() => screen.getByText('No submissions yet'));

    fireEvent.click(screen.getByText('Submit New Blog'));
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Building micro-frontends/)).toBeInTheDocument();
    });
  });

  it('submits a new blog through the AI screening sequence and opens the generated quiz', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'dev@x.com' } } });
    global.fetch = fetchImpl({ list: [], submitPost: { ok: true, json: async () => ({ submission: submission() }) } });

    render(<GatekeeperPage />);
    await waitFor(() => screen.getByText('No submissions yet'));
    fireEvent.click(screen.getByText('Submit New Blog'));
    await waitFor(() => screen.getByPlaceholderText(/Building micro-frontends/));

    fireEvent.change(screen.getByPlaceholderText(/Building micro-frontends/), { target: { value: 'A New Post' } });
    fireEvent.change(screen.getByPlaceholderText(/Write or paste your markdown/), {
      target: { value: 'Some markdown body content.' },
    });
    fireEvent.click(screen.getByText('Submit to Gatekeeper'));

    expect(screen.getByText('AI Gatekeeper Screening')).toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.getByText('Quiz: My Article')).toBeInTheDocument();
      },
      { timeout: 6000 },
    );
  }, 10000);

  it('takes the quiz, passes, and returns to submission history', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'dev@x.com' } } });
    global.fetch = fetchImpl({
      list: [submission()],
      quizPost: {
        ok: true,
        json: async () => ({ submission: { ...submission(), status: 'APPROVED', quiz: { score: 3 } } }),
      },
    });

    render(<GatekeeperPage />);
    await waitFor(() => screen.getByText('My Article'));
    fireEvent.click(screen.getByText('Take Verification Quiz'));

    await waitFor(() => screen.getByText('Quiz: My Article'));

    // Answer all three questions by clicking the first option in each group.
    const optionGroups = document.querySelectorAll('.grid.grid-cols-1.md\\:grid-cols-2');
    optionGroups.forEach((group) => {
      const firstOption = group.querySelector('button');
      if (firstOption) fireEvent.click(firstOption);
    });

    fireEvent.click(screen.getByText('Submit Answers'));

    await waitFor(() => {
      expect(screen.getByText('Author Verification Succeeded!')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Back to Submissions'));
    await waitFor(() => {
      expect(screen.getByText('My Article')).toBeInTheDocument();
    });
  });

  it('requires all quiz questions to be answered before submitting', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'dev@x.com' } } });
    global.fetch = fetchImpl({ list: [submission()] });

    render(<GatekeeperPage />);
    await waitFor(() => screen.getByText('My Article'));
    fireEvent.click(screen.getByText('Take Verification Quiz'));
    await waitFor(() => screen.getByText('Quiz: My Article'));

    fireEvent.click(screen.getByText('Submit Answers'));

    await waitFor(() => {
      expect(screen.getByText('Please answer all questions before submitting.')).toBeInTheDocument();
    });
  });

  it('exits the active quiz via "Back to Dashboard"', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'dev@x.com' } } });
    global.fetch = fetchImpl({ list: [submission()] });

    render(<GatekeeperPage />);
    await waitFor(() => screen.getByText('My Article'));
    fireEvent.click(screen.getByText('Take Verification Quiz'));
    await waitFor(() => screen.getByText('Quiz: My Article'));

    fireEvent.click(screen.getByText('Back to Dashboard'));
    await waitFor(() => {
      expect(screen.getByText('My Article')).toBeInTheDocument();
    });
  });

  it('handles navigation clicks in the sidebar', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'dev@x.com' } } });
    global.fetch = fetchImpl({ list: [] });
    render(<GatekeeperPage />);
    await waitFor(() => screen.getByText('Morning Brief'));

    fireEvent.click(screen.getByText('Morning Brief'));
    expect(mockPush).toHaveBeenCalledWith('/dashboard');

    fireEvent.click(screen.getByText('Blog Submissions'));
    expect(mockPush).toHaveBeenCalledWith('/dashboard/gatekeeper');

    fireEvent.click(screen.getByText('My Quizzes'));
    expect(mockPush).toHaveBeenCalledWith('/dashboard/quizzes');
  });

  it('switches to submit tab when "Create First Submission" is clicked', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'dev@x.com' } } });
    global.fetch = fetchImpl({ list: [] });
    render(<GatekeeperPage />);
    await waitFor(() => screen.getByText('Create First Submission'));

    fireEvent.click(screen.getByText('Create First Submission'));
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Building micro-frontends/)).toBeInTheDocument();
    });
  });

  it('displays an error if blog submission fails', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'dev@x.com' } } });
    global.fetch = fetchImpl({
      list: [],
      submitPost: { ok: false, json: async () => ({ error: 'Blog rejected' }) },
    });

    render(<GatekeeperPage />);
    await waitFor(() => screen.getByText('Create First Submission'));
    fireEvent.click(screen.getByText('Create First Submission'));

    await waitFor(() => screen.getByPlaceholderText(/Building micro-frontends/));
    fireEvent.change(screen.getByPlaceholderText(/Building micro-frontends/), { target: { value: 'A New Post' } });
    fireEvent.change(screen.getByPlaceholderText(/Write or paste your markdown/), {
      target: { value: 'Some markdown body content.' },
    });
    fireEvent.click(screen.getByText('Submit to Gatekeeper'));

    await waitFor(() => {
      expect(screen.getByText('Blog rejected')).toBeInTheDocument();
    });
  });

  it('displays an error if quiz grading fails', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'dev@x.com' } } });
    global.fetch = fetchImpl({
      list: [submission()],
      quizPost: { ok: false, json: async () => ({ error: 'Grading failed' }) },
    });

    render(<GatekeeperPage />);
    await waitFor(() => screen.getByText('My Article'));
    fireEvent.click(screen.getByText('Take Verification Quiz'));
    await waitFor(() => screen.getByText('Quiz: My Article'));

    // Answer all questions
    const optionGroups = document.querySelectorAll('.grid.grid-cols-1.md\\:grid-cols-2');
    optionGroups.forEach((group) => {
      const firstOption = group.querySelector('button');
      if (firstOption) fireEvent.click(firstOption);
    });

    fireEvent.click(screen.getByText('Submit Answers'));

    await waitFor(() => {
      expect(screen.getByText('Grading failed')).toBeInTheDocument();
    });
  });
});
