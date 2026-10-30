import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
const mockListUsers = vi.fn();
const mockRequireAdminUser = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => mockFrom(...args),
    auth: {
      admin: {
        listUsers: () => mockListUsers(),
      },
    },
  },
  requireAdminUser: () => mockRequireAdminUser(),
}));

vi.mock('@/lib/zoho/sync', () => ({
  getLiveZohoSummariesWithFilter: vi.fn().mockResolvedValue({
    users: [],
    isLive: false,
    lastSyncedAt: new Date().toISOString(),
  }),
}));

import { GET } from '@/app/api/admin/zoho/users/route';

describe('GET /api/admin/zoho/users Route Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('successfully returns 200 with evaluated users and does not throw ReferenceError', async () => {
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-123' });

    mockListUsers.mockResolvedValue({
      data: {
        users: [
          {
            id: 'user-1',
            email: 'dev@creolestudios.com',
            last_sign_in_at: '2026-10-29T10:00:00Z',
            user_metadata: {
              full_name: 'Test Dev',
            },
          },
        ],
      },
      error: null,
    });

    const mockProfileSelect = vi.fn().mockResolvedValue({
      data: [
        {
          user_id: 'user-1',
          email: 'dev@creolestudios.com',
          role: 'developer',
          years_of_experience: 3,
        },
      ],
      error: null,
    });

    const mockTasksOrder = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'task-1',
          zoho_task_id: 'zt-1',
          zoho_project_id: 'zp-1',
          project_name: 'Knowledge Portal',
          task_name: 'Fix Zoho Users Endpoint',
          task_description: 'Fix ReferenceError hasComments is not defined in Zoho users API',
          zoho_status: 'Completed',
          is_qa_review: false,
          planned_hours: 4,
          actual_hours: 4,
          task_date: '2026-10-30',
          zoho_link: 'https://projects.zoho.com',
          user_id: 'user-1',
          user_email: 'dev@creolestudios.com',
          zoho_task_comments: [
            {
              comment_content: 'Investigated bug, defined hasComments variable and verified all unit tests passing.',
              author_name: 'Test Dev',
            },
          ],
          zoho_task_evaluations: [],
        },
      ],
      error: null,
    });

    const mockTaskSelect = vi.fn().mockReturnValue({
      order: mockTasksOrder,
    });

    mockFrom.mockImplementation((tableName: string) => {
      if (tableName === 'user_profiles') {
        return { select: mockProfileSelect };
      }
      if (tableName === 'zoho_tasks') {
        return { select: mockTaskSelect };
      }
      return { select: vi.fn().mockResolvedValue({ data: [], error: null }) };
    });

    const request = new Request('http://localhost:3000/api/admin/zoho/users?type=week&startDate=2026-10-26&endDate=2026-11-01');
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.users).toBeDefined();
    expect(body.users.length).toBe(1);
    expect(body.users[0].email).toBe('dev@creolestudios.com');

    // Confirm tasks were evaluated and workMatchFeedback was correctly generated
    const task = body.users[0].dailyEvaluations[0].tasks[0];
    expect(task.evaluation.workMatchFeedback).toBeDefined();
    expect(task.evaluation.overallScore).toBeGreaterThan(0);
  });
});

