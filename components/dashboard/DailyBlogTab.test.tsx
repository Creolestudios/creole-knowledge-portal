// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DailyBlogTab from './DailyBlogTab';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

describe('DailyBlogTab', () => {
  const originalFetch = global.fetch;
  const originalAlert = window.alert;

  beforeEach(() => {
    vi.clearAllMocks();
    window.alert = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.alert = originalAlert;
  });

  it('shows the loading state, then the "ready to synthesize" empty state', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false }) });

    render(<DailyBlogTab user={{ id: 'u1' }} profile={{}} />);
    expect(screen.getByText(/Retrieving your latest briefing/)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Your Daily Tech Briefing is Ready.')).toBeInTheDocument();
    });
  });

  it('renders the fetched brief with its title, content, and tags', async () => {
    const today = new Date();
    const digestDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        blog: {
          title: 'Today’s Brief',
          content: 'Some **bold** content',
          tags: ['react', 'ai'],
          digest_date: digestDate,
          estimated_read_minutes: 20,
        },
      }),
    });

    render(<DailyBlogTab user={{ id: 'u1' }} profile={{}} />);

    await waitFor(() => {
      expect(screen.getByText('Today’s Brief')).toBeInTheDocument();
    });
    expect(screen.getByText(/Fetched Today/i)).toBeInTheDocument();
    expect(screen.getByText(/20 min read/i)).toBeInTheDocument();
    expect(screen.getByText('react')).toBeInTheDocument();
    expect(screen.getByText(/Start Quiz/)).toBeInTheDocument();
    expect(screen.queryByText('Regenerate Briefing')).not.toBeInTheDocument();
  });

  it('shows synthesize when the latest digest is from a prior day', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const key = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        blog: {
          title: 'Older Brief',
          content: 'x',
          tags: [],
          digest_date: key,
          estimated_read_minutes: 18,
        },
      }),
    });

    render(<DailyBlogTab user={{ id: 'u1' }} profile={{}} />);
    await waitFor(() => {
      expect(screen.getByText('Synthesize Morning Briefing')).toBeInTheDocument();
    });
    expect(screen.queryByText('Older Brief')).not.toBeInTheDocument();
  });

  it('generates a new briefing when "Synthesize Morning Briefing" is clicked', async () => {
    const today = new Date();
    const digestDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: false }) }) // initial fetch: none
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          blog: {
            title: 'Fresh Brief',
            content: 'x',
            tags: [],
            digest_date: digestDate,
            estimated_read_minutes: 20,
          },
        }),
      }); // generate

    render(<DailyBlogTab user={{ id: 'u1' }} profile={{ primary_tech_stack: ['React'] }} />);

    await waitFor(() => {
      expect(screen.getByText('Synthesize Morning Briefing')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Synthesize Morning Briefing'));
    expect(screen.getByText('AI Factory is Synthesizing...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Fresh Brief')).toBeInTheDocument();
    });

    const generateCall = (global.fetch as any).mock.calls.find(
      (c: any[]) => c[0] === '/api/digests/generate',
    );
    expect(generateCall).toBeTruthy();
    expect(JSON.parse(generateCall[1].body)).toEqual({ userId: 'u1' });
  });

  it('alerts with the error message when generation fails', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: false }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Gemini quota exceeded' }) });

    render(<DailyBlogTab user={{ id: 'u1' }} profile={{}} />);
    await waitFor(() => screen.getByText('Synthesize Morning Briefing'));
    fireEvent.click(screen.getByText('Synthesize Morning Briefing'));

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Gemini quota exceeded'));
    });
  });

  it('alerts on a network error during generation', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: false }) })
      .mockRejectedValueOnce(new Error('offline'));

    render(<DailyBlogTab user={{ id: 'u1' }} profile={{}} />);
    await waitFor(() => screen.getByText('Synthesize Morning Briefing'));
    fireEvent.click(screen.getByText('Synthesize Morning Briefing'));

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Network error'));
    });
  });

  it('redirects to the quiz page and posts reading activity when "Start Quiz" is clicked', async () => {
    const today = new Date();
    const digestDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/digests')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            blog: { id: 'blog-1', title: 'B', content: 'c', tags: [], digest_date: digestDate },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<DailyBlogTab user={{ id: 'u1' }} profile={{}} />);
    await waitFor(() => screen.getByText('B'));

    fireEvent.click(screen.getByText(/Start Quiz/));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/activity',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    expect(mockPush).toHaveBeenCalledWith('/dashboard/quiz/blog-1');
  });

  it('renders passed quiz status and allows reviewing results', async () => {
    const today = new Date();
    const digestDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/quizzes/status')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ completed: true, passed: true, result: { score: 4, total: 5 } }),
        });
      }
      if (url.startsWith('/api/digests')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            blog: { id: 'blog-1', title: 'B', content: 'c', tags: [], digest_date: digestDate },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<DailyBlogTab user={{ id: 'u1' }} profile={{}} />);
    await waitFor(() => screen.getByText('B'));

    await waitFor(() => {
      expect(screen.getByText(/Quiz Passed!/)).toBeInTheDocument();
      expect(screen.getByText('Review Quiz Results')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Review Quiz Results'));
    expect(mockPush).toHaveBeenCalledWith('/dashboard/quiz/blog-1');
  });

  it('does not attempt to regenerate when there is no user', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false }) });

    render(<DailyBlogTab />);
    await waitFor(() => screen.getByText('Synthesize Morning Briefing'));

    const callsBefore = (global.fetch as any).mock.calls.length;
    fireEvent.click(screen.getByText('Synthesize Morning Briefing'));
    // handleGenerateBriefing returns early without `user`, so no new fetch call happens.
    expect((global.fetch as any).mock.calls.length).toBe(callsBefore);
  });
});
