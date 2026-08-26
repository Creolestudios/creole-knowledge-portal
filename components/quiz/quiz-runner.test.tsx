// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QuizRunner } from './quiz-runner';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: vi.fn(),
  }),
}));

vi.mock('motion/react', () => ({
  motion: {
    div: ({ children, className, onClick, ...props }: any) => (
      <div className={className} onClick={onClick}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));



const mcQuestion = {
  id: 'q1',
  question_type: 'single',
  difficulty: 'medium',
  question: 'What hook manages side effects?',
  options: ['useState', 'useEffect', 'useRef'],
};

const codeQuestion = {
  id: 'q-code',
  question_type: 'code',
  difficulty: 'hard',
  question: 'What is the output of this code snippet?',
  options: null,
  code_snippet: 'const sum = (a, b) => a + b;\nconsole.log(sum(2, 3));',
};

const conceptualQuestion = {
  id: 'q-concept',
  question_type: 'conceptual',
  difficulty: 'hard',
  question: 'Explain React Server Components philosophy.',
  options: null,
};

describe('QuizRunner', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPush.mockClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('shows the initializing spinner, then a not-yet-taken prompt with a manual start button', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/quizzes/status')) {
        return Promise.resolve({ ok: true, json: async () => ({ completed: false, inProgress: false }) });
      }
      if (url.includes('/api/quizzes/start')) {
        return Promise.resolve({ ok: true, json: async () => ({ error: 'blocked' }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<QuizRunner blogId="blog-1" />);
    expect(screen.getByText(/Initializing Quiz Environment/)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Start Knowledge Quiz')).toBeInTheDocument();
    });
  });

  it('auto-starts the quiz and renders the first question when status says not-yet-taken and start succeeds', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/quizzes/status')) {
        return Promise.resolve({ ok: true, json: async () => ({ completed: false, inProgress: false }) });
      }
      if (url.includes('/api/quizzes/start')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, attemptId: 'a1', questions: [mcQuestion] }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<QuizRunner blogId="blog-1" />);
    await waitFor(() => {
      expect(screen.getByText('What hook manages side effects?')).toBeInTheDocument();
    });
    expect(screen.getByText('Question 1 of 1')).toBeInTheDocument();
  });

  it('renders code snippet and handles user text input for code question type', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/quizzes/status')) {
        return Promise.resolve({ ok: true, json: async () => ({ completed: false, inProgress: false }) });
      }
      if (url.includes('/api/quizzes/start')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, attemptId: 'a1', questions: [codeQuestion] }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<QuizRunner blogId="blog-1" />);
    await waitFor(() => {
      expect(screen.getByText('What is the output of this code snippet?')).toBeInTheDocument();
    });

    expect(screen.getByText(/console.log\(sum\(2, 3\)\)/)).toBeInTheDocument();
    const textarea = screen.getByPlaceholderText(/Type your detailed answer/);
    fireEvent.change(textarea, { target: { value: '5' } });
    expect((textarea as HTMLTextAreaElement).value).toBe('5');
  });

  it('renders conceptual question type with textarea input', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/quizzes/status')) {
        return Promise.resolve({ ok: true, json: async () => ({ completed: false, inProgress: false }) });
      }
      if (url.includes('/api/quizzes/start')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, attemptId: 'a1', questions: [conceptualQuestion] }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<QuizRunner blogId="blog-1" />);
    await waitFor(() => {
      expect(screen.getByText('Explain React Server Components philosophy.')).toBeInTheDocument();
    });
  });

  it('resumes an in-progress attempt with its saved answers', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/quizzes/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            inProgress: true,
            attemptId: 'a1',
            timeLeft: 1200,
            questions: [mcQuestion],
            answers: { q1: ['useEffect'] },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<QuizRunner blogId="blog-1" />);
    await waitFor(() => {
      expect(screen.getByText('What hook manages side effects?')).toBeInTheDocument();
    });

    const useEffectOption = screen.getByText('useEffect').closest('button')!;
    expect(useEffectOption.className).toContain('border-brand');
  });

  it('shows the already-completed result screen directly', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        completed: true,
        result: {
          score: 4,
          total: 5,
          percentage: 80,
          correctAnswers: 4,
          timeTaken: 125,
          reviewData: [],
        },
      }),
    });

    render(<QuizRunner blogId="blog-1" />);
    await waitFor(() => {
      expect(screen.getByText('Quiz Completed!')).toBeInTheDocument();
    });
    expect(screen.getByText('4 / 5')).toBeInTheDocument();
    expect(screen.getByText('2:05')).toBeInTheDocument();
  });

  it('shows a network-error message when the status check fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('offline'));
    render(<QuizRunner blogId="blog-1" />);

    await waitFor(() => {
      expect(screen.getByText('Test Your Knowledge')).toBeInTheDocument();
    });
    expect(screen.getByText(/Network error while checking quiz status/)).toBeInTheDocument();
  });

  it('selects an option, advances to the next question, and submits the quiz', async () => {
    const questions = [
      mcQuestion,
      { id: 'q2', question_type: 'single', difficulty: 'easy', question: 'Second question?', options: ['A', 'B'] },
    ];
    global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
      if (url.includes('/api/quizzes/status')) {
        return Promise.resolve({ ok: true, json: async () => ({ completed: false, inProgress: false }) });
      }
      if (url.includes('/api/quizzes/start')) {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, attemptId: 'a1', questions }) });
      }
      if (url.includes('/api/quizzes/evaluate')) {
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
      }
      if (url.includes('/api/quizzes/finish')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            result: { score: 2, total: 2, percentage: 100, correctAnswers: 2, timeTaken: 30, reviewData: [] },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<QuizRunner blogId="blog-1" />);
    await waitFor(() => screen.getByText('What hook manages side effects?'));

    fireEvent.click(screen.getByText('useEffect'));
    fireEvent.click(screen.getByText('Next'));

    await waitFor(() => {
      expect(screen.getByText('Second question?')).toBeInTheDocument();
    });
    expect(screen.getByText('Question 2 of 2')).toBeInTheDocument();

    fireEvent.click(screen.getByText('A'));
    fireEvent.click(screen.getByText(/Submit Quiz/));

    await waitFor(() => {
      expect(screen.getByText('Quiz Completed!')).toBeInTheDocument();
    });
  });

  it('navigates back to the previous question', async () => {
    const questions = [
      mcQuestion,
      { id: 'q2', question_type: 'single', difficulty: 'easy', question: 'Second question?', options: ['A', 'B'] },
    ];
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/quizzes/status')) {
        return Promise.resolve({ ok: true, json: async () => ({ completed: false, inProgress: false }) });
      }
      if (url.includes('/api/quizzes/start')) {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, attemptId: 'a1', questions }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<QuizRunner blogId="blog-1" />);
    await waitFor(() => screen.getByText('What hook manages side effects?'));
    fireEvent.click(screen.getByText('Next'));
    await waitFor(() => screen.getByText('Second question?'));

    fireEvent.click(screen.getByText('Previous'));
    await waitFor(() => {
      expect(screen.getByText('What hook manages side effects?')).toBeInTheDocument();
    });
  });

  it('shows the Back to Dashboard button after completion', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        completed: true,
        result: { score: 1, total: 1, percentage: 100, correctAnswers: 1, timeTaken: 10, reviewData: [] },
      }),
    });

    render(<QuizRunner blogId="blog-1" />);
    await waitFor(() => screen.getByText('Quiz Completed!'));

    const backBtn = screen.getByText('Back to Dashboard');
    expect(backBtn).toBeInTheDocument();
    
    // Test navigation
    fireEvent.click(backBtn);
    expect(mockPush).toHaveBeenCalledWith('/dashboard');
  });

  it('handles idle warning popup and extends session when clicked', async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/quizzes/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            inProgress: true,
            attemptId: 'a-idle',
            timeLeft: 5,
            questions: [mcQuestion],
            answers: {},
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<QuizRunner blogId="blog-1" />);
    await act(async () => {
      await Promise.resolve();
    });

    // Advance 5 seconds so elapsed seconds reaches 1200s (1195 + 5 = 1200s)
    await act(async () => {
      vi.advanceTimersByTime(5 * 1000);
    });

    expect(screen.getByText(/Still working on your quiz\?/i)).toBeInTheDocument();

    const extendBtn = screen.getByRole('button', { name: /Yes, Continue Quiz/i });
    act(() => {
      fireEvent.click(extendBtn);
    });
    expect(screen.queryByText(/Still working on your quiz\?/i)).not.toBeInTheDocument();
  });

  it('renders no questions fallback screen when question pool is empty and navigates to dashboard', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/quizzes/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ inProgress: true, attemptId: 'empty-1', questions: [] }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<QuizRunner blogId="blog-1" />);
    await waitFor(() => {
      expect(screen.getByText('No questions available for this attempt.')).toBeInTheDocument();
    });

    const backBtn = screen.getByRole('button', { name: /Back to Dashboard/i });
    fireEvent.click(backBtn);
  });

  it('renders detailed review items on completion screen when reviewData is present', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        completed: true,
        result: {
          score: 1,
          total: 1,
          percentage: 100,
          correctAnswers: 1,
          timeTaken: 20,
          reviewData: [
            {
              questionId: 'q1',
              question: 'What is Next.js?',
              isCorrect: true,
              pointsAwarded: 1,
              userAnswer: ['Framework'],
              correctAnswers: ['Framework'],
              explanation: 'Next.js is a React framework.',
            },
          ],
        },
      }),
    });

    render(<QuizRunner blogId="blog-1" />);
    await waitFor(() => expect(screen.getByText('Quiz Completed!')).toBeInTheDocument());

    expect(screen.getByText('Detailed Review')).toBeInTheDocument();
    expect(screen.getByText('What is Next.js?')).toBeInTheDocument();
    expect(screen.getByText('Next.js is a React framework.')).toBeInTheDocument();
  });
  it('renders the AI semantic match badge across all three score bands and an incorrect review item', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        completed: true,
        result: {
          score: 2,
          total: 4,
          percentage: 50,
          correctAnswers: 1,
          timeTaken: 42,
          reviewData: [
            {
              questionId: 'q1',
              question: 'Explain hydration',
              questionType: 'conceptual',
              isCorrect: true,
              pointsAwarded: 2,
              matchPercentage: 90,
              userAnswer: 'The client attaches handlers to server HTML.',
              correctAnswers: ['hydration'],
              explanation: 'Correct explanation.',
            },
            {
              questionId: 'q2',
              question: 'Explain suspense',
              questionType: 'descriptive',
              isCorrect: false,
              pointsAwarded: 1,
              matchPercentage: 55,
              userAnswer: 'Something about loading.',
              correctAnswers: ['suspense'],
              explanation: 'Partially right.',
            },
            {
              questionId: 'q3',
              question: 'Explain streaming',
              questionType: 'code',
              isCorrect: false,
              pointsAwarded: 0,
              matchPercentage: 10,
              userAnswer: '',
              correctAnswers: ['streaming'],
              explanation: 'Missed the point.',
            },
            {
              questionId: 'q4',
              question: 'Pick the framework',
              questionType: 'single',
              isCorrect: false,
              pointsAwarded: 0,
              userAnswer: 'Angular',
              correctAnswers: ['Next.js'],
              explanation: 'Wrong choice.',
            },
          ],
        },
      }),
    });

    render(<QuizRunner blogId="blog-1" />);
    await waitFor(() => expect(screen.getByText('Quiz Completed!')).toBeInTheDocument());

    expect(screen.getByText('90% AI Semantic Match')).toBeInTheDocument();
    expect(screen.getByText('55% AI Semantic Match')).toBeInTheDocument();
    expect(screen.getByText('10% AI Semantic Match')).toBeInTheDocument();
    // A non-AI question type gets no badge at all.
    expect(screen.getAllByText(/AI Semantic Match/)).toHaveLength(3);

    expect(screen.getByText('Correct (2 pts)')).toBeInTheDocument();
    expect(screen.getAllByText(/^Incorrect \(\d+ pts\)$/)).toHaveLength(3);
    expect(screen.getByText('No answer provided')).toBeInTheDocument();
  });
});
