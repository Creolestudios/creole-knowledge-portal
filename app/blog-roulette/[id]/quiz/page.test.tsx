// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import QuizPage from './page';

const mockPush = vi.fn();
const mockRouter = { push: mockPush };
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/blog-roulette/blog-1/quiz',
  useParams: () => ({ id: 'blog-1' }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn().mockReturnValue({ auth: { signOut: vi.fn().mockResolvedValue({}) } }),
}));

// The page runs a 1s countdown ticker while the quiz is in progress, which
// re-renders its whole subtree. Stubbing the heavy chrome keeps each tick cheap
// so waitFor() isn't starved when the suite runs in parallel.
vi.mock('@/components/dashboard/DashboardShell', () => ({
  default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

// Framer Motion's AnimatePresence(mode="wait") can hang exit animations in jsdom,
// leaving the UI stuck on "Preparing quiz..." forever. Use plain elements in tests.
vi.mock('motion/react', () => {
  const passthrough = ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => {
    const {
      initial: _i,
      animate: _a,
      exit: _e,
      transition: _t,
      layoutId: _l,
      ...rest
    } = props;
    return <div {...rest}>{children}</div>;
  };
  return {
    motion: new Proxy(
      {},
      {
        get: () => passthrough,
      },
    ),
    AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  };
});

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return String(input);
}

function fetchImpl(map: Record<string, any>) {
  return vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = urlOf(input);
    if (url.includes('/api/blog-roulette/blog-1') && !url.includes('/quiz/')) {
      return Promise.resolve(map.blog ?? { ok: true, json: async () => ({ blog: { status: 'SUBMITTED' } }) });
    }
    if (url.includes('/quiz/generate')) {
      return Promise.resolve(
        map.generate ?? {
          ok: true,
          json: async () => ({
            questions: [{ q: 'Q1?' }, { q: 'Q2?' }, { q: 'Q3?' }],
            created_at: new Date().toISOString(),
            incorrect_indices: [],
          }),
        },
      );
    }
    if (url.includes('/quiz/submit')) {
      return Promise.resolve(
        map.submit ?? {
          ok: true,
          json: async () => ({
            passed: true,
            correct: 3,
            per_question: [true, true, true],
            result: 'PASS',
            next_status: 'PASSED',
            can_retry: false,
          }),
        },
      );
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

async function startQuizFlow() {
  await waitFor(() => screen.getByText('Start Quiz'));
  fireEvent.click(screen.getByText('Start Quiz'));
  await waitFor(() => screen.getByText('Q1?'));
}

async function answerCurrentAndGoNext(answer: string, nextLabel: string) {
  fireEvent.change(screen.getByPlaceholderText('Answer in your own words...'), {
    target: { value: answer },
  });
  fireEvent.click(screen.getByText(/Next Question/i));
  await waitFor(() => screen.getByText(nextLabel));
}

describe('QuizPage', () => {
  const originalFetch = global.fetch;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('redirects away when the blog fetch fails', async () => {
    global.fetch = fetchImpl({ blog: { ok: false, json: async () => ({}) } });
    render(<QuizPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/blog-roulette');
    });
  });

  it('redirects away when the blog is not in a quizzable status', async () => {
    global.fetch = fetchImpl({ blog: { ok: true, json: async () => ({ blog: { status: 'DRAFT' } }) } });
    render(<QuizPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/blog-roulette');
    });
  });

  it('shows the intro phase for a quizzable blog', async () => {
    global.fetch = fetchImpl({});
    render(<QuizPage />);

    await waitFor(() => {
      expect(screen.getByText('Ready when you are.')).toBeInTheDocument();
    });
  });

  it('starts the quiz and shows the first question', async () => {
    global.fetch = fetchImpl({});
    render(<QuizPage />);
    await startQuizFlow();
    expect(screen.getByText('Question 1 of 3')).toBeInTheDocument();
  });

  it('requires a substantive answer before advancing to the next question', async () => {
    global.fetch = fetchImpl({});
    render(<QuizPage />);
    await startQuizFlow();

    fireEvent.click(screen.getByText(/Next Question/i));
    await waitFor(() => {
      expect(screen.getByText(/Please write a real answer/)).toBeInTheDocument();
    });
  });

  it('advances through all 3 questions and submits for grading', async () => {
    global.fetch = fetchImpl({});
    render(<QuizPage />);
    await startQuizFlow();

    await answerCurrentAndGoNext('A real answer for question one.', 'Q2?');
    await answerCurrentAndGoNext('A real answer for question two.', 'Q3?');

    fireEvent.change(screen.getByPlaceholderText('Answer in your own words...'), {
      target: { value: 'A real answer for question three.' },
    });
    fireEvent.click(screen.getByText(/Submit for Grading/i));

    await waitFor(() => {
      expect(screen.getByText('Passed — Publishing')).toBeInTheDocument();
    });
    expect(screen.getByText('Score: 3/3')).toBeInTheDocument();
  });

  it('navigates back to the previous question', async () => {
    global.fetch = fetchImpl({});
    render(<QuizPage />);
    await startQuizFlow();

    await answerCurrentAndGoNext('A real answer for question one.', 'Q2?');

    fireEvent.click(screen.getByText('Previous'));
    await waitFor(() => {
      expect(screen.getByText('Q1?')).toBeInTheDocument();
    });
  });

  it('shows a soft-fail result with a retry option', async () => {
    global.fetch = fetchImpl({
      submit: {
        ok: true,
        json: async () => ({
          passed: false,
          correct: 2,
          per_question: [true, true, false],
          result: 'SOFT_FAIL',
          next_status: 'SUBMITTED',
          can_retry: true,
        }),
      },
    });
    render(<QuizPage />);
    await startQuizFlow();

    await answerCurrentAndGoNext('A real substantive answer here.', 'Q2?');
    await answerCurrentAndGoNext('A real substantive answer here.', 'Q3?');
    fireEvent.change(screen.getByPlaceholderText('Answer in your own words...'), {
      target: { value: 'A real substantive answer here.' },
    });
    fireEvent.click(screen.getByText(/Submit for Grading/i));

    await waitFor(() => {
      expect(screen.getByText('Soft Fail')).toBeInTheDocument();
    });
    expect(screen.getByText('Try Again (1 retry left)')).toBeInTheDocument();
  });

  it('shows a hard rejection result with no retry option', async () => {
    global.fetch = fetchImpl({
      submit: {
        ok: true,
        json: async () => ({
          passed: false,
          correct: 0,
          per_question: [false, false, false],
          result: 'REJECT',
          next_status: 'REJECTED',
          can_retry: false,
        }),
      },
    });
    render(<QuizPage />);
    await startQuizFlow();

    await answerCurrentAndGoNext('A real substantive answer here.', 'Q2?');
    await answerCurrentAndGoNext('A real substantive answer here.', 'Q3?');
    fireEvent.change(screen.getByPlaceholderText('Answer in your own words...'), {
      target: { value: 'A real substantive answer here.' },
    });
    fireEvent.click(screen.getByText(/Submit for Grading/i));

    await waitFor(() => {
      expect(screen.getByText('Rejected')).toBeInTheDocument();
    });
    expect(screen.getByText('Back to Blogs')).toBeInTheDocument();
    expect(screen.queryByText(/Try Again/)).not.toBeInTheDocument();
  });

  it('shows an error and stays on intro when quiz generation fails', async () => {
    global.fetch = fetchImpl({
      generate: { ok: false, json: async () => ({ error: 'No questions could be generated.' }) },
    });
    render(<QuizPage />);
    await waitFor(() => screen.getByText('Start Quiz'));
    fireEvent.click(screen.getByText('Start Quiz'));

    await waitFor(() => {
      expect(screen.getByText('No questions could be generated.')).toBeInTheDocument();
    });
  });
});
