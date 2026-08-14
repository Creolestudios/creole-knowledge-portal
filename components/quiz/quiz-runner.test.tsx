// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QuizRunner } from './quiz-runner';

vi.mock('./quiz-leaderboard', () => ({
  QuizLeaderboard: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="leaderboard">
      <button onClick={onClose}>Close leaderboard</button>
    </div>
  ),
}));

const mcQuestion = {
  id: 'q1',
  question_type: 'single',
  difficulty: 'medium',
  question: 'What hook manages side effects?',
  options: ['useState', 'useEffect', 'useRef'],
};

describe('QuizRunner', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
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
      expect(screen.getByText('Start 10-Min Quiz')).toBeInTheDocument();
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

  it('resumes an in-progress attempt with its saved answers', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/quizzes/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            inProgress: true,
            attemptId: 'a1',
            timeLeft: 120,
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
    // Previously-selected option should be visually selected (checked icon present).
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
    expect(screen.getByText('80%')).toBeInTheDocument();
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

  it('shows the leaderboard after completion and can close it', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        completed: true,
        result: { score: 1, total: 1, percentage: 100, correctAnswers: 1, timeTaken: 10, reviewData: [] },
      }),
    });

    render(<QuizRunner blogId="blog-1" />);
    await waitFor(() => screen.getByText('Quiz Completed!'));

    fireEvent.click(screen.getByText('View Leaderboard'));
    expect(screen.getByTestId('leaderboard')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Close leaderboard'));
    expect(screen.queryByTestId('leaderboard')).not.toBeInTheDocument();
  });

  it('renders a textarea for descriptive question types', async () => {
    const descriptiveQ = {
      id: 'q1',
      question_type: 'descriptive',
      difficulty: 'hard',
      question: 'Explain closures in your own words.',
    };
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/quizzes/status')) {
        return Promise.resolve({ ok: true, json: async () => ({ completed: false, inProgress: false }) });
      }
      if (url.includes('/api/quizzes/start')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, attemptId: 'a1', questions: [descriptiveQ] }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<QuizRunner blogId="blog-1" />);
    await waitFor(() => screen.getByText('Explain closures in your own words.'));
    expect(screen.getByPlaceholderText(/Type your detailed answer/)).toBeInTheDocument();
  });
});
