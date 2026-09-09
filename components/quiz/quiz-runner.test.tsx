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

function installMonitorShareMock() {
  const screenTrack = {
    kind: 'video',
    readyState: 'live',
    getSettings: () => ({ displaySurface: 'monitor' }),
    stop: vi.fn(),
    onended: null as (() => void) | null,
  };
  const cameraTrack = {
    kind: 'video',
    readyState: 'live',
    getSettings: () => ({}),
    stop: vi.fn(),
    onended: null as (() => void) | null,
  };
  const screenStream = {
    getVideoTracks: () => [screenTrack],
    getTracks: () => [screenTrack],
  };
  const cameraStream = {
    getVideoTracks: () => [cameraTrack],
    getTracks: () => [cameraTrack],
  };
  const getDisplayMedia = vi.fn().mockResolvedValue(screenStream);
  const getUserMedia = vi.fn().mockResolvedValue(cameraStream);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getDisplayMedia, getUserMedia },
  });
  return { screenTrack, cameraTrack, getDisplayMedia, getUserMedia };
}

async function shareScreenToBegin() {
  const shareBtn = await screen.findByRole('button', { name: /Share entire screen to begin/i });
  await act(async () => {
    fireEvent.click(shareBtn);
  });
  const cameraBtn = await screen.findByRole('button', { name: /Allow camera to continue/i });
  await act(async () => {
    fireEvent.click(cameraBtn);
  });
  const startBtn = await screen.findByRole('button', { name: /I understand — start quiz/i });
  await act(async () => {
    fireEvent.click(startBtn);
  });
}



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
    sessionStorage.clear();
    installMonitorShareMock();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('shows the initializing spinner, then a screen-share gate and does not start the quiz', async () => {
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
      expect(screen.getByText('Share entire screen to begin')).toBeInTheDocument();
    });
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/quizzes/start'),
      expect.anything(),
    );
  });

  it('starts the quiz only after entire-screen share succeeds', async () => {
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
    await shareScreenToBegin();
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
    await shareScreenToBegin();
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
    await shareScreenToBegin();
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
            timeLeft: 900,
            questions: [mcQuestion],
            answers: { q1: ['useEffect'] },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<QuizRunner blogId="blog-1" />);
    await shareScreenToBegin();
    await waitFor(() => {
      expect(screen.getByText('What hook manages side effects?')).toBeInTheDocument();
    });

    const useEffectOption = screen.getByText('useEffect').closest('button')!;
    expect(useEffectOption.className).toContain('border-brand');
  });

  it('resumes an in-progress attempt on the saved question index after camera remount', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/quizzes/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            inProgress: true,
            attemptId: 'a-resume',
            timeLeft: 1000,
            questions: [
              mcQuestion,
              { id: 'q2', question_type: 'single', difficulty: 'easy', question: 'Second question?', options: ['A', 'B'] },
            ],
            answers: { q1: ['useEffect'] },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    // Pretend the user was on question 2 when camera stopped / page remounted.
    sessionStorage.setItem('quiz-runner-progress:a-resume', JSON.stringify({ currentIndex: 1 }));

    render(<QuizRunner blogId="blog-1" />);
    await shareScreenToBegin();

    await waitFor(() => {
      expect(screen.getByText('Second question?')).toBeInTheDocument();
    });
    expect(screen.getByText('Question 2 of 2')).toBeInTheDocument();
    expect(screen.queryByText('What hook manages side effects?')).not.toBeInTheDocument();
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
    await shareScreenToBegin();
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
    await shareScreenToBegin();
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
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Share entire screen to begin/i }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Allow camera to continue/i }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /I understand — start quiz/i }));
      await Promise.resolve();
    });

    // Advance 5 seconds so elapsed seconds reaches the 15-min limit (timeLeft was 5)
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
    await shareScreenToBegin();
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

  it('shows quiz instructions after screen share and only then starts the quiz', async () => {
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
      expect(screen.getByText('Share entire screen to begin')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Share entire screen to begin/i }));
    });

    expect(await screen.findByText(/Allow camera access/i)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Allow camera to continue/i }));
    });

    expect(await screen.findByText('Quiz instructions')).toBeInTheDocument();
    expect(screen.getByText(/even once/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/quizzes/start'),
      expect.anything(),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /I understand — start quiz/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('What hook manages side effects?')).toBeInTheDocument();
    });
  });

  it('halts the quiz with a screen-share warning when screen sharing stops', async () => {
    const media = installMonitorShareMock();
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
    await shareScreenToBegin();
    await waitFor(() => screen.getByText('What hook manages side effects?'));

    act(() => {
      media.screenTrack.onended?.();
    });

    expect(screen.getByText('Quiz paused')).toBeInTheDocument();
    expect(screen.getByText(/Screen sharing stopped/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Restore screen share/i })).toBeInTheDocument();
    expect(
      (global.fetch as any).mock.calls.some((call: any[]) => String(call[0]).includes('/api/quizzes/finish')),
    ).toBe(false);
  });

  it('halts the quiz with a camera warning when the camera stops', async () => {
    const media = installMonitorShareMock();
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
    await shareScreenToBegin();
    await waitFor(() => screen.getByText('What hook manages side effects?'));

    act(() => {
      media.cameraTrack.onended?.();
    });

    expect(screen.getByText('Quiz paused')).toBeInTheDocument();
    expect(screen.getByText(/Camera stopped/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Restore camera/i })).toBeInTheDocument();
    expect(
      (global.fetch as any).mock.calls.some((call: any[]) => String(call[0]).includes('/api/quizzes/finish')),
    ).toBe(false);
  });

  it('auto-submits on the first tab leave through the existing finish API', async () => {
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
      if (url.includes('/api/quizzes/evaluate')) {
        return Promise.resolve({ ok: true, json: async () => ({ success: true }) });
      }
      if (url.includes('/api/quizzes/finish')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            result: { score: 0, total: 1, percentage: 0, correctAnswers: 0, timeTaken: 8, reviewData: [] },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<QuizRunner blogId="blog-1" />);
    await shareScreenToBegin();
    await waitFor(() => screen.getByText('What hook manages side effects?'));

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => {
      expect(screen.getByText('Quiz Completed!')).toBeInTheDocument();
    });
    expect(
      (global.fetch as any).mock.calls.some((call: any[]) => String(call[0]).includes('/api/quizzes/finish')),
    ).toBe(true);
  });

  it('freezes elapsed time while screen share is halted (no background tick)', async () => {
    vi.useFakeTimers();
    const media = installMonitorShareMock();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/quizzes/status')) {
        return Promise.resolve({ ok: true, json: async () => ({ completed: false, inProgress: false }) });
      }
      if (url.includes('/api/quizzes/start')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            attemptId: 'a1',
            questions: [mcQuestion],
            startedAt: new Date().toISOString(),
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<QuizRunner blogId="blog-1" />);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Share entire screen to begin/i }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Allow camera to continue/i }));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /I understand — start quiz/i }));
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText(/Time Elapsed: 0:03/)).toBeInTheDocument();

    act(() => {
      media.screenTrack.onended?.();
    });
    expect(screen.getByText('Quiz paused')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    // Still 0:03 — halt must not let the elapsed timer keep running in the background.
    expect(screen.getByText(/Time Elapsed: 0:03/)).toBeInTheDocument();
  });
});
