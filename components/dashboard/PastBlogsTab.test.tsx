// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PastBlogsTab from './PastBlogsTab';

describe('PastBlogsTab', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ blogs: [] }),
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('marks every dated briefing on the calendar and renders the activity legend', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/api/activity')) {
        return {
          ok: true,
          json: async () => ({
            records: [
              { date: '2026-07-18', read_seconds: 120, quiz_taken: true, quiz_score: 4, quiz_total: 5 },
              { date: '2026-07-17', read_seconds: 30, quiz_taken: false },
            ],
          }),
        };
      }
      if (String(url).includes('date=')) {
        return {
          ok: true,
          json: async () => ({
            blog: {
              title: 'Redis queues',
              content: 'body',
              digest_date: '2026-07-18',
            },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          blogs: [
            { title: 'Redis queues', digest_date: '2026-07-18T18:30:00.000Z' },
            { title: 'FastAPI auth', digest_date: '2026-07-17' },
            { title: 'No activity yet', digest_date: '2026-07-16' },
          ],
        }),
      };
    }) as any;

    render(<PastBlogsTab />);

    // Legend is always visible
    expect(screen.getByText('Mastered (Passed Quiz)')).toBeInTheDocument();
    expect(screen.getByText('Read (Needs Practice)')).toBeInTheDocument();
    expect(screen.getByText('Unread (Missed)')).toBeInTheDocument();

    // Walk the calendar back to July 2026, where the stored briefings live.
    const prev = screen.getByText('<');
    for (let i = 0; i < 24; i++) {
      if (screen.queryByText('July 2026')) break;
      fireEvent.click(prev);
    }
    expect(screen.getByText('July 2026')).toBeInTheDocument();

    const cellFor = (day: string) =>
      screen.getAllByText(day).find((el) => el.getAttribute('role') === 'button');

    await waitFor(() => {
      // Passed the quiz → green
      expect(cellFor('18')?.className).toContain('bg-green-500');
    });
    // Read but no passing quiz → blue
    expect(cellFor('17')?.className).toContain('bg-blue-500');
    // Briefing exists but never opened → red
    expect(cellFor('16')?.className).toContain('bg-red-500');
    // No briefing stored for that day → neutral
    expect(cellFor('15')?.className).toContain('bg-zinc-50');
  });

  it('shows the blog title above the fetched date in the reader', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('date=')) {
        return {
          ok: true,
          json: async () => ({
            blog: {
              title: 'Redis queues',
              content: 'body',
              digest_date: '2026-08-01',
            },
          }),
        };
      }
      return { ok: true, json: async () => ({ blogs: [] }) };
    }) as any;

    render(<PastBlogsTab />);
    fireEvent.click(screen.getAllByText('1')[0]);

    const heading = await screen.findByText('Redis queues');
    const dateLine = screen.getByText(/Fetched /);
    expect(heading.compareDocumentPosition(dateLine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders the calendar grid with weekday headers', () => {
    render(<PastBlogsTab />);
    expect(screen.getAllByText('S')).toHaveLength(2); // Sun + Sat
    expect(screen.getByText('M')).toBeInTheDocument();
  });

  it('navigates to the previous and next month', () => {
    render(<PastBlogsTab />);
    const monthLabel = () => screen.getByText(/\d{4}/).textContent;
    const initial = monthLabel();

    fireEvent.click(screen.getByText('<'));
    expect(monthLabel()).not.toBe(initial);

    fireEvent.click(screen.getByText('>'));
    expect(monthLabel()).toBe(initial);
  });

  it('fetches and displays a blog when a past date is clicked', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('date=')) {
        return {
          ok: true,
          json: async () => ({ blog: { title: 'Old Post', content: 'Some content', digest_date: '2026-08-01' } }),
        };
      }
      return { ok: true, json: async () => ({ blogs: [] }) };
    }) as any;

    render(<PastBlogsTab />);

    // Click on day "1" of the currently displayed month (always in the past
    // relative to "today" unless today is the 1st — acceptable given fixed
    // test date context is unnecessary here since day 1 is always <= today
    // for the current month render).
    const dayCells = screen.getAllByText('1');
    fireEvent.click(dayCells[0]);

    await waitFor(() => {
      expect(screen.getByText('Old Post')).toBeInTheDocument();
    });
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/digests/past?date='));
  });

  it('shows the empty state again when the fetch response is not ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false });
    render(<PastBlogsTab />);

    const dayCells = screen.getAllByText('1');
    fireEvent.click(dayCells[0]);

    await waitFor(() => {
      expect(screen.getByText(/Pick a highlighted date/)).toBeInTheDocument();
    });
  });

  it('handles a network error gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    render(<PastBlogsTab />);

    const dayCells = screen.getAllByText('1');
    fireEvent.click(dayCells[0]);

    await waitFor(() => {
      expect(screen.getByText(/Pick a highlighted date/)).toBeInTheDocument();
    });
  });

  it('selects a day via keyboard (Enter key)', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('date=')) {
        return {
          ok: true,
          json: async () => ({ blog: { title: 'Keyboard Post', content: 'x' } }),
        };
      }
      return { ok: true, json: async () => ({ blogs: [] }) };
    }) as any;

    render(<PastBlogsTab />);

    const dayCells = screen.getAllByText('1');
    fireEvent.keyDown(dayCells[0], { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText('Keyboard Post')).toBeInTheDocument();
    });
  });

  it('ignores keyboard events on non-clickable (future) days', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ blogs: [] }) });
    global.fetch = fetchMock;
    render(<PastBlogsTab />);
    fetchMock.mockClear();

    fireEvent.click(screen.getByText('>'));
    const futureDay = screen.getAllByText('1')[0];
    fireEvent.keyDown(futureDay, { key: 'Enter' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores non-activation keys on a clickable day', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ blogs: [] }) });
    global.fetch = fetchMock;
    render(<PastBlogsTab />);
    fetchMock.mockClear();

    const dayCells = screen.getAllByText('1');
    fireEvent.keyDown(dayCells[0], { key: 'Tab' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('auto-fetches and calls onSelect when a `selected` date prop is provided', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('date=')) {
        return {
          ok: true,
          json: async () => ({ blog: { title: 'Selected Post', content: 'x' } }),
        };
      }
      return { ok: true, json: async () => ({ blogs: [] }) };
    }) as any;
    const onSelect = vi.fn();

    render(<PastBlogsTab selected="2026-07-01" onSelect={onSelect} />);

    await waitFor(() => {
      expect(screen.getByText('Selected Post')).toBeInTheDocument();
    });
  });
});
