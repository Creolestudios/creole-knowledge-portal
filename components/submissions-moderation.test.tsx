// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SubmissionsModeration from './submissions-moderation';

const sampleSubmissions = [
  {
    id: 'sub-1',
    title: 'A Great Blog Post',
    content: 'Full body content here.',
    author: 'dev@creolestudios.com',
    status: 'PENDING_QUIZ',
    validationReport: {
      qualityScore: 85,
      gibberishDetected: false,
      lowQualityDetected: false,
      aiSpamDetected: false,
      plagiarismOverlap: 5,
      reason: 'Looks solid.',
    },
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  },
  {
    id: 'sub-2',
    title: 'Another Post',
    content: 'x',
    author: 'other@creolestudios.com',
    status: 'APPROVED',
    createdAt: '2026-08-02T00:00:00Z',
    updatedAt: '2026-08-02T00:00:00Z',
  },
];

const sampleLogs = [
  {
    id: 'log-1',
    submissionId: 'sub-1',
    action: 'SUBMITTED',
    performedBy: 'dev@creolestudios.com',
    timestamp: '2026-08-01T00:00:00Z',
    details: 'Blog submitted',
  },
];

function mockFetchImpl(overrides: { moderateOk?: boolean; moderateError?: string } = {}) {
  return vi.fn().mockImplementation((url: string, opts?: any) => {
    if (url === '/api/submissions') {
      return Promise.resolve({ ok: true, json: async () => ({ submissions: sampleSubmissions }) });
    }
    if (url === '/api/admin/audit-logs') {
      return Promise.resolve({ ok: true, json: async () => ({ auditLogs: sampleLogs }) });
    }
    if (url.includes('/moderate')) {
      if (overrides.moderateOk === false) {
        return Promise.resolve({ ok: false, json: async () => ({ error: overrides.moderateError || 'failed' }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ submission: sampleSubmissions[0] }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

describe('SubmissionsModeration', () => {
  const originalFetch = global.fetch;

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('shows a loading state, then the submission list', async () => {
    global.fetch = mockFetchImpl();
    render(<SubmissionsModeration />);
    expect(screen.getByText(/Fetching submission logs/)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('A Great Blog Post')).toBeInTheDocument();
    });
    expect(screen.getByText('Another Post')).toBeInTheDocument();
  });

  it('filters submissions by search text', async () => {
    global.fetch = mockFetchImpl();
    render(<SubmissionsModeration />);
    await waitFor(() => screen.getByText('A Great Blog Post'));

    fireEvent.change(screen.getByPlaceholderText(/Search title or author/), {
      target: { value: 'Another' },
    });
    expect(screen.queryByText('A Great Blog Post')).not.toBeInTheDocument();
    expect(screen.getByText('Another Post')).toBeInTheDocument();
  });

  it('filters submissions by status', async () => {
    global.fetch = mockFetchImpl();
    render(<SubmissionsModeration />);
    await waitFor(() => screen.getByText('A Great Blog Post'));

    fireEvent.change(screen.getByDisplayValue('All Statuses'), { target: { value: 'APPROVED' } });
    expect(screen.queryByText('A Great Blog Post')).not.toBeInTheDocument();
    expect(screen.getByText('Another Post')).toBeInTheDocument();
  });

  it('expands a submission to show its validation report and content', async () => {
    global.fetch = mockFetchImpl();
    render(<SubmissionsModeration />);
    await waitFor(() => screen.getByText('A Great Blog Post'));

    fireEvent.click(screen.getByText('A Great Blog Post'));
    expect(screen.getByText('Full body content here.')).toBeInTheDocument();
    expect(screen.getByText('Passed Screen')).toBeInTheDocument();
    expect(screen.getByText('Looks solid.')).toBeInTheDocument();
  });

  it('expands a submission via keyboard (Enter key)', async () => {
    global.fetch = mockFetchImpl();
    render(<SubmissionsModeration />);
    await waitFor(() => screen.getByText('A Great Blog Post'));

    fireEvent.keyDown(screen.getByText('A Great Blog Post'), { key: 'Enter' });
    expect(screen.getByText('Full body content here.')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByText('A Great Blog Post'), { key: ' ' });
    expect(screen.queryByText('Full body content here.')).not.toBeInTheDocument();
  });

  it('ignores non-activation keys on the submission header', async () => {
    global.fetch = mockFetchImpl();
    render(<SubmissionsModeration />);
    await waitFor(() => screen.getByText('A Great Blog Post'));

    fireEvent.keyDown(screen.getByText('A Great Blog Post'), { key: 'Tab' });
    expect(screen.queryByText('Full body content here.')).not.toBeInTheDocument();
  });

  it('switches to the Audit Logs tab and renders the timeline', async () => {
    global.fetch = mockFetchImpl();
    render(<SubmissionsModeration />);
    await waitFor(() => screen.getByText('A Great Blog Post'));

    fireEvent.click(screen.getByText(/System Audit Logs/));
    await waitFor(() => {
      expect(screen.getByText('Blog submitted')).toBeInTheDocument();
    });
  });

  it('shows the empty audit-log state when there are none', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === '/api/submissions') return Promise.resolve({ ok: true, json: async () => ({ submissions: [] }) });
      if (url === '/api/admin/audit-logs') return Promise.resolve({ ok: true, json: async () => ({ auditLogs: [] }) });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    render(<SubmissionsModeration />);
    await waitFor(() => screen.getByText('No matching submissions found.'));

    fireEvent.click(screen.getByText(/System Audit Logs/));
    await waitFor(() => {
      expect(screen.getByText('No audit logs recorded yet.')).toBeInTheDocument();
    });
  });

  it('approves a submission via manual override and refreshes the list', async () => {
    global.fetch = mockFetchImpl();
    render(<SubmissionsModeration />);
    await waitFor(() => screen.getByText('A Great Blog Post'));
    fireEvent.click(screen.getByText('A Great Blog Post'));

    fireEvent.click(screen.getByText('Approve Override'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/submissions/sub-1/moderate',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('shows an error message when moderation fails', async () => {
    global.fetch = mockFetchImpl({ moderateOk: false, moderateError: 'Cannot moderate this item' });
    render(<SubmissionsModeration />);
    await waitFor(() => screen.getByText('A Great Blog Post'));
    fireEvent.click(screen.getByText('A Great Blog Post'));

    fireEvent.click(screen.getByText('Flag / Reject'));

    await waitFor(() => {
      expect(screen.getByText('Cannot moderate this item')).toBeInTheDocument();
    });
  });

  it('does not show moderation controls for an already-approved submission', async () => {
    global.fetch = mockFetchImpl();
    render(<SubmissionsModeration />);
    await waitFor(() => screen.getByText('Another Post'));
    fireEvent.click(screen.getByText('Another Post'));

    expect(screen.queryByText('Approve Override')).not.toBeInTheDocument();
  });
});
