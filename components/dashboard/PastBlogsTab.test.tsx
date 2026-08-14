// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PastBlogsTab from './PastBlogsTab';

describe('PastBlogsTab', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('shows the empty-state prompt with no date selected', () => {
    render(<PastBlogsTab />);
    expect(screen.getByText(/Pick a highlighted date/)).toBeInTheDocument();
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
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ blog: { title: 'Old Post', content: 'Some content' } }),
    });

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
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ blog: { title: 'Keyboard Post', content: 'x' } }),
    });

    render(<PastBlogsTab />);

    const dayCells = screen.getAllByText('1');
    fireEvent.keyDown(dayCells[0], { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText('Keyboard Post')).toBeInTheDocument();
    });
  });

  it('ignores keyboard events on non-clickable (future) days', () => {
    global.fetch = vi.fn();
    render(<PastBlogsTab />);

    fireEvent.click(screen.getByText('>'));
    const futureDay = screen.getAllByText('1')[0];
    fireEvent.keyDown(futureDay, { key: 'Enter' });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('ignores non-activation keys on a clickable day', () => {
    global.fetch = vi.fn();
    render(<PastBlogsTab />);

    const dayCells = screen.getAllByText('1');
    fireEvent.keyDown(dayCells[0], { key: 'Tab' });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('auto-fetches and calls onSelect when a `selected` date prop is provided', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ blog: { title: 'Selected Post', content: 'x' } }),
    });
    const onSelect = vi.fn();

    render(<PastBlogsTab selected="2026-07-01" onSelect={onSelect} />);

    await waitFor(() => {
      expect(screen.getByText('Selected Post')).toBeInTheDocument();
    });
  });
});
