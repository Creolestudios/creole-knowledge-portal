// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PersonalLeaderboardPage from './page';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
}));

describe('PersonalLeaderboardPage', () => {
  const mockUser = { id: 'user-1', email: 'test@example.com' };
  const mockPush = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useRouter as any).mockReturnValue({ push: mockPush });
  });

  it('redirects to home if user is not logged in', async () => {
    (createClient as any).mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    });

    render(<PersonalLeaderboardPage />);
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/');
    });
  });

  it('renders loading state initially', () => {
    (createClient as any).mockReturnValue({
      auth: { getUser: vi.fn().mockReturnValue(new Promise(() => {})) },
    });

    render(<PersonalLeaderboardPage />);
    expect(screen.getByText('Loading your quiz history...')).toBeInTheDocument();
  });

  it('renders empty history view when no quizzes exist', async () => {
    (createClient as any).mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) },
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ success: true, history: [] }),
    } as any);

    render(<PersonalLeaderboardPage />);

    await waitFor(() => {
      expect(screen.getByText('No Quizzes Taken Yet')).toBeInTheDocument();
    });

    const briefBtn = screen.getByRole('button', { name: /Go to Morning Brief/i });
    fireEvent.click(briefBtn);
    expect(mockPush).toHaveBeenCalledWith('/dashboard');
  });

  it('renders error message when fetch history returns error', async () => {
    (createClient as any).mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) },
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ success: false, error: 'Failed to fetch quizzes' }),
    } as any);

    render(<PersonalLeaderboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Failed to fetch quizzes')).toBeInTheDocument();
    });
  });

  it('renders error message when fetch history throws exception', async () => {
    (createClient as any).mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) },
    });

    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    render(<PersonalLeaderboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load quiz history.')).toBeInTheDocument();
    });
  });

  it('renders list of completed and in-progress quizzes with sidebar interactions', async () => {
    (createClient as any).mockReturnValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: mockUser } }) },
    });

    const mockHistory = [
      {
        id: 'quiz-1',
        blog_id: 'blog-1',
        blog_title: 'TypeScript Best Practices',
        status: 'completed',
        completed_at: '2026-08-20T10:00:00Z',
        score: '4/5',
        percentage: 80,
        time_taken_seconds: 125,
      },
      {
        id: 'quiz-2',
        blog_id: 'blog-2',
        blog_title: 'Next.js 15 Deep Dive',
        status: 'in_progress',
        started_at: 'invalid-date',
      },
      {
        id: 'quiz-3',
        blog_id: 'blog-3',
        blog_title: 'React 19 Hooks',
        status: 'in_progress',
        started_at: null,
      },
    ];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ success: true, history: mockHistory }),
    } as any);

    render(<PersonalLeaderboardPage />);

    await waitFor(() => {
      expect(screen.getByText('TypeScript Best Practices')).toBeInTheDocument();
    });

    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('4/5')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('2:05')).toBeInTheDocument();

    expect(screen.getByText('Next.js 15 Deep Dive')).toBeInTheDocument();
    const resumeBtns = screen.getAllByRole('button', { name: /Resume Quiz/i });
    expect(resumeBtns).toHaveLength(2);
    fireEvent.click(resumeBtns[0]);
    expect(mockPush).toHaveBeenCalledWith('/dashboard/quiz/blog-2');

    // Click completed quiz navigation button
    const completedQuizCard = screen.getByText('TypeScript Best Practices').closest('.group');
    const arrowBtn = completedQuizCard?.querySelector('button');
    if (arrowBtn) {
      fireEvent.click(arrowBtn);
      expect(mockPush).toHaveBeenCalledWith('/dashboard/quiz/blog-1');
    }

    // Sidebar navigation buttons
    const morningBriefBtn = screen.getByRole('button', { name: /Morning Brief/i });
    fireEvent.click(morningBriefBtn);
    expect(mockPush).toHaveBeenCalledWith('/dashboard');

    const blogSubmissionsBtn = screen.getByRole('button', { name: /Blog Submissions/i });
    fireEvent.click(blogSubmissionsBtn);
    expect(mockPush).toHaveBeenCalledWith('/dashboard/gatekeeper');

    const myQuizzesBtn = screen.getByRole('button', { name: /My Quizzes/i });
    fireEvent.click(myQuizzesBtn);
    expect(mockPush).toHaveBeenCalledWith('/dashboard/quizzes');
  });
});
