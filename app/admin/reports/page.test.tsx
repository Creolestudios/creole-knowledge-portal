// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import InterviewReportsPage from './page';

describe('InterviewReportsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('removes search input and filter buttons from the page', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        reports: [],
        pagination: { page: 1, limit: 10, total: 0, totalPages: 1 },
        stats: { total: 0, completed: 0, terminated: 0, avgCognitive: null },
      }),
    });

    render(<InterviewReportsPage />);

    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/Search candidate name/i)).toBeNull();
      expect(screen.queryByText('All Verdicts')).toBeNull();
      expect(screen.queryByText('⭐ Strong Hire')).toBeNull();
      expect(screen.queryByText('In Progress')).toBeNull();
    });
  });

  it('renders report summaries and pagination controls when multiple pages exist', async () => {
    const mockReportsPage1 = [
      {
        id: 'rep-1',
        candidateName: 'John Candidate',
        candidateEmail: 'john@example.com',
        jobTitle: 'Software Architect',
        status: 'completed',
        completedAt: '2026-10-09T10:00:00Z',
        cognitiveScore: 88,
        fluencyScore: 92,
        fluencyCefr: 'C1',
        terminationReason: null,
        recommendation: 'strong_yes',
        recommendationRationale: 'Great interview',
        flags: [],
        voiceWarnings: 0,
        faceWarnings: 0,
        objectWarnings: 0,
        hasReport: true,
      },
    ];

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('page=2')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            reports: [
              {
                id: 'rep-2',
                candidateName: 'Jane NextPage',
                candidateEmail: 'jane@example.com',
                jobTitle: 'Backend Engineer',
                status: 'terminated',
                completedAt: '2026-10-09T11:00:00Z',
                cognitiveScore: 0,
                fluencyScore: 0,
                fluencyCefr: null,
                terminationReason: 'Proctoring violation',
                recommendation: 'no',
                recommendationRationale: 'Terminated',
                flags: ['interview_terminated'],
                voiceWarnings: 3,
                faceWarnings: 0,
                objectWarnings: 0,
                hasReport: true,
              },
            ],
            pagination: { page: 2, limit: 10, total: 15, totalPages: 2 },
            stats: { total: 15, completed: 10, terminated: 5, avgCognitive: 85 },
          }),
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({
          reports: mockReportsPage1,
          pagination: { page: 1, limit: 10, total: 15, totalPages: 2 },
          stats: { total: 15, completed: 10, terminated: 5, avgCognitive: 85 },
        }),
      });
    });

    render(<InterviewReportsPage />);

    // Check candidate card from page 1 is displayed
    await waitFor(() => {
      expect(screen.getByText('John Candidate')).toBeDefined();
      expect(screen.getByText('🎯 Software Architect')).toBeDefined();
    });

    // Check stats are displayed
    expect(screen.getAllByText('15').length).toBeGreaterThanOrEqual(1); // Total Interviews & pagination
    expect(screen.getByText('85/100')).toBeDefined(); // Avg Cognitive

    // Check pagination controls
    const nextBtn = screen.getByRole('button', { name: /next/i });
    expect(nextBtn).toBeDefined();

    // Click Next button to navigate to page 2
    fireEvent.click(nextBtn);

    await waitFor(() => {
      expect(screen.getByText('Jane NextPage')).toBeDefined();
    });
  });
});
