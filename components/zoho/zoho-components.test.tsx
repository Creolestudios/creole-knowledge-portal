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
import ZohoDailyEvaluationModal from './zoho-daily-evaluation-modal';
import ZohoWeeklyEvaluationModal from './zoho-weekly-evaluation-modal';
import { formatZohoDurationToClock, formatMinutesToClock } from '@/lib/zoho/client';
import ZohoReportModal, { calculatePeriodCapacity } from './zoho-report-modal';
import ZohoEvaluationManager from './zoho-evaluation-manager';
import { ZohoTaskItem, ZohoUserSummary, getMockZohoData, buildWeeklyPerformanceReports } from '@/lib/zoho/service';

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
      expect(screen.queryByText('View Full Weekly Audit & Appended History')).toBeNull();
    });

    it('renders separate filter metrics on the left bar and till-date score on the purple button without the word Dossier', () => {
      const onOpenWeeklyReport = vi.fn();
      render(
        <ZohoTillDateSummary
          hideProfileHeader={true}
          userName="Srushti Amin"
          userEmail="srushti.amin@creolestudios.com"
          role="Junior developer"
          yearsOfExperience={1}
          seniorityLevel="Junior"
          aiSubscriptions={['Antigravity Pro']}
          filterSummary={{
            doneTasks: 19,
            pendingTasks: 0,
            delayedTasks: 9,
            weeklyAvgScore: 38,
            totalHoursLogged: 156.8,
          }}
          summary={{
            doneTasks: 38,
            pendingTasks: 0,
            delayedTasks: 9,
            weeklyAvgScore: 72,
            totalHoursLogged: 320.0,
          }}
          onOpenWeeklyReport={onOpenWeeklyReport}
          weekLabel="RECORD UP TO SEP 2026"
        />
      );

      // Left quick-metric bar shows filter period metrics
      expect(screen.getByText('19')).toBeDefined();
      expect(screen.getByText('156.8h')).toBeDefined();
      expect(screen.getByText('38')).toBeDefined(); // filter score

      // Right purple button displays Till-Date Evaluation Report (without word Dossier) and till-date score
      expect(screen.getByText('Till-Date Evaluation Report (Weekly Additions)')).toBeDefined();
      expect(screen.getByText('72/100')).toBeDefined(); // cumulative till-date score
      expect(screen.queryByText(/Dossier/i)).toBeNull();

      fireEvent.click(screen.getByText('Till-Date Evaluation Report (Weekly Additions)'));
      expect(onOpenWeeklyReport).toHaveBeenCalled();
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
      expect(screen.getAllByText('4:00 hrs').length).toBeGreaterThan(0);
      expect(screen.getByText('Related Comments (1)')).toBeDefined();
      expect(screen.getByText('Performance Evaluation')).toBeDefined();
      expect(screen.getByText('Time Spent')).toBeDefined();
      expect(screen.getByText('Score')).toBeDefined();
      expect(screen.queryByText('Tolerance Status')).toBeNull();
      expect(screen.queryByText('Work Status')).toBeNull();

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

    it('displays 0 hrs and Not Logged tolerance status when user has not logged hours', () => {
      const unloggedTask = {
        ...mockTask,
        actualHours: 0,
        plannedHours: 8,
      };
      render(<ZohoTaskModal task={unloggedTask} onClose={vi.fn()} />);
      expect(screen.getByText('0:00 hrs')).toBeDefined();
      expect(screen.getByText('8:00 hrs')).toBeDefined();
      expect(screen.getAllByText('Not Logged').length).toBeGreaterThan(0);
    });

    it('displays "Less Accurate" on Work Justification when comment exists but is vague or checklist status', () => {
      const vagueTask = {
        ...mockTask,
        taskDescription: 'Do Server (Ubuntu) Upgrade. Do php upgrade Update 3 plugins on live Testing on live.',
        comments: [
          {
            author: 'Mahek Kalola',
            content: 'Do Server (Ubuntu) Upgrade. - Done Do php upgrade - Done Update 3 plugins on live - 1 is done 2 are pending which are depnedent on key by client. Testing on live. - Done',
            time: '12:00 PM',
          },
        ],
      };
      render(<ZohoTaskModal task={vagueTask} onClose={vi.fn()} />);
      expect(screen.getByText('Less Accurate')).toBeDefined();
      expect(screen.queryByText('No Comments')).toBeNull();
    });

    it('displays "No Comments" on Work Justification when zero comments are logged', () => {
      const noCommentsTask = {
        ...mockTask,
        comments: [],
      };
      render(<ZohoTaskModal task={noCommentsTask} onClose={vi.fn()} />);
      expect(screen.getByText('No Comments')).toBeDefined();
    });

    it('locks body overflow to hidden when modal mounts and restores it upon unmount', () => {
      document.body.style.overflow = 'visible';
      document.documentElement.style.overflow = 'visible';

      const { unmount } = render(<ZohoTaskModal task={mockTask} onClose={vi.fn()} />);

      expect(document.body.style.overflow).toBe('hidden');
      expect(document.documentElement.style.overflow).toBe('hidden');

      unmount();

      expect(document.body.style.overflow).toBe('visible');
      expect(document.documentElement.style.overflow).toBe('visible');
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

    it('scopes completion velocity and hours logged to the selected period rather than till-date totals', () => {
      const userWithDiscrepancy: ZohoUserSummary = {
        ...mockUser,
        filterSummary: {
          doneTasks: 1,
          pendingTasks: 1,
          delayedTasks: 0,
          weeklyAvgScore: 80,
          totalHoursLogged: 7.5,
        },
        tillDateSummary: {
          doneTasks: 31,
          pendingTasks: 1,
          delayedTasks: 12,
          weeklyAvgScore: 39,
          totalHoursLogged: 288.5,
        },
        dailyEvaluations: [
          {
            date: '2026-10-27',
            dayScore: 90,
            summary: 'Completed 2 tasks',
            tasks: [
              {
                id: 't-1',
                zohoTaskId: 'z-1',
                projectId: 'p-1',
                projectName: 'Proj',
                taskName: 'Task 1',
                taskDescription: 'Desc 1',
                zohoStatus: 'Closed',
                isQAReview: false,
                plannedHours: 4,
                actualHours: 4,
                taskDate: '2026-10-27',
                zohoLink: '',
                comments: [{ author: 'User', content: 'Done', time: '12:00' }],
                evaluation: {
                  overallScore: 90,
                  timeScore: 100,
                  workMatchScore: 90,
                  commentQualityScore: 90,
                  complexityScore: 80,
                  repetitionScore: 100,
                  timeVarianceMinutes: 0,
                  timeAssessmentLabel: 'ON_TIME',
                  isRepetitive: false,
                  repetitionSimilarityPct: 0,
                  matchedTaskId: null,
                  summaryFeedback: 'Good job',
                  strengths: ['Punctual'],
                  improvements: [],
                  aiModelUsed: 'gemini-2.5-flash',
                },
              },
              {
                id: 't-2',
                zohoTaskId: 'z-2',
                projectId: 'p-1',
                projectName: 'Proj',
                taskName: 'Task 2',
                taskDescription: 'Desc 2',
                zohoStatus: 'In Progress',
                isQAReview: false,
                plannedHours: 4,
                actualHours: 3.5,
                taskDate: '2026-10-27',
                zohoLink: '',
                comments: [],
                evaluation: {
                  overallScore: 70,
                  timeScore: 80,
                  workMatchScore: 60,
                  commentQualityScore: 60,
                  complexityScore: 80,
                  repetitionScore: 100,
                  timeVarianceMinutes: -30,
                  timeAssessmentLabel: 'ON_TIME',
                  isRepetitive: false,
                  repetitionSimilarityPct: 0,
                  matchedTaskId: null,
                  summaryFeedback: 'Needs improvement',
                  strengths: [],
                  improvements: ['Add comments'],
                  aiModelUsed: 'gemini-2.5-flash',
                },
              },
            ],
          },
        ],
      };

      render(
        <ZohoReportModal
          isOpen={true}
          user={userWithDiscrepancy}
          filterType="week"
          dateRangeText="26-10-2026 to 01-11-2026 (WEEK - 44)"
          onClose={vi.fn()}
        />
      );

      // Should show period hours: 7.5h / 40h planned capacity (NOT 288.5h) and task estimate 8h
      expect(screen.getAllByText(/7.5h/).length).toBeGreaterThan(0);
      expect(screen.getByText(/\/ 40h planned/)).toBeDefined();
      expect(screen.getByText(/Est: 8h/)).toBeDefined();
      expect(screen.queryByText(/288.5h/)).toBeNull();

      // Completion Velocity should be 1 / 2 (50%), NOT 31 / 2 (1550%)
      expect(screen.getByText(/1 \/ 2/)).toBeDefined();
      expect(screen.getAllByText(/50%/).length).toBeGreaterThan(0);
    });

    it('calculates full-time capacity for 3 weeks as 120 hours and displays daily hours breakdown', () => {
      // Test calculatePeriodCapacity helper directly
      const weeklyCap = calculatePeriodCapacity('week');
      expect(weeklyCap.capacityHours).toBe(40);
      expect(weeklyCap.weeksCount).toBe(1);

      const threeWeekRangeCap = calculatePeriodCapacity('range', '20-10-2026 to 05-11-2026');
      expect(threeWeekRangeCap.capacityHours).toBe(120);
      expect(threeWeekRangeCap.weeksCount).toBe(3);
      expect(threeWeekRangeCap.label).toContain('3 full weeks × 40h/week = 120h capacity');

      const monthCap = calculatePeriodCapacity('month');
      expect(monthCap.capacityHours).toBe(160);

      // Test ZohoReportModal renders 120h planned capacity and daily breakdown
      render(
        <ZohoReportModal
          isOpen={true}
          user={mockUser}
          filterType="range"
          dateRangeText="20-10-2026 to 05-11-2026"
          startDate="2026-10-20"
          endDate="2026-11-05"
          onClose={vi.fn()}
        />
      );

      // Verify 120h planned capacity is displayed
      expect(screen.getByText(/\/ 120h planned/)).toBeDefined();
      expect(screen.getAllByText(/3 full weeks × 40h\/week = 120h capacity/).length).toBeGreaterThan(0);

      // Verify Daily Hours Spent Breakdown section is rendered
      expect(screen.getByText(/Daily Hours Spent Breakdown/)).toBeDefined();
      expect(screen.getAllByText(/Daily Standard Capacity:/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/8.0h \/ day/).length).toBeGreaterThan(0);
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

    it('moves date filter and generate report inside user detail view and removes outer select user dropdown', async () => {
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

      // Outer view: Ensure "Select Users" dropdown is removed
      await waitFor(() => {
        expect(screen.getByText('jayesh.patel@creolestudios.com')).toBeDefined();
      });
      expect(screen.queryByText('Select Users')).toBeNull();

      // Click on a user
      fireEvent.click(screen.getByText('jayesh.patel@creolestudios.com'));

      // Inner view: Verify back arrow button and inside controls
      await waitFor(() => {
        expect(screen.getByLabelText('Back to All Users')).toBeDefined();
      });
      // Generate Report button is now inside the clicked user's view
      expect(screen.getByText('Generate Report')).toBeDefined();

      // Click Generate Report inside user view
      fireEvent.click(screen.getByText('Generate Report'));

      // Verify single employee evaluation report opens
      await waitFor(() => {
        expect(screen.getByText('Employee Evaluation Report')).toBeDefined();
        expect(screen.getByText(/Generated for Jayesh Patel/)).toBeDefined();
      });

      // Close report
      fireEvent.click(screen.getByText('Close Report'));
      await waitFor(() => {
        expect(screen.queryByText('Employee Evaluation Report')).toBeNull();
      });
    });

    it('resets date filter back to default week when selecting or switching between users', async () => {
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

      await waitFor(() => {
        expect(screen.getByText('jayesh.patel@creolestudios.com')).toBeDefined();
      });

      // Click on User A
      fireEvent.click(screen.getByText('jayesh.patel@creolestudios.com'));

      await waitFor(() => {
        expect(screen.getByLabelText('Back to All Users')).toBeDefined();
      });

      // Navigate back
      fireEvent.click(screen.getByLabelText('Back to All Users'));

      await waitFor(() => {
        expect(screen.getByText('srushti.amin@creolestudios.com')).toBeDefined();
      });

      // Click on User B - date filter is fresh for the new user
      fireEvent.click(screen.getByText('srushti.amin@creolestudios.com'));

      await waitFor(() => {
        expect(screen.getByLabelText('Back to All Users')).toBeDefined();
      });
      expect(screen.getByText('Generate Report')).toBeDefined();
    });

    it('displays loading indicator and dims view when date filtering is in flight', async () => {
      let resolveFetch: (val: any) => void;
      const delayedFetchPromise = new Promise((resolve) => {
        resolveFetch = resolve;
      });

      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/api/admin/zoho/users')) {
          return {
            ok: true,
            json: async () => {
              await delayedFetchPromise;
              return { users: mockUsers };
            },
          };
        }
        return { ok: true, json: async () => ({}) };
      });

      render(<ZohoEvaluationManager />);

      // While initial fetch is delayed, loader appears
      expect(screen.getByText('Loading user list...')).toBeDefined();

      // Resolve fetch
      resolveFetch!({ users: mockUsers });

      await waitFor(() => {
        expect(screen.getByText('jayesh.patel@creolestudios.com')).toBeDefined();
      });

      // Enter user view
      fireEvent.click(screen.getByText('jayesh.patel@creolestudios.com'));

      await waitFor(() => {
        expect(screen.getByLabelText('Back to All Users')).toBeDefined();
      });

      // Next filtering call will be delayed
      let resolveSecondFetch: (val: any) => void;
      const secondFetchPromise = new Promise((resolve) => {
        resolveSecondFetch = resolve;
      });

      (global.fetch as any).mockImplementation(async (url: string) => {
        if (url.includes('/api/admin/zoho/users')) {
          return {
            ok: true,
            json: async () => {
              await secondFetchPromise;
              return { users: mockUsers };
            },
          };
        }
        return { ok: true, json: async () => ({}) };
      });

      // Trigger prev week step on date filter
      const prevStepBtn = screen.getByLabelText('Previous Period');
      fireEvent.click(prevStepBtn);

      // Verify loader indicator is shown on screen while waiting
      await waitFor(() => {
        expect(screen.getByText('Loading Tasks & Evaluations...')).toBeDefined();
      });

      // Resolve second fetch
      resolveSecondFetch!({ users: mockUsers });

      // Verify task list returns after load finishes
      await waitFor(() => {
        expect(screen.queryByText('Loading Tasks & Evaluations...')).toBeNull();
      });
    });

    it('restores selected user view from URL query parameter on initial load or refresh', async () => {
      window.history.replaceState(null, '', '/admin/dashboard?tab=zoho&user=jayesh.patel%40creolestudios.com');

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

      // Should automatically mount in User Detail view for Jayesh Patel
      await waitFor(() => {
        expect(screen.getByLabelText('Back to All Users')).toBeDefined();
        expect(screen.getByText('(jayesh.patel@creolestudios.com)')).toBeDefined();
      });

      // Clicking Back to All Users should clear the user query parameter
      fireEvent.click(screen.getByLabelText('Back to All Users'));

      await waitFor(() => {
        expect(screen.getByText('Zoho Users')).toBeDefined();
      });
      expect(window.location.search).not.toContain('user=');

      // Cleanup URL
      window.history.replaceState(null, '', '/');
    });
  });

  describe('formatZohoDurationToClock', () => {
    it('formats numbers and strings into standard clock H:MM format', () => {
      expect(formatZohoDurationToClock(4)).toBe('4:00');
      expect(formatZohoDurationToClock('4:00')).toBe('4:00');
      expect(formatZohoDurationToClock(8.25)).toBe('8:15');
      expect(formatZohoDurationToClock('8.25')).toBe('8:15');
      expect(formatZohoDurationToClock('08:15')).toBe('8:15');
      expect(formatZohoDurationToClock('8:15')).toBe('8:15');
      expect(formatZohoDurationToClock(3.55)).toBe('3:55');
      expect(formatZohoDurationToClock('3:55')).toBe('3:55');
      expect(formatZohoDurationToClock(3.18)).toBe('3:18');
      expect(formatZohoDurationToClock(0)).toBe('0:00');
      expect(formatZohoDurationToClock('0')).toBe('0:00');
      expect(formatMinutesToClock(235)).toBe('3:55');
      expect(formatMinutesToClock(240)).toBe('4:00');
      expect(formatMinutesToClock(93)).toBe('1:33');
      expect(formatZohoDurationToClock(1.55)).toBe('1:33');
      expect(formatZohoDurationToClock('1.55')).toBe('1:33');
    });
  });

  describe('ZohoDailyEvaluationModal', () => {
    const mockDay = {
      date: '2026-10-30',
      dayScore: 8.8,
      summary: 'Completed 2 task(s) on 2026-10-30 with high adherence.',
      tasks: [
        {
          id: 't-1',
          zohoTaskId: 'z-1',
          projectId: 'p-1',
          projectName: 'CS Website',
          taskName: 'Clean Up Database and Review Geolocation Storage',
          taskDescription: 'Detailed database cleanup',
          zohoStatus: 'In QA Review',
          isQAReview: true,
          plannedHours: 4.0,
          actualHours: 3.97,
          taskDate: '2026-10-30',
          zohoLink: 'https://projects.zoho.com/...',
          comments: [{ author: 'Krunal', content: 'Reviewed database and executed cleanup', time: '1:00 PM' }],
          evaluation: {
            overallScore: 9.9,
            timeScore: 10.0,
            commentQualityScore: 9.9,
            complexityScore: 8.5,
            repetitionScore: 10.0,
            timeVarianceMinutes: -2,
            timeAssessmentLabel: 'ON_TIME',
            isRepetitive: false,
            repetitionSimilarityPct: 0,
            matchedTaskId: null,
            summaryFeedback: 'Excellent implementation and progress updates.',
            strengths: ['Clean database migration'],
            improvements: [],
            aiModelUsed: 'gemini-2.5-flash',
          },
        },
        {
          id: 't-2',
          zohoTaskId: 'z-2',
          projectId: 'p-1',
          projectName: 'CS Website',
          taskName: 'Continue upgrade WordPress Core and Plugins on CS and KSA',
          taskDescription: 'Upgraded WordPress plugins',
          zohoStatus: 'In QA Review',
          isQAReview: true,
          plannedHours: 4.0,
          actualHours: 3.55,
          taskDate: '2026-10-30',
          zohoLink: 'https://projects.zoho.com/...',
          comments: [{ author: 'Krunal', content: 'Updated core version and plugin versions', time: '2:00 PM' }],
          evaluation: {
            overallScore: 8.0,
            timeScore: 10.0,
            commentQualityScore: 6.2,
            complexityScore: 8.0,
            repetitionScore: 10.0,
            timeVarianceMinutes: -5,
            timeAssessmentLabel: 'ON_TIME',
            isRepetitive: false,
            repetitionSimilarityPct: 0,
            matchedTaskId: null,
            summaryFeedback: 'Solid execution within time buffer.',
            strengths: ['Disciplined time buffer'],
            improvements: ['Provide more technical depth'],
            aiModelUsed: 'gemini-2.5-flash',
          },
        },
      ],
    };

    it('renders daily evaluation header, aggregate clock hours, and day score', () => {
      const onClose = vi.fn();
      render(
        <ZohoDailyEvaluationModal
          day={mockDay}
          userName="Krunal Bhimajiyani"
          userRole="Senior Developer"
          onClose={onClose}
        />
      );

      expect(screen.getByText('Daily Performance & Activity Evaluation')).toBeDefined();
      expect(screen.getByText('2026-10-30')).toBeDefined();
      expect(screen.getByText('2 Tasks Evaluated')).toBeDefined();
      expect(screen.getAllByText('Within Buffer').length).toBeGreaterThan(0);
      expect(screen.getByText('8:00 hrs')).toBeDefined(); // Planned time
      expect(screen.getByText('Time Spent')).toBeDefined();
      expect(screen.getByText('Score')).toBeDefined();
      expect(screen.queryByText('Tolerance Status')).toBeNull();
      expect(screen.queryByText('Work Status')).toBeNull();
      expect(screen.getByText('Daily Performance Evaluation & Actionable Insights')).toBeDefined();
      expect(screen.getByText('Key Accomplishments for the Day:')).toBeDefined();
      expect(screen.getByText('Key Areas to Improve & Work On:')).toBeDefined();
      expect(screen.getByText('Close Daily Evaluation')).toBeDefined();

      fireEvent.click(screen.getByText('Close Daily Evaluation'));
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('buildWeeklyPerformanceReports', () => {
    it('generates weekly reports starting with this week, completion progress bar, and 3 paragraphs', () => {
      const mockUser = getMockZohoData()[0];
      const reports = buildWeeklyPerformanceReports(mockUser);
      expect(reports.length).toBeGreaterThan(0);
      expect(reports[0].isCurrentWeek).toBe(true);
      expect(reports[0].overallScore).toBeGreaterThanOrEqual(50);
      expect(reports[0].overallScore).toBeLessThanOrEqual(100);
      expect(reports[0].summaryParagraphs.length).toBe(3);
      expect(reports[0].doneTasks).toBeDefined();
      expect(reports[0].repetitivenessPct).toBeDefined();
    });
  });

  describe('ZohoWeeklyEvaluationModal', () => {
    it('renders cumulative 5 cards, task progress bar, % repetitive, and 3-paragraph executive summary with appended past weeks', () => {
      const mockUser = getMockZohoData()[0];
      const onClose = vi.fn();
      render(
        <ZohoWeeklyEvaluationModal
          user={mockUser}
          onClose={onClose}
        />
      );

      expect(screen.getByText('Weekly Performance & Evaluation Report (Cumulative)')).toBeDefined();
      expect(screen.getAllByText('Done Tasks').length).toBeGreaterThan(0);
      expect(screen.getAllByText('In Progress').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Delayed Tasks').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Logged Hours').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Overall Score').length).toBeGreaterThan(0);
      expect(screen.getByText(/Task Progress:/i)).toBeDefined();
      expect(screen.getAllByText(/Repetitive/i).length).toBeGreaterThan(0);
      expect(screen.queryByText(/Dossier/i)).toBeNull();
      // Ensure visual multi-segment progress bar div is removed (only verbal info remains)
      expect(document.querySelector('.w-full.h-2.rounded-full')).toBeNull();
      expect(screen.getByText('CURRENT WEEK')).toBeDefined();
      expect(screen.getByText(/Executive Performance Summary/i)).toBeDefined();
      expect(screen.getByText('Close Weekly Report')).toBeDefined();

      fireEvent.click(screen.getByText('Close Weekly Report'));
      expect(onClose).toHaveBeenCalled();
    });

    it('accurately displays 1 in progress task and 1 week on record when user has only 1 active task', () => {
      const singleTaskUser: ZohoUserSummary = {
        userId: 'u-single',
        email: 'srushti.amin@creolestudios.com',
        name: 'Srushti Amin',
        role: 'Junior developer',
        yearsOfExperience: 1,
        seniorityLevel: 'Junior',
        aiSubscriptions: ['Antigravity Pro'],
        tillDateSummary: {
          doneTasks: 0,
          pendingTasks: 1,
          delayedTasks: 0,
          weeklyAvgScore: 20,
          totalHoursLogged: 1.6,
        },
        dailyEvaluations: [
          {
            date: '2026-11-02',
            dayScore: 2.0,
            summary: 'Completed 1 task on 2026-11-02.',
            tasks: [
              {
                id: 't1',
                zohoTaskId: 'zt1',
                projectId: 'p1',
                projectName: 'CKP Portal',
                taskName: 'UI, Routing & Zoho Optimization',
                taskDescription: 'Bug fixes',
                zohoStatus: 'In Progress',
                isQAReview: false,
                plannedHours: 4,
                actualHours: 1.6,
                taskDate: '2026-11-02',
                zohoLink: '',
                comments: [],
              },
            ],
          },
        ],
      };

      render(
        <ZohoWeeklyEvaluationModal
          user={singleTaskUser}
          onClose={vi.fn()}
        />
      );

      expect(screen.getByText('1 Week on Record')).toBeDefined();
      expect(screen.getByText('Cumulative Performance Scorecard (Add-On Totals)')).toBeDefined();
      const inProgressCard = screen.getAllByText('In Progress')[0].parentElement?.parentElement;
      expect(inProgressCard?.textContent).toContain('1');
      const doneCard = screen.getAllByText('Done Tasks')[0].parentElement?.parentElement;
      expect(doneCard?.textContent).toContain('0');
      const hoursCard = screen.getAllByText('Logged Hours')[0].parentElement?.parentElement;
      expect(hoursCard?.textContent).toContain('1.6h');
    });

    it('renders distinct In QA Review card separate from Done Tasks when user has QA review tasks', () => {
      const qaUser: ZohoUserSummary = {
        userId: 'u-qa',
        email: 'qa.dev@creolestudios.com',
        name: 'QA Dev',
        role: 'Full Stack Developer',
        yearsOfExperience: 3,
        seniorityLevel: 'Mid',
        aiSubscriptions: ['GitHub Copilot'],
        tillDateSummary: {
          doneTasks: 1,
          qaReviewTasks: 3,
          pendingTasks: 1,
          delayedTasks: 0,
          weeklyAvgScore: 85,
          totalHoursLogged: 12.0,
        },
        dailyEvaluations: [
          {
            date: '2026-11-04',
            dayScore: 8.5,
            summary: 'Completed 4 tasks on 2026-11-04.',
            tasks: [
              {
                id: 't-closed',
                zohoTaskId: 'zt-closed',
                projectId: 'p1',
                projectName: 'CKP',
                taskName: 'Production Hotfix',
                taskDescription: 'Hotfix applied',
                zohoStatus: 'Closed',
                isQAReview: false,
                plannedHours: 2,
                actualHours: 2,
                taskDate: '2026-11-04',
                zohoLink: '',
                comments: [],
              },
              {
                id: 't-qa-1',
                zohoTaskId: 'zt-qa1',
                projectId: 'p1',
                projectName: 'CKP',
                taskName: 'Search Filter Implementation',
                taskDescription: 'Search filter',
                zohoStatus: 'In QA Review',
                isQAReview: true,
                plannedHours: 3,
                actualHours: 3,
                taskDate: '2026-11-04',
                zohoLink: '',
                comments: [],
              },
            ],
          },
        ],
      };

      render(
        <ZohoWeeklyEvaluationModal
          user={qaUser}
          onClose={vi.fn()}
        />
      );

      // Verify In QA Review card renders with count 3
      const qaCard = screen.getAllByText('In QA Review')[0].parentElement?.parentElement;
      expect(qaCard?.textContent).toContain('3');

      // Verify Done Tasks card renders with count 1
      const doneCard = screen.getAllByText('Done Tasks')[0].parentElement?.parentElement;
      expect(doneCard?.textContent).toContain('1');

      // Verify task progress shows both Done and In QA Review
      expect(screen.getByText(/3 In QA Review/i)).toBeDefined();
    });

    it('shows all tasks by default in breakdown table and pops up a card with category tasks when clicking metric cards', () => {
      const multiStatusUser: ZohoUserSummary = {
        userId: 'u-filter',
        email: 'filter.user@creolestudios.com',
        name: 'Filter User',
        role: 'Full Stack Developer',
        yearsOfExperience: 3,
        seniorityLevel: 'Mid',
        aiSubscriptions: [],
        tillDateSummary: {
          doneTasks: 1,
          qaReviewTasks: 1,
          pendingTasks: 1,
          delayedTasks: 1,
          weeklyAvgScore: 80,
          totalHoursLogged: 10,
        },
        dailyEvaluations: [
          {
            date: '2026-11-04',
            dayScore: 8.0,
            summary: '3 tasks',
            tasks: [
              {
                id: 't-closed',
                zohoTaskId: 'zt-1',
                projectId: 'p1',
                projectName: 'CKP',
                taskName: 'Closed Feature',
                taskDescription: 'Done',
                zohoStatus: 'Closed',
                isQAReview: false,
                plannedHours: 2,
                actualHours: 2,
                taskDate: '2026-11-04',
                zohoLink: '',
                comments: [],
              },
              {
                id: 't-qa',
                zohoTaskId: 'zt-2',
                projectId: 'p1',
                projectName: 'CKP',
                taskName: 'QA Ticket',
                taskDescription: 'QA review',
                zohoStatus: 'In QA Review',
                isQAReview: true,
                plannedHours: 3,
                actualHours: 3,
                taskDate: '2026-11-04',
                zohoLink: '',
                comments: [],
              },
              {
                id: 't-delayed',
                zohoTaskId: 'zt-3',
                projectId: 'p1',
                projectName: 'CKP',
                taskName: 'Overdue Bugfix',
                taskDescription: 'Delayed bugfix',
                zohoStatus: 'In Progress',
                isQAReview: false,
                plannedHours: 2,
                actualHours: 5,
                taskDate: '2026-11-04',
                zohoLink: '',
                comments: [],
                evaluation: {
                  overallScore: 4.0,
                  timeScore: 2.0,
                  workMatchScore: 5.0,
                  commentQualityScore: 5.0,
                  complexityScore: 8.0,
                  repetitionScore: 10.0,
                  timeVarianceMinutes: 180,
                  timeAssessmentLabel: 'OVERDUE',
                  isRepetitive: false,
                  repetitionSimilarityPct: 0,
                  matchedTaskId: null,
                  workMatchFeedback: 'Overdue',
                  summaryFeedback: 'Overdue',
                  whereLacked: 'Overdue',
                  whereToImprove: 'Overdue',
                  improvementItems: [],
                  strengths: [],
                  improvements: [],
                  aiModelUsed: 'rule',
                },
              },
            ],
          },
        ],
      };

      render(
        <ZohoWeeklyEvaluationModal
          user={multiStatusUser}
          onClose={vi.fn()}
        />
      );

      // Initially all 3 tasks are shown by default in the breakdown table
      expect(screen.getByText('Closed Feature')).toBeDefined();
      expect(screen.getByText('QA Ticket')).toBeDefined();
      expect(screen.getByText('Overdue Bugfix')).toBeDefined();

      // Click on "In QA Review" card -> opens popup card
      const qaCard = screen.getAllByText('In QA Review')[0];
      fireEvent.click(qaCard);

      // Popup card opens with title and shows QA Ticket
      expect(screen.getByText('In QA Review Tasks')).toBeDefined();
      const popupDialog = screen.getByTestId('category-task-popup');
      expect(popupDialog).toBeDefined();

      // Close the popup card
      const closePopupBtn = screen.getByTestId('close-popup-card-btn');
      fireEvent.click(closePopupBtn);
      expect(screen.queryByTestId('category-task-popup')).toBeNull();

      // Click on "Delayed Tasks" card -> opens popup card with delayed tasks
      const delayedCard = screen.getAllByText('Delayed Tasks')[0];
      fireEvent.click(delayedCard);

      expect(screen.getAllByText('Delayed Tasks').length).toBeGreaterThanOrEqual(2);
      expect(screen.getByTestId('category-task-popup')).toBeDefined();

      // Default breakdown table still displays all tasks in background while popup is open
      expect(screen.getByText('Closed Feature')).toBeDefined();
      expect(screen.getByText('QA Ticket')).toBeDefined();
      expect(screen.getAllByText('Overdue Bugfix').length).toBe(2);
    });
  });
});
