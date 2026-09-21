// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import InterviewSessionsPage from './page';

describe('InterviewSessionsPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows a loading spinner while sessions are being fetched', () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    render(<InterviewSessionsPage />);
    expect(screen.getByText('Interview Sessions')).toBeInTheDocument();
  });

  it('renders an empty state when there are no sessions', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ sessions: [] }),
    });
    render(<InterviewSessionsPage />);
    await waitFor(() =>
      expect(screen.getByText('No interview sessions yet. Create one from the extractor page.')).toBeInTheDocument(),
    );
  });

  it('renders a table row per session with a status badge', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        sessions: [
          {
            id: 's1',
            candidate_name: 'Jane Doe',
            candidate_email: 'jane@example.com',
            status: 'invite_issued',
            created_at: new Date().toISOString(),
          },
        ],
      }),
    });
    render(<InterviewSessionsPage />);
    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
    expect(screen.getByText('invite issued')).toBeInTheDocument();
  });

  it('falls back to placeholder text for a session with no name/email', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        sessions: [{ id: 's2', status: 'draft', created_at: null }],
      }),
    });
    render(<InterviewSessionsPage />);
    await waitFor(() => expect(screen.getByText('Unnamed candidate')).toBeInTheDocument());
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  it('shows an error message when the fetch fails', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Could not load sessions' }),
    });
    render(<InterviewSessionsPage />);
    await waitFor(() => expect(screen.getByText('Could not load sessions')).toBeInTheDocument());
  });

  it('reloads sessions when Refresh is clicked', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ sessions: [] }) });
    render(<InterviewSessionsPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('Refresh'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
