// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import ReadingHeatmap from './ReadingHeatmap';
import ReadingTimer from './ReadingTimer';
import TopicMix from './TopicMix';
import CalendarSidebar from './CalendarSidebar';
import type { ActivityRecord } from '@/types/contracts';

vi.mock('@/lib/data/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));
import { logActivity } from '@/lib/data/activity';

function record(date: string, readSeconds: number): ActivityRecord {
  return { date, readSeconds, quizTaken: false, quizScore: 0, quizTotal: 0 };
}

function isoToday(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// ── ReadingHeatmap ────────────────────────────────────────────────────────────

describe('ReadingHeatmap', () => {
  it('renders a 12-week grid of day cells', () => {
    const { container } = render(<ReadingHeatmap records={[]} />);
    // 12 columns x 7 days
    expect(container.querySelectorAll('[title]')).toHaveLength(84);
  });

  it('renders the intensity legend', () => {
    render(<ReadingHeatmap records={[]} />);
    expect(screen.getByText('Less')).toBeInTheDocument();
    expect(screen.getByText('More')).toBeInTheDocument();
    expect(screen.getByText('Last 12 weeks')).toBeInTheDocument();
  });

  it('colours a day by its reading-time intensity band', () => {
    const { container } = render(
      <ReadingHeatmap
        records={[
          record(isoToday(-1), 0), // level 0
          record(isoToday(-2), 120), // level 1  (<5m)
          record(isoToday(-3), 400), // level 2  (<10m)
          record(isoToday(-4), 900), // level 3  (<20m)
          record(isoToday(-5), 3600), // level 4 (20m+)
        ]}
      />,
    );

    const cell = (iso: string) => container.querySelector(`[title^="${iso}"]`)!;
    expect(cell(isoToday(-1)).className).toContain('bg-zinc-100');
    expect(cell(isoToday(-2)).className).toContain('bg-green-200');
    expect(cell(isoToday(-3)).className).toContain('bg-green-300');
    expect(cell(isoToday(-4)).className).toContain('bg-green-400');
    expect(cell(isoToday(-5)).className).toContain('bg-green-600');
  });

  it('shows minutes in each cell tooltip', () => {
    const { container } = render(<ReadingHeatmap records={[record(isoToday(-1), 600)]} />);
    expect(container.querySelector(`[title="${isoToday(-1)}: 10 min"]`)).toBeTruthy();
  });
});

// ── TopicMix ──────────────────────────────────────────────────────────────────

describe('TopicMix', () => {
  it('renders an empty state when there are no topics', () => {
    render(<TopicMix topics={[]} />);
    expect(screen.getByText('No topics yet.')).toBeInTheDocument();
  });

  it('lists each topic with its count', () => {
    render(<TopicMix topics={[{ tag: 'react', count: 5 }, { tag: 'python', count: 2 }]} />);
    expect(screen.getByText('react')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('python')).toBeInTheDocument();
  });

  it('scales the bars relative to the highest count', () => {
    const { container } = render(
      <TopicMix topics={[{ tag: 'a', count: 10 }, { tag: 'b', count: 5 }]} />,
    );
    const bars = container.querySelectorAll('.bg-brand');
    expect((bars[0] as HTMLElement).style.width).toBe('100%');
    expect((bars[1] as HTMLElement).style.width).toBe('50%');
  });

  it('avoids dividing by zero when every count is zero', () => {
    const { container } = render(<TopicMix topics={[{ tag: 'a', count: 0 }]} />);
    expect((container.querySelector('.bg-brand') as HTMLElement).style.width).toBe('0%');
  });
});

// ── ReadingTimer ──────────────────────────────────────────────────────────────

describe('ReadingTimer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts at zero and counts up each second', () => {
    render(<ReadingTimer date="2026-08-01" />);
    expect(screen.getByText('00:00')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText('00:03')).toBeInTheDocument();
  });

  it('formats minutes and seconds with zero padding', () => {
    render(<ReadingTimer date="2026-08-01" />);
    act(() => {
      vi.advanceTimersByTime(65_000);
    });
    expect(screen.getByText('01:05')).toBeInTheDocument();
  });

  it('flushes accumulated seconds to the activity store every 30s', () => {
    render(<ReadingTimer date="2026-08-01" />);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });

    expect(logActivity).toHaveBeenCalledWith({ date: '2026-08-01', readSeconds: 30 });
  });

  it('flushes any remaining seconds on unmount', () => {
    const { unmount } = render(<ReadingTimer date="2026-08-01" />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    vi.clearAllMocks();

    unmount();
    expect(logActivity).toHaveBeenCalledWith({ date: '2026-08-01', readSeconds: 5 });
  });

  it('does not flush on unmount when nothing has accumulated', () => {
    const { unmount } = render(<ReadingTimer date="2026-08-01" />);
    unmount();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('pauses counting while the tab is hidden', () => {
    render(<ReadingTimer date="2026-08-01" />);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText('00:02')).toBeInTheDocument();

    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText('00:02')).toBeInTheDocument();

    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('00:03')).toBeInTheDocument();
  });
});

// ── CalendarSidebar ───────────────────────────────────────────────────────────

describe('CalendarSidebar', () => {
  const baseProps = {
    availableDates: ['2026-08-05', '2026-08-06'],
    statusByDate: {
      '2026-08-05': 'completed' as const,
      '2026-08-06': 'partial' as const,
    },
    selectedDate: '2026-08-05',
    onSelectDate: vi.fn(),
  };

  beforeEach(() => vi.clearAllMocks());

  it('opens on the month of the selected date', () => {
    render(<CalendarSidebar {...baseProps} />);
    expect(screen.getByText(/August 2026/)).toBeInTheDocument();
  });

  it('renders the status legend', () => {
    render(<CalendarSidebar {...baseProps} />);
    expect(screen.getByText('Read + quiz passed')).toBeInTheDocument();
    expect(screen.getByText('Partial (read or low quiz)')).toBeInTheDocument();
    expect(screen.getByText('Not attempted')).toBeInTheDocument();
  });

  it('raises onSelectDate when an available day is clicked', () => {
    render(<CalendarSidebar {...baseProps} />);
    fireEvent.click(screen.getByText('6'));
    expect(baseProps.onSelectDate).toHaveBeenCalledWith('2026-08-06');
  });

  it('does not raise onSelectDate for a day with no blog', () => {
    render(<CalendarSidebar {...baseProps} />);
    fireEvent.click(screen.getByText('20'));
    expect(baseProps.onSelectDate).not.toHaveBeenCalled();
  });

  it('colours available days by their engagement status', () => {
    render(<CalendarSidebar {...baseProps} />);
    expect(screen.getByText('5').className).toContain('green');
    expect(screen.getByText('6').className).toContain('amber');
  });

  it('navigates to the previous and next month', () => {
    const { container } = render(<CalendarSidebar {...baseProps} />);
    const [prev, next] = Array.from(container.querySelectorAll('button')).filter((b) =>
      b.querySelector('svg'),
    );

    fireEvent.click(prev);
    expect(screen.getByText(/July 2026/)).toBeInTheDocument();

    fireEvent.click(next);
    fireEvent.click(next);
    expect(screen.getByText(/September 2026/)).toBeInTheDocument();
  });

  it('falls back to the current month when nothing is selected', () => {
    const label = new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    render(<CalendarSidebar {...baseProps} selectedDate={null} />);
    expect(screen.getByText(new RegExp(label))).toBeInTheDocument();
  });
});
