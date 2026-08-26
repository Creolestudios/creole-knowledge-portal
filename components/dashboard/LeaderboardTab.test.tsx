/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import LeaderboardTab from './LeaderboardTab';

// Mock fetch API globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('LeaderboardTab', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders loading state initially', () => {
    mockFetch.mockImplementationOnce(() => new Promise(() => {})); // Never resolves
    render(<LeaderboardTab />);
    expect(screen.getByText(/loading leaderboard/i)).toBeInTheDocument();
  });

  it('renders the leaderboard with users', async () => {
    const mockData = {
      leaderboard: [
        {
          userId: '1',
          email: 'test1@example.com',
          level: 5,
          readTimeSec: 3600,
          totalScore: 50,
          role: 'Admin',
        },
        {
          userId: '2',
          email: 'test2@example.com',
          level: 2,
          readTimeSec: 120,
          totalScore: 10,
          role: 'Reader',
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    });

    render(<LeaderboardTab />);

    await waitFor(() => {
      expect(screen.getByText('test1@example.com')).toBeInTheDocument();
      expect(screen.getByText('test2@example.com')).toBeInTheDocument();
    });

    expect(screen.getByText('1h 0m')).toBeInTheDocument(); // 3600 seconds
    expect(screen.getByText('2m')).toBeInTheDocument(); // 120 seconds
  });

  it('renders empty state if no users found', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ leaderboard: [] }),
    });

    render(<LeaderboardTab />);

    await waitFor(() => {
      expect(screen.getByText(/no users found/i)).toBeInTheDocument();
    });
  });
});
