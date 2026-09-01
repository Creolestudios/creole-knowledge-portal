// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PastBlogsTab from './PastBlogsTab';

describe('PastBlogsTab', () => {
  const originalFetch = global.fetch;

  /**
   * First day cell the user can actually select. Weekends carry no briefing and
   * are inert, so tests must not assume the 1st of the month is clickable.
   */
  const firstSelectableDayCell = () => {
    const cell = screen
      .getAllByRole('button')
      .find((el) => el.className.includes('aspect-square'));
    if (!cell) throw new Error('no selectable day cell rendered');
    return cell;
  };

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

  it('greys out past weekends and excludes them from selection', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/api/activity')) {
        return { ok: true, json: async () => ({ records: [] }) };
      }
      if (String(url).includes('date=')) {
        return { ok: true, json: async () => ({ blog: null }) };
      }
      return {
        ok: true,
        json: async () => ({
          blogs: [{ title: 'Saturday backfill', digest_date: '2026-07-18' }],
        }),
      };
    }) as any;

    render(<PastBlogsTab />);

    const prev = screen.getByText('<');
    for (let i = 0; i < 24; i++) {
      if (screen.queryByText('July 2026')) break;
      fireEvent.click(prev);
    }

    const cell = (day: string) =>
      screen.getAllByText(day).find((el) => el.className.includes('aspect-square'));

    // 4 Jul 2026 is a Saturday and 5 Jul a Sunday: no briefing is generated, so
    // they must read as inert grey rather than the red "missed" state.
    await waitFor(() => {
      expect(cell('4')?.className).toContain('bg-zinc-100');
    });
    expect(cell('5')?.className).toContain('bg-zinc-100');
    expect(cell('4')?.className).not.toContain('bg-red-500');
    expect(cell('4')).not.toHaveAttribute('role', 'button');
    expect(cell('4')).toHaveAttribute('title', 'No briefing on weekends');

    // A weekday with no briefing keeps its existing neutral, selectable state.
    expect(cell('3')?.getAttribute('role')).toBe('button');

    // A weekend that genuinely has a backfilled briefing stays selectable.
    expect(cell('18')?.getAttribute('role')).toBe('button');
    expect(cell('18')?.className).toContain('bg-red-500');

    expect(screen.getByText('Weekend (No Briefing)')).toBeInTheDocument();
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
    fireEvent.click(firstSelectableDayCell());

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

    // First selectable (past, non-weekend) day of the displayed month.
    fireEvent.click(firstSelectableDayCell());

    await waitFor(() => {
      expect(screen.getByText('Old Post')).toBeInTheDocument();
    });
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/digests/past?date='));
  });

  it('shows the empty state again when the fetch response is not ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false });
    render(<PastBlogsTab />);

    fireEvent.click(firstSelectableDayCell());

    await waitFor(() => {
      expect(screen.getByText(/Pick a highlighted date/)).toBeInTheDocument();
    });
  });

  it('handles a network error gracefully', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    render(<PastBlogsTab />);

    fireEvent.click(firstSelectableDayCell());

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

    fireEvent.keyDown(firstSelectableDayCell(), { key: 'Enter' });

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

    fireEvent.keyDown(firstSelectableDayCell(), { key: 'Tab' });

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
