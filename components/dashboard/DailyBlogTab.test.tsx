// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DailyBlogTab from './DailyBlogTab';

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
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        blog: {
          title: 'Today’s Brief',
          content: 'Some **bold** content',
          tags: ['react', 'ai'],
          estimated_read_minutes: 20,
        },
      }),
    });

    render(<DailyBlogTab user={{ id: 'u1' }} profile={{}} />);

    await waitFor(() => {
      expect(screen.getByText('Today’s Brief')).toBeInTheDocument();
    });
    expect(screen.getByText('20 min read')).toBeInTheDocument();
    expect(screen.getByText('react')).toBeInTheDocument();
    expect(screen.getByText('Start Quiz')).toBeInTheDocument();
  });

  it('generates a new briefing when "Synthesize Morning Briefing" is clicked', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: false }) }) // initial fetch: none
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          blog: { title: 'Fresh Brief', content: 'x', tags: [], estimated_read_minutes: 20 },
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

  it('opens the quiz modal and posts reading activity when "Start Quiz" is clicked', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/digests/latest') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, blog: { title: 'B', content: 'c', tags: [] } }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<DailyBlogTab user={{ id: 'u1' }} profile={{}} />);
    await waitFor(() => screen.getByText('B'));

    fireEvent.click(screen.getByText('Start Quiz'));
    expect(screen.getByText('Daily Quiz')).toBeInTheDocument();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/activity',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('submits the inline quiz and closes the modal', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/digests/latest') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, blog: { title: 'B', content: 'c', tags: [] } }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<DailyBlogTab user={{ id: 'u1' }} profile={{}} />);
    await waitFor(() => screen.getByText('B'));
    fireEvent.click(screen.getByText('Start Quiz'));

    fireEvent.click(screen.getByText('Submit'));

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith('Quiz submitted successfully!');
    });
  });

  it('closes the quiz modal via Cancel without submitting', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, blog: { title: 'B', content: 'c', tags: [] } }),
    });

    render(<DailyBlogTab user={{ id: 'u1' }} profile={{}} />);
    await waitFor(() => screen.getByText('B'));
    fireEvent.click(screen.getByText('Start Quiz'));
    fireEvent.click(screen.getByText('Cancel'));

    expect(screen.queryByText('Daily Quiz')).not.toBeInTheDocument();
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
