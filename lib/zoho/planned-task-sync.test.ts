import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';

vi.mock('../supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      then: (resolve: any) => resolve({ data: [], error: null }),
    })),
  },
}));

import {
  getISOWeekNumber,
  resolveUserSubtaskBucket,
  formatDateForZoho,
  isPlaceholderTaskName,
  findLatestActiveWeeklyTask,
  resolveAllocatedHoursFromTitle,
  parseAllUserBucketsFromTitle,
  syncQueuedPlannedTasks,
} from './planned-task-sync';
import * as client from './client';

describe('Planned Task Sync Engine (Option B: Single Table & 4-Tier Hierarchy)', () => {
  describe('Helper Functions', () => {
    it('calculates ISO week number correctly', () => {
      // 2026-11-16 is Monday of week 47
      const week = getISOWeekNumber('2026-11-16');
      expect(week).toBe(47);
    });

    it('formats date from YYYY-MM-DD to MM-DD-YYYY for Zoho API', () => {
      const formatted = formatDateForZoho('2026-11-17');
      expect(formatted).toBe('11-17-2026');
    });

    it('identifies placeholder container task names accurately', () => {
      expect(isPlaceholderTaskName('Placeholder Task - W47')).toBe(true);
      expect(isPlaceholderTaskName('Planned Tasks - W47')).toBe(true);
      expect(isPlaceholderTaskName('Planned Tasks Container - W47')).toBe(true);
      expect(isPlaceholderTaskName('Admin Tasks Container')).toBe(true);
      expect(isPlaceholderTaskName('Placeholder Task')).toBe(true);
      expect(isPlaceholderTaskName('Srushti: 14 hours')).toBe(false);
      expect(isPlaceholderTaskName('Zoho Automatic Task Creation [8.0 hrs]')).toBe(false);
    });

    it('resolves direct named user subtask bucket with colon or space format', () => {
      const subtasks = [
        { id: 'sub-1', id_string: 'sub-1', name: 'Srushti: 14 hours' },
        { id: 'sub-2', id_string: 'sub-2', name: 'krunal 10' },
        { id: 'sub-3', id_string: 'sub-3', name: 'others 20' },
      ];

      const bucket = resolveUserSubtaskBucket(subtasks, 'srushti');
      expect(bucket).toBeDefined();
      expect(bucket?.id).toBe('sub-1');
      expect(bucket?.isFallback).toBe(false);
    });

    it('falls back to others bucket when developer is not explicitly named', () => {
      const subtasks = [
        { id: 'sub-1', id_string: 'sub-1', name: 'priya 10' },
        { id: 'sub-2', id_string: 'sub-2', name: 'krunal 10' },
        { id: 'sub-3', id_string: 'sub-3', name: 'others 20' },
      ];

      // Aman is not in subtasks list
      const bucket = resolveUserSubtaskBucket(subtasks, 'aman');
      expect(bucket).toBeDefined();
      expect(bucket?.id).toBe('sub-3');
      expect(bucket?.name).toBe('others 20');
      expect(bucket?.isFallback).toBe(true);
    });

    it('picks latest 2026 weekly task over past years (2024/2025) and excludes closed tasks', () => {
      const projectTasks = [
        {
          id: 'old-2024-task',
          name: 'W47 - 2024 Sprint Development',
          created_time: '11-15-2024 10:00:00 AM',
          status: { name: 'Open' },
        },
        {
          id: 'closed-2026-task',
          name: 'W47 - Closed 2026 Sprint',
          created_time: '11-16-2026 09:00:00 AM',
          status: { name: 'Closed' },
        },
        {
          id: 'active-2026-task',
          name: 'W47 - Active 2026 Sprint Tasks',
          created_time: '11-16-2026 10:00:00 AM',
          status: { name: 'In Progress' },
        },
      ];

      const found = findLatestActiveWeeklyTask(projectTasks, 47);
      expect(found).toBeDefined();
      expect(found.id).toBe('active-2026-task');
    });

    it('gracefully falls back to latest active W46 when project sprint lags calendar week', () => {
      const projectTasks = [
        {
          id: 'w46-task',
          name: 'W46 - Zoho task analyzing automation - 50 hours',
          created_time: '11-10-2026 10:00:00 AM',
          status: { name: 'Backlog' },
        },
      ];

      // Target week is 47, but project only has active W46
      const found = findLatestActiveWeeklyTask(projectTasks, 47);
      expect(found).toBeDefined();
      expect(found.id).toBe('w46-task');
    });

    it('picks highest open week number (e.g. W47 over W46, W51 over closed W50)', () => {
      const projectTasks = [
        {
          id: 'w46-task',
          name: 'W46 - Older Sprint',
          status: { name: 'Closed' },
        },
        {
          id: 'w47-task',
          name: 'W47 - Active Sprint',
          status: { name: 'Open' },
        },
      ];
      const found = findLatestActiveWeeklyTask(projectTasks);
      expect(found).toBeDefined();
      expect(found.id).toBe('w47-task');
    });

    it('resolves allocated hours from parent title with explicit user breakdown (e.g. srushti 40, priya 16)', () => {
      const title = 'W46 - Zoho task analyzing automation - 50 hours (srushti 40, priya 16)';
      expect(resolveAllocatedHoursFromTitle(title, 'srushti')).toBe(40);
      expect(resolveAllocatedHoursFromTitle(title, 'priya')).toBe(16);
      // Other unlisted developer falls back to standard 40
      expect(resolveAllocatedHoursFromTitle(title, 'drashti')).toBe(40);
    });

    it('resolves allocated hours from parent title with single general duration or fallback', () => {
      expect(resolveAllocatedHoursFromTitle('W47 - Solar CRM - 32 hours', 'srushti')).toBe(32);
      expect(resolveAllocatedHoursFromTitle('W47 - Solar CRM', 'srushti')).toBe(40);
    });

    it('parses all user buckets and hours from parent title breakdown', () => {
      const parsed = parseAllUserBucketsFromTitle(
        'W47 - Sample tasks added by CKP by individual users - 20 hours (Srushti 14, Priya 6)'
      );
      expect(parsed).toEqual([
        { name: 'Srushti', hours: 14 },
        { name: 'Priya', hours: 6 },
      ]);
    });
  });

  describe('4-Tier Hierarchy Ingestion Workflow', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('creates Level 2 Placeholder (Admin, Backlog), Level 3 User Bucket (Unassigned), and Level 4 Work Task (User)', async () => {
      // Mock Supabase to return 1 queued task for Srushti
      const mockQueuedTasks = [
        {
          id: 'task-uuid-1',
          user_id: 'user-srushti-id',
          zoho_project_id: 'proj-123',
          project_name: 'Research & Training',
          task_name: 'Implement OAuth Flow',
          task_description: 'Detailed scope notes for OAuth implementation exceeding required length',
          planned_hours: 4.0,
          task_date: '2026-11-17',
          sync_status: 'queued',
        },
      ];

      const supabaseMock = await import('../supabase/admin');
      (supabaseMock.supabaseAdmin.from as any).mockImplementation((table: string) => {
        if (table === 'zoho_tasks') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            update: vi.fn().mockReturnThis(),
            then: (resolve: any) => resolve({ data: mockQueuedTasks, error: null }),
          };
        }
        if (table === 'zoho_user_mappings') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { zoho_user_id: 'zoho-srushti-99', zoho_user_email: 'srushti.amin@creolestudios.com' },
              error: null,
            }),
          };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          then: (resolve: any) => resolve({ data: [], error: null }),
        };
      });

      // Spy on client methods
      vi.spyOn(client, 'getZohoAccessToken').mockResolvedValue('mock-token');

      // Mock Level 1 Task returned from Zoho
      vi.spyOn(client, 'fetchZohoProjectTasks').mockResolvedValue([
        {
          id: 'main-task-1',
          id_string: 'main-task-1',
          name: 'W47 - Weekly Sprint Tasks - 56 hours (srushti 40, priya 16)',
          details: { owners: [{ id: 'admin-senil-100', name: 'Senil Shah' }] },
        },
      ]);

      // Initially no Level 2 or Level 3 subtasks
      vi.spyOn(client, 'fetchZohoTaskSubtasks').mockResolvedValue([]);

      const createdTasks: client.CreateZohoTaskPayload[] = [];
      vi.spyOn(client, 'createZohoTask').mockImplementation(async (_token, _portal, _proj, payload) => {
        createdTasks.push(payload);
        return {
          success: true,
          taskId: `created-task-${createdTasks.length}`,
          link: `https://projects.zoho.in/task/${createdTasks.length}`,
        };
      });

      const syncResult = await syncQueuedPlannedTasks('2026-11-17', { dryRun: false });

      expect(syncResult.totalQueued).toBe(1);
      expect(syncResult.syncedCount).toBe(1);

      // Verify created task tiers:
      // 1. Level 2: Placeholder task under Level 1 Main Task, assigned to Admin
      // 2. Level 2: User subtasks created for EVERY user mentioned in title (Srushti 40, Priya 16) directly under Main Task
      // 3. Level 3: Work task created directly under Srushti's subtask bucket
      expect(createdTasks.length).toBe(4);

      const placeholderTask = createdTasks[0];
      expect(placeholderTask.name).toContain('Placeholder Task - W47');
      expect(placeholderTask.parent_id).toBe('main-task-1');
      expect(placeholderTask.person_responsible).toBeUndefined(); // Strictly UNASSIGNED!

      // Srushti bucket created directly under Main Task (alongside Placeholder)
      const srushtiSubtask = createdTasks[1];
      expect(srushtiSubtask.name).toBe('Srushti 40');
      expect(srushtiSubtask.parent_id).toBe('main-task-1'); // Direct subtask of Level 1 parent!
      expect(srushtiSubtask.person_responsible).toBeUndefined(); // Strictly UNASSIGNED!

      // Priya bucket created directly under Main Task (alongside Placeholder)
      const priyaSubtask = createdTasks[2];
      expect(priyaSubtask.name).toBe('Priya 16');
      expect(priyaSubtask.parent_id).toBe('main-task-1'); // Direct subtask of Level 1 parent!
      expect(priyaSubtask.person_responsible).toBeUndefined(); // Strictly UNASSIGNED!

      // Work Task under Srushti Subtask, assigned to Developer
      const workTask = createdTasks[3];
      expect(workTask.name).toBe('Implement OAuth Flow [4.0 hrs]');
      expect(workTask.parent_id).toBe('created-task-2'); // Nested under Srushti Subtask!
      expect(workTask.person_responsible).toBe('zoho-srushti-99'); // Assigned to Developer!
      expect(workTask.duration).toBe('4'); // Decimal/number format for Zoho API
      expect(workTask.duration_type).toBe('hours'); // Displayed as hours
      expect(workTask.work).toBe('4'); // Work Hours (P) displays exact hours
      expect(workTask.work_type).toBe('work_hours');
      expect(workTask.owner_work).toBe(JSON.stringify([{ user_id: 'zoho-srushti-99', working_hours: '4' }]));
      expect(workTask.start_date).toBeUndefined(); // Start Date intentionally omitted ("-")
      expect(workTask.end_date).toBeUndefined(); // End Date intentionally omitted ("-")
    });
  });

  describe('syncQueuedPlannedTasks - Empty or dryRun', () => {
    beforeEach(async () => {
      vi.clearAllMocks();
      const supabaseMock = await import('../supabase/admin');
      (supabaseMock.supabaseAdmin.from as any).mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
        then: (resolve: any) => resolve({ data: [], error: null }),
      }));
    });

    it('returns empty result when no queued tasks exist in zoho_tasks', async () => {
      const result = await syncQueuedPlannedTasks('2026-11-17', { dryRun: true });
      expect(result.totalQueued).toBe(0);
      expect(result.syncedCount).toBe(0);
    });
  });
});
