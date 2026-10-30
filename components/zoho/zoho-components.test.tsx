// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ZohoFilterBar from './zoho-filter-bar';
import ZohoDateFilterPicker from './zoho-date-filter-picker';
import ZohoUserSelectDropdown from './zoho-user-select-dropdown';
import ZohoTillDateSummary from './zoho-till-date-summary';
import ZohoTaskCard from './zoho-task-card';
import ZohoTaskModal from './zoho-task-modal';
import ZohoReportModal from './zoho-report-modal';
import ZohoEvaluationManager from './zoho-evaluation-manager';
import { ZohoTaskItem, getMockZohoData } from '@/lib/zoho/service';

describe('Zoho Frontend Components', () => {
  describe('ZohoFilterBar', () => {
    it('renders filter tabs and responds to tab clicks', () => {
      const onChange = vi.fn();
      render(
        <ZohoFilterBar
          filter={{
            type: 'week',
            weekOffset: 0,
            monthOffset: 0,
            startDate: '',
            endDate: '',
            search: '',
          }}
          onChange={onChange}
        />
      );

      expect(screen.getByText('This Week')).toBeDefined();
      expect(screen.getByText('Last Week')).toBeDefined();
      expect(screen.getByText('This Month')).toBeDefined();

      const lastWeekBtn = screen.getByText('Last Week');
      fireEvent.click(lastWeekBtn);
      expect(onChange).toHaveBeenCalledWith({ type: 'week', weekOffset: -1 });
    });
  });

  describe('ZohoDateFilterPicker', () => {
    it('renders current week selection label and handles popover tabs', () => {
      const onChange = vi.fn();
      render(
        <ZohoDateFilterPicker
          value={{
            type: 'week',
            startDate: '2026-10-19',
            endDate: '2026-10-25',
            weekNumber: 43,
            label: '19-10-2026 to 25-10-2026 (WEEK - 43)',
          }}
          onChange={onChange}
        />
      );

      // Trigger button should display week label
      const trigger = screen.getByText('19-10-2026 to 25-10-2026 (WEEK - 43)');
      expect(trigger).toBeDefined();

      // Open popover
      fireEvent.click(trigger);

      // Should show tabs: week, month, range (day removed per user requirement)
      expect(screen.queryByText('day')).toBeNull();
      expect(screen.getByText('week')).toBeDefined();
      expect(screen.getByText('month')).toBeDefined();
      expect(screen.getByText('range')).toBeDefined();

      // Switch to month tab
      fireEvent.click(screen.getByText('month'));
      expect(screen.getByText('Current Month')).toBeDefined();
      expect(screen.getByText('Oct')).toBeDefined();

      // Switch to range tab
      fireEvent.click(screen.getByText('range'));
      expect(screen.getByText('Start:')).toBeDefined();
      expect(screen.getByText('End:')).toBeDefined();

      // Close via Cancel
      fireEvent.click(screen.getByText('Cancel'));
    });

    it('disables future weeks, months, and next navigation when at current period', () => {
      const onChange = vi.fn();
      const now = new Date();
      const day = now.getDay();
      const diffToMonday = day === 0 ? -6 : 1 - day;
      const monday = new Date(now);
      monday.setDate(now.getDate() + diffToMonday);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const startIso = monday.toISOString().split('T')[0];
      const endIso = sunday.toISOString().split('T')[0];

      render(
        <ZohoDateFilterPicker
          value={{
            type: 'week',
            startDate: startIso,
            endDate: endIso,
            weekNumber: 44,
            label: 'Current Week',
          }}
          onChange={onChange}
        />
      );

      // Next button on main bar should be disabled because we are on current week
      const nextBtn = screen.getByLabelText('Next Period') as HTMLButtonElement;
      expect(nextBtn.disabled).toBe(true);

      // Open popover and check month tab
      fireEvent.click(screen.getByText('Current Week'));
      fireEvent.click(screen.getByText('month'));

      // If current month is before December, December button should be disabled
      const decBtn = screen.getByText('Dec') as HTMLButtonElement;
      if (now.getMonth() < 11) {
        expect(decBtn.disabled).toBe(true);
      }
    });
  });

  describe('ZohoUserSelectDropdown', () => {
    const mockUsersList = [
      { userId: 'u1', email: 'user1@creolestudios.com' },
      { userId: 'u2', email: 'user2@creolestudios.com' },
      { userId: 'u3', email: 'user3@creolestudios.com' },
    ];

    it('renders dropdown with All Users option and handles selection changes', () => {
      const onChange = vi.fn();
      render(
        <ZohoUserSelectDropdown
          users={mockUsersList}
          selectedUserIds={['u1', 'u2', 'u3']}
          onChange={onChange}
        />
      );

      // Trigger button shows All Users
      const btn = screen.getByText('All Users (3)');
      expect(btn).toBeDefined();

      // Open dropdown
      fireEvent.click(btn);

      // Check All Users option
      const allUsersLabel = screen.getByText('All Users');
      expect(allUsersLabel).toBeDefined();
      expect(screen.getByText('user1@creolestudios.com')).toBeDefined();
      expect(screen.getByText('user2@creolestudios.com')).toBeDefined();

      // Click All Users checkbox to deselect all
      fireEvent.click(allUsersLabel);
      expect(onChange).toHaveBeenCalledWith([]);
    });

    it('handles individual user checkbox toggle', () => {
      const onChange = vi.fn();
      render(
        <ZohoUserSelectDropdown
          users={mockUsersList}
          selectedUserIds={['u1']}
          onChange={onChange}
        />
      );

      // Open dropdown
      fireEvent.click(screen.getByText('user1@creolestudios.com'));

      // Click user2 to add them
      const user2Label = screen.getByText('user2@creolestudios.com');
      fireEvent.click(user2Label);
      expect(onChange).toHaveBeenCalledWith(['u1', 'u2']);
    });
  });

  describe('ZohoTillDateSummary', () => {
    it('renders till-date summary cards with done, pending, delayed tasks, and weekly score', () => {
      render(
        <ZohoTillDateSummary
          userName="Jayesh Patel"
          userEmail="jayesh.patel@creolestudios.com"
          role="Full Stack Developer"
          yearsOfExperience={3}
          seniorityLevel="Mid"
          aiSubscriptions={['GitHub Copilot', 'ChatGPT Plus']}
          summary={{
            doneTasks: 28,
            pendingTasks: 3,
            delayedTasks: 1,
            weeklyAvgScore: 89,
            totalHoursLogged: 132.5,
          }}
        />
      );

      expect(screen.getByText('Jayesh Patel')).toBeDefined();
      expect(screen.getByText('Done Tasks')).toBeDefined();
      expect(screen.getByText('28')).toBeDefined();
      expect(screen.getByText('In Progress')).toBeDefined();
      expect(screen.getByText('3')).toBeDefined();
      expect(screen.getByText('Delayed Tasks')).toBeDefined();
      expect(screen.getByText('1')).toBeDefined();
      expect(screen.getByText('89')).toBeDefined();
      expect(screen.getByText('GitHub Copilot')).toBeDefined();
    });
  });

  describe('ZohoTaskCard', () => {
    const mockTask: ZohoTaskItem = {
      id: 'task-1',
      zohoTaskId: 'z-101',
      projectId: 'p-1',
      projectName: 'Creole Knowledge Portal',
      taskName: 'Implement Supabase RLS security policies',
      taskDescription: 'Author idempotent policies for user tables',
      zohoStatus: 'QA Review',
      isQAReview: true,
      plannedHours: 4.0,
      actualHours: 4.08,
      taskDate: '2026-10-28',
      zohoLink: 'https://projects.zoho.com/portal/creole#taskdetail/p-1/z-101',
      comments: [{ author: 'Jayesh', content: 'Moved to QA', time: '2:00 PM' }],
      evaluation: {
        overallScore: 94,
        timeScore: 100,
        commentQualityScore: 90,
        complexityScore: 85,
        repetitionScore: 100,
        timeVarianceMinutes: 5,
        timeAssessmentLabel: 'SLIGHT_OVERRUN_TOLERATED',
        isRepetitive: false,
        repetitionSimilarityPct: 0,
        matchedTaskId: null,
        summaryFeedback: '4:05 logged on 4h task. 5m overrun is within buffer.',
        strengths: ['Punctual delivery'],
        improvements: [],
        aiModelUsed: 'gemini-2.5-flash',
      },
    };

    it('renders direct clickable Zoho task link and hours pill', () => {
      const onClick = vi.fn();
      render(<ZohoTaskCard task={mockTask} onClick={onClick} />);

      expect(screen.getByText('Implement Supabase RLS security policies')).toBeDefined();
      expect(screen.getByText('QA Review')).toBeDefined();

      const zohoLink = screen.getByTitle('Open this task directly in Zoho Projects');
      expect(zohoLink.getAttribute('href')).toBe('https://projects.zoho.com/portal/creole#taskdetail/p-1/z-101');
      expect(zohoLink.getAttribute('target')).toBe('_blank');

      // Click card triggers modal opening
      fireEvent.click(screen.getByText('Implement Supabase RLS security policies'));
      expect(onClick).toHaveBeenCalledWith(mockTask);
    });
  });

  describe('ZohoTaskModal', () => {
    const mockTask: ZohoTaskItem = {
      id: 'task-1',
      zohoTaskId: 'z-101',
      projectId: 'p-1',
      projectName: 'Creole Knowledge Portal',
      taskName: 'Implement Supabase RLS security policies',
      taskDescription: 'Detailed description of task scope and RLS rules',
      zohoStatus: 'QA Review',
      isQAReview: true,
      plannedHours: 4.0,
      actualHours: 4.08,
      taskDate: '2026-10-28',
      zohoLink: 'https://projects.zoho.com/portal/creole#taskdetail/p-1/z-101',
      comments: [{ author: 'Jayesh Patel', content: 'Completed test run and verified RLS', time: '2:05 PM' }],
      evaluation: {
        overallScore: 94,
        timeScore: 100,
        commentQualityScore: 90,
        complexityScore: 85,
        repetitionScore: 100,
        timeVarianceMinutes: 5,
        timeAssessmentLabel: 'SLIGHT_OVERRUN_TOLERATED',
        isRepetitive: false,
        repetitionSimilarityPct: 0,
        matchedTaskId: null,
        summaryFeedback: '5-minute buffer respected with 100% time adherence.',
        strengths: ['Clean QA review handoff'],
        improvements: ['Keep task descriptions granular'],
        aiModelUsed: 'gemini-2.5-flash',
      },
    };

    it('displays description, hours, comments, and AI evaluation feedback', () => {
      const onClose = vi.fn();
      render(<ZohoTaskModal task={mockTask} onClose={onClose} />);

      expect(screen.getByText('Task Description')).toBeDefined();
      expect(screen.getByText('Detailed description of task scope and RLS rules')).toBeDefined();
      expect(screen.getByText('Planned Time')).toBeDefined();
      expect(screen.getAllByText('4 hrs').length).toBeGreaterThan(0);
      expect(screen.getByText('Related Comments (1)')).toBeDefined();
      expect(screen.getByText('Performance Evaluation')).toBeDefined();
      expect(screen.getByText('Time Adherence')).toBeDefined();
      expect(screen.getByText('Work Justification')).toBeDefined();
      expect(screen.getByText('Work Status')).toBeDefined();

      const closeBtn = screen.getByText('Close');
      fireEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalled();
    });

    it('renders the "Open in Zoho" link by default for admin users', () => {
      render(<ZohoTaskModal task={mockTask} onClose={vi.fn()} />);
      const zohoLink = screen.getByText('Open in Zoho');
      expect(zohoLink).toBeDefined();
    });

    it('removes the task link for Zoho when hideZohoLink is true for user portal', () => {
      render(<ZohoTaskModal task={mockTask} onClose={vi.fn()} hideZohoLink={true} />);
      expect(screen.queryByText('Open in Zoho')).toBeNull();
    });
  });

  describe('ZohoReportModal', () => {
    const mockUser = getMockZohoData()[0];

    it('does not render when isOpen is false', () => {
      const { container } = render(
        <ZohoReportModal
          isOpen={false}
          user={mockUser}
          filterType="week"
          onClose={vi.fn()}
        />
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders single user report when user is provided', () => {
      const onClose = vi.fn();
      render(
        <ZohoReportModal
          isOpen={true}
          user={mockUser}
          filterType="week"
          onClose={onClose}
        />
      );

      expect(screen.getByText('Employee Evaluation Report')).toBeDefined();
      expect(screen.getByText(/Generated for Jayesh Patel/)).toBeDefined();

      const closeBtn = screen.getByText('Close Report');
      fireEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalled();
    });

    it('renders multi-user team evaluation report when multiple users are provided', () => {
      const onClose = vi.fn();
      const mockUsers = getMockZohoData();
      render(
        <ZohoReportModal
          isOpen={true}
          users={mockUsers}
          filterType="week"
          dateRangeText="19-10-2026 to 25-10-2026"
          onClose={onClose}
        />
      );

      expect(screen.getByText('Team Evaluation & Performance Report')).toBeDefined();
      expect(screen.getByText(/Generated for 2 Employees/)).toBeDefined();
      expect(screen.getByText('Avg Team Score')).toBeDefined();
      expect(screen.getByText('Team Executive Summary')).toBeDefined();
      expect(screen.getByText('Selected Employees (2)')).toBeDefined();

      const closeBtn = screen.getByText('Close Report');
      fireEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('ZohoEvaluationManager', () => {
    const mockUsers = [
      ...getMockZohoData(),
      {
        userId: 'admin-user-1',
        email: 'priya.dhanani@creolestudios.com',
        name: 'Priya Dhanani',
        role: 'admin',
        yearsOfExperience: 5,
        seniorityLevel: 'Senior',
        aiSubscriptions: [],
        tillDateSummary: {
          doneTasks: 10,
          pendingTasks: 0,
          delayedTasks: 0,
          weeklyAvgScore: 95,
          totalHoursLogged: 40,
        },
        dailyEvaluations: [],
      },
    ];

    it('lists all user emails initially (excluding admins) and shows date-wise task data upon clicking a user', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/api/admin/zoho/users')) {
          return {
            ok: true,
            json: async () => ({ users: mockUsers }),
          };
        }
        return { ok: true, json: async () => ({}) };
      });

      render(<ZohoEvaluationManager />);

      // Verify Initial State: Lists user emails and excludes admin
      await waitFor(() => {
        expect(screen.getByText('jayesh.patel@creolestudios.com')).toBeDefined();
      });
      expect(screen.getByText('Zoho Users')).toBeDefined();
      expect(screen.getByText('srushti.amin@creolestudios.com')).toBeDefined();
      expect(screen.queryByText('priya.dhanani@creolestudios.com')).toBeNull();

      // Click on user email "jayesh.patel@creolestudios.com"
      const jayeshCard = screen.getByText('jayesh.patel@creolestudios.com');
      fireEvent.click(jayeshCard);

      // Verify User Detail View: Shows date-wise list of task titles
      await waitFor(() => {
        expect(screen.getByText('Back to All Users')).toBeDefined();
      });
      expect(screen.getByText('Implement Supabase RLS security policies')).toBeDefined();
      expect(screen.getByText('Optimize blog digest query caching with Redis')).toBeDefined();

      // Click a task title to open task detail modal
      fireEvent.click(screen.getByText('Implement Supabase RLS security policies'));
      await waitFor(() => {
        expect(screen.getByText('Task Description')).toBeDefined();
      });
      expect(screen.getByText('Write idempotent PostgreSQL policies for zoho_tasks and zoho_task_evaluations tables to enforce strict user boundaries.')).toBeDefined();

      // Close modal
      const closeBtn = screen.getByText('Close');
      fireEvent.click(closeBtn);

      // Click "Back to All Users" to return to list of all user emails
      const backBtn = screen.getByText('Back to All Users');
      fireEvent.click(backBtn);

      await waitFor(() => {
        expect(screen.getByText('srushti.amin@creolestudios.com')).toBeDefined();
      });
      expect(screen.getByText('Zoho Users')).toBeDefined();
    });

    it('triggers sync when "Sync from Zoho" button is clicked', async () => {
      const mockFetch = vi.fn().mockImplementation(async (url: string, opts?: any) => {
        if (url.includes('/api/admin/zoho/sync') && opts?.method === 'POST') {
          return {
            ok: true,
            json: async () => ({ success: true, lastSyncedAt: '2026-10-29T10:00:00.000Z', taskCount: 50 }),
          };
        }
        if (url.includes('/api/admin/zoho/users')) {
          return {
            ok: true,
            json: async () => ({ users: mockUsers, isLive: true, lastSyncedAt: '2026-10-29T10:00:00.000Z' }),
          };
        }
        return { ok: true, json: async () => ({}) };
      });
      global.fetch = mockFetch;

      render(<ZohoEvaluationManager />);

      await waitFor(() => {
        expect(screen.getByText('Sync from Zoho')).toBeDefined();
      });

      fireEvent.click(screen.getByText('Sync from Zoho'));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/admin/zoho/sync', { method: 'POST' });
      });
    });
  });
});
