// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ZohoFilterBar from './zoho-filter-bar';
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
      expect(screen.getByText('4 hrs')).toBeDefined();
      expect(screen.getByText('Related Comments (1)')).toBeDefined();
      expect(screen.getByText('Completed test run and verified RLS')).toBeDefined();
      expect(screen.getByText('AI Evaluation Summary')).toBeDefined();
      expect(screen.getByText('5-minute buffer respected with 100% time adherence.')).toBeDefined();

      const closeBtn = screen.getByText('Close');
      fireEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalled();
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

    it('renders when isOpen is true and closes on Close button click', () => {
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
  });

  describe('ZohoEvaluationManager', () => {
    const mockUsers = getMockZohoData();

    it('lists all users initially and shows date-wise task titles upon clicking a user', async () => {
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

      // Verify Initial State: Lists all employees
      await waitFor(() => {
        expect(screen.getByText('Jayesh Patel')).toBeDefined();
      });
      expect(screen.getByText('Zoho Employee Task Evaluations')).toBeDefined();
      expect(screen.getByText('Srushti Amin')).toBeDefined();

      // Click on user "Jayesh Patel"
      const jayeshCard = screen.getByText('Jayesh Patel');
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

      // Click "Back to All Users" to return to list of all users
      const backBtn = screen.getByText('Back to All Users');
      fireEvent.click(backBtn);

      await waitFor(() => {
        expect(screen.getByText('Srushti Amin')).toBeDefined();
      });
      expect(screen.getByText('Zoho Employee Task Evaluations')).toBeDefined();
    });
  });
});
