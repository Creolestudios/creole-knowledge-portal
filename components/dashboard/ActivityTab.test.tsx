// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import ActivityTab from './ActivityTab';

const originalFetch = global.fetch;

function mockActivity(records: any[], streak = 0) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, records, streak }),
  }) as any;
}

describe('ActivityTab', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renders one row per attempt with its own status and score', async () => {
    mockActivity([
      {
        date: '2026-09-03',
        read_seconds: 300,
        quiz_taken: true,
        quiz_score: 9,
        quiz_total: 15,
        attempts: [
          { attempt_number: 1, correct_answers: 1, total_questions: 5, passed: false, in_progress: false },
          { attempt_number: 2, correct_answers: 3, total_questions: 5, passed: true, in_progress: false },
          { attempt_number: 3, correct_answers: 5, total_questions: 5, passed: true, in_progress: false },
        ],
      },
    ]);

    render(<ActivityTab user={{ id: 'u1' }} />);

    await waitFor(() => expect(screen.getByText('Try 1')).toBeInTheDocument());
    expect(screen.getByText('Try 2')).toBeInTheDocument();
    expect(screen.getByText('Try 3')).toBeInTheDocument();

    // Each attempt keeps its own score rather than one merged total.
    expect(screen.getByText('1/5')).toBeInTheDocument();
    expect(screen.getByText('3/5')).toBeInTheDocument();
    expect(screen.getByText('5/5')).toBeInTheDocument();

    // 3+ correct passes, below that fails.
    expect(screen.getAllByText('Passed')).toHaveLength(2);
    expect(screen.getAllByText('Failed')).toHaveLength(1);

    // The merged 9/15 total is no longer shown.
    expect(screen.queryByText('9/15')).not.toBeInTheDocument();

    // Read time is shown once for the day, on the first attempt row.
    expect(screen.getAllByText('5m 0s')).toHaveLength(1);
  });

  it('marks an unfinished attempt as in progress with no score', async () => {
    mockActivity([
      {
        date: '2026-09-03',
        read_seconds: 60,
        quiz_taken: false,
        quiz_started: true,
        attempts: [
          { attempt_number: 1, correct_answers: 2, total_questions: 3, passed: false, in_progress: true },
        ],
      },
    ]);

    render(<ActivityTab user={{ id: 'u1' }} />);

    await waitFor(() => expect(screen.getByText('In progress')).toBeInTheDocument());
    expect(screen.queryByText('Failed')).not.toBeInTheDocument();
    expect(screen.queryByText('2/3')).not.toBeInTheDocument();
  });

  it('shows a single skipped row for a day with no attempts', async () => {
    mockActivity([
      { date: '2026-09-03', read_seconds: 120, quiz_taken: false, attempts: [] },
    ]);

    render(<ActivityTab user={{ id: 'u1' }} />);

    await waitFor(() => expect(screen.getByText('Skipped')).toBeInTheDocument());
    const row = screen.getByText('Skipped').closest('tr')!;
    expect(within(row).getByText('2m 0s')).toBeInTheDocument();
  });

  it('handles a records payload with no attempts field', async () => {
    mockActivity([{ date: '2026-09-03', read_seconds: 0, quiz_taken: false }]);

    render(<ActivityTab user={{ id: 'u1' }} />);
    await waitFor(() => expect(screen.getByText('Skipped')).toBeInTheDocument());
  });

  it('renders the empty state when there is no activity', async () => {
    mockActivity([]);
    render(<ActivityTab user={{ id: 'u1' }} />);
    await waitFor(() =>
      expect(screen.getByText('No activity recorded yet.')).toBeInTheDocument(),
    );
  });
});
