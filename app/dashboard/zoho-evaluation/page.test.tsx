// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MyZohoEvaluationPage from './page';

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1', email: 'jayesh.patel@creolestudios.com' } },
        error: null,
      }),
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { current_role: 'Full Stack Developer' },
        error: null,
      }),
    })),
  })),
}));

vi.mock('@/components/dashboard/DashboardShell', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dashboard-shell">{children}</div>
  ),
}));

vi.mock('@/components/logout-button', () => ({
  default: () => <button type="button">Logout</button>,
}));

const mockEvaluationData = {
  userId: 'mock-user-1',
  email: 'jayesh.patel@creolestudios.com',
  name: 'Jayesh Patel',
  role: 'Full Stack Developer',
  yearsOfExperience: 3,
  seniorityLevel: 'Mid',
  aiSubscriptions: ['GitHub Copilot'],
  tillDateSummary: {
    doneTasks: 28,
    pendingTasks: 3,
    delayedTasks: 1,
    weeklyAvgScore: 89,
    totalHoursLogged: 132.5,
  },
  dailyEvaluations: [
    {
      date: '2026-10-30',
      dayScore: 90,
      summary: 'Completed 2 key backend tasks.',
      tasks: [
        {
          id: 'task-1',
          zohoTaskId: 'z-101',
          projectId: 'p-1',
          projectName: 'CKP Portal (Creole Knowledge Portal)',
          taskName: 'User-Wise Daily Task Evaluation & Analysis',
          taskDescription: 'Build user-wise evaluation components',
          zohoStatus: 'Completed',
          isQAReview: false,
          plannedHours: 4.0,
          actualHours: 4.0,
          taskDate: '2026-10-30',
          zohoLink: 'https://projects.zoho.com/portal/creole#taskdetail/p-1/z-101',
          comments: [{ author: 'Jayesh', content: 'Completed implementation', time: '5:00 PM' }],
        },
        {
          id: 'task-2',
          zohoTaskId: 'z-102',
          projectId: 'p-1',
          projectName: 'CKP Portal (Creole Knowledge Portal)',
          taskName: 'Till-Date Task Analysis & Filter-Based Report Generation',
          taskDescription: 'Generate filter reports',
          zohoStatus: 'Completed',
          isQAReview: false,
          plannedHours: 4.0,
          actualHours: 4.0,
          taskDate: '2026-10-30',
          zohoLink: 'https://projects.zoho.com/portal/creole#taskdetail/p-1/z-102',
          comments: [],
        },
      ],
    },
    {
      date: '2026-10-29',
      dayScore: 85,
      summary: 'Completed admin portal reports.',
      tasks: [
        {
          id: 'task-3',
          zohoTaskId: 'z-103',
          projectId: 'p-1',
          projectName: 'CKP Portal (Creole Knowledge Portal)',
          taskName: 'Admin Portal Task Management, User-Wise Reports & Scoring Implementation',
          taskDescription: 'Admin portal scoring',
          zohoStatus: 'Completed',
          isQAReview: false,
          plannedHours: 4.0,
          actualHours: 4.0,
          taskDate: '2026-10-29',
          zohoLink: 'https://projects.zoho.com/portal/creole#taskdetail/p-1/z-103',
          comments: [],
        },
      ],
    },
  ],
};

describe('MyZohoEvaluationPage (User Portal Screen)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/user/zoho/my-evaluations')) {
        return {
          ok: true,
          json: async () => ({
            readOnly: true,
            evaluation: mockEvaluationData,
          }),
        };
      }
      return { ok: false, json: async () => ({}) };
    });
  });

  it('renders period filter, read-only indicator, and task list grouped by date matching screenshot', async () => {
    render(<MyZohoEvaluationPage />);

    // Header & Read Only indicator
    expect(screen.getByText('My Zoho Task Evaluations')).toBeDefined();
    expect(screen.getByText('Read Only')).toBeDefined();

    // Wait for user evaluation data to load
    await waitFor(() => {
      expect(screen.getByText('Jayesh Patel')).toBeDefined();
    });

    // Till-Date summary cards
    expect(screen.getByText('Done Tasks')).toBeDefined();
    expect(screen.getByText('28')).toBeDefined();

    // Period filter label and count pill
    expect(screen.getByText('Period:')).toBeDefined();
    expect(screen.getByText('3 tasks in selected period')).toBeDefined();

    // Date headers
    expect(screen.getByText('2026-10-30')).toBeDefined();
    expect(screen.getByText('2026-10-29')).toBeDefined();

    // Task rows with project tags
    expect(screen.getAllByText('CKP Portal (Creole Knowledge Portal)').length).toBe(3);
    expect(screen.getByText('User-Wise Daily Task Evaluation & Analysis')).toBeDefined();
    expect(screen.getByText('Till-Date Task Analysis & Filter-Based Report Generation')).toBeDefined();
    expect(
      screen.getByText('Admin Portal Task Management, User-Wise Reports & Scoring Implementation')
    ).toBeDefined();
  });

  it('opens task evaluation popup when clicking a task and removes Zoho link in popup for user', async () => {
    render(<MyZohoEvaluationPage />);

    await waitFor(() => {
      expect(screen.getByText('User-Wise Daily Task Evaluation & Analysis')).toBeDefined();
    });

    // Click on the task name to open evaluation modal
    fireEvent.click(screen.getByText('User-Wise Daily Task Evaluation & Analysis'));

    // Modal opens with evaluation details
    await waitFor(() => {
      expect(screen.getByText('Performance Evaluation')).toBeDefined();
    });

    expect(screen.getByText('Time Adherence')).toBeDefined();
    expect(screen.getByText('Work Justification')).toBeDefined();
    expect(screen.getByText('Work Status')).toBeDefined();

    // CRITICAL USER REQUIREMENT: In popup remove task link for zoho in user
    expect(screen.queryByText('Open in Zoho')).toBeNull();
  });
});
