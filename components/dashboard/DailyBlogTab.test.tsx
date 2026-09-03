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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('shows the loading state, then the "ready to synthesize" empty state', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: false }) });

    render(<DailyBlogTab user={{ id: 'u1' }} profile={{}} />);
    expect(screen.getByText(/Retrieving your latest briefing/)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Your Daily Tech Briefing is Ready.')).toBeInTheDocument();
    });
  });

  it('renders the fetched brief with its title, content, tags, and source links', async () => {
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
          sources: [
            { title: 'React Server Components Guide', url: 'https://dev.to/rsc', source_domain: 'dev.to' },
          ],
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
    expect(screen.getByText('React Server Components Guide')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /React Server Components Guide/i })).toHaveAttribute(
      'href',
      'https://dev.to/rsc',
    );
    expect(screen.getByText(/Start Quiz/)).toBeInTheDocument();
    expect(screen.queryByText('Regenerate Briefing')).not.toBeInTheDocument();
    expect(screen.queryByText('Dev.to API')).not.toBeInTheDocument();
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
    expect(screen.getByText("Preparing today's briefing")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Fresh Brief')).toBeInTheDocument();
    });

    const generateCall = (global.fetch as any).mock.calls.find(
      (c: any[]) => c[0] === '/api/digests/generate',
    );
    expect(generateCall).toBeTruthy();
    expect(JSON.parse(generateCall[1].body)).toEqual({ userId: 'u1' });
  });

  it('shows an in-page error when generation fails, without a browser alert', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: false }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Gemini quota exceeded' }) });

    render(<DailyBlogTab user={{ id: 'u1' }} profile={{}} />);
    await waitFor(() => screen.getByText('Synthesize Morning Briefing'));
    fireEvent.click(screen.getByText('Synthesize Morning Briefing'));

    await waitFor(() => {
      expect(screen.getByText(/Gemini quota exceeded/i)).toBeInTheDocument();
    });
    expect(screen.getByText('Synthesize Morning Briefing')).toBeInTheDocument();
    expect(screen.getByText(/Today's briefing wasn't generated/i)).toBeInTheDocument();
  });

  it('shows an in-page error on a network failure during generation', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: false }) })
      .mockRejectedValueOnce(new Error('offline'));

    render(<DailyBlogTab user={{ id: 'u1' }} profile={{}} />);
    await waitFor(() => screen.getByText('Synthesize Morning Briefing'));
    fireEvent.click(screen.getByText('Synthesize Morning Briefing'));

    await waitFor(() => {
      expect(screen.getByText(/Could not reach the briefing service: offline/i)).toBeInTheDocument();
    });
    expect(screen.getByText('Synthesize Morning Briefing')).toBeInTheDocument();
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

  it('does not show a past session blog when today has no digest', async () => {
    sessionStorage.setItem('active_blog_id', 'fallback-blog-id');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const digestDate = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/digests/latest')) {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, blog: null }) });
      }
      if (url.includes('/api/digests/by-id')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            blog: {
              id: 'fallback-blog-id',
              title: 'Yesterday Next.js Brief',
              content: 'Active',
              tags: [],
              digest_date: digestDate,
            },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<DailyBlogTab user={{ id: 'u1' }} profile={{}} />);

    await waitFor(() => {
      expect(screen.getByText('Synthesize Morning Briefing')).toBeInTheDocument();
    });
    expect(screen.queryByText('Yesterday Next.js Brief')).not.toBeInTheDocument();

    sessionStorage.removeItem('active_blog_id');
  });

  it('restores the reading timer from the same briefing session', async () => {
    const today = new Date();
    const digestDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    sessionStorage.setItem(
      'reading_timer:blog-1',
      JSON.stringify({ startedAt: Date.now() - 90_000, stoppedAt: null }),
    );

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/digests')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            blog: {
              id: 'blog-1',
              title: 'Timed Brief',
              content: 'c',
              tags: [],
              digest_date: digestDate,
            },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<DailyBlogTab user={{ id: 'u1' }} profile={{}} />);
    await waitFor(() => {
      expect(screen.getByText('Timed Brief')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('1m 30s')).toBeInTheDocument();
    });
    sessionStorage.removeItem('reading_timer:blog-1');
  });

  it('auto-opens the quiz when the reading timer reaches 40 minutes', async () => {
    const today = new Date();
    const digestDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    sessionStorage.setItem(
      'reading_timer:blog-1',
      JSON.stringify({ startedAt: Date.now() - 40 * 60 * 1000, stoppedAt: null }),
    );

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.startsWith('/api/digests')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            blog: {
              id: 'blog-1',
              title: 'Long Read Brief',
              content: 'c',
              tags: [],
              digest_date: digestDate,
            },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<DailyBlogTab user={{ id: 'u1' }} profile={{}} />);
    await waitFor(() => {
      expect(screen.getByText('Long Read Brief')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/dashboard/quiz/blog-1');
    });
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/activity',
      expect.objectContaining({ method: 'POST' }),
    );
    sessionStorage.removeItem('reading_timer:blog-1');
  });

  it('shows Synthesize instead of a Next.js filler briefing for today', async () => {
    const today = new Date();
    const digestDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        blog: {
          id: 'fallback-1',
          title: 'Architectural Deep-Dive: Next.js 15',
          content: 'Filler',
          tags: ['nextjs'],
          digest_date: digestDate,
          source: 'AI Resilient Synthesis Engine',
          is_fallback: true,
        },
      }),
    });

    render(<DailyBlogTab user={{ id: 'u1' }} profile={{}} />);
    await waitFor(() => {
      expect(screen.getByText('Synthesize Morning Briefing')).toBeInTheDocument();
    });
    expect(screen.queryByText('Architectural Deep-Dive: Next.js 15')).not.toBeInTheDocument();
  });

  it('keeps Synthesize when generate returns a filler briefing', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/api/digests/generate')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            blog: {
              title: 'Architectural Deep-Dive: Next.js 15',
              content: 'Filler',
              tags: ['nextjs'],
              source: 'AI Resilient Synthesis Engine',
              is_fallback: true,
            },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true, blog: null }) });
    });

    render(<DailyBlogTab user={{ id: 'u1' }} profile={{}} />);
    await waitFor(() => screen.getByText('Synthesize Morning Briefing'));
    fireEvent.click(screen.getByText('Synthesize Morning Briefing'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Try Synthesize again/i);
    });
    expect(screen.getByText('Synthesize Morning Briefing')).toBeInTheDocument();
    expect(screen.queryByText('Architectural Deep-Dive: Next.js 15')).not.toBeInTheDocument();
  });
});
