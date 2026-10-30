import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
const mockListUsers = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => mockFrom(...args),
    auth: {
      admin: {
        listUsers: () => mockListUsers(),
      },
    },
  },
  requireAdminUser: vi.fn(),
}));

vi.mock('@/lib/zoho/client', () => ({
  getZohoAccessToken: vi.fn(),
  fetchZohoPortalUsers: vi.fn(),
  fetchZohoUserTasks: vi.fn(),
  fetchZohoTaskComments: vi.fn(),
  stripHtml: (s: string) => s.replace(/<[^>]*>?/gm, ''),
  buildZohoTaskDeepLink: vi.fn(() => 'https://projects.zoho.com/...'),
  parseDurationToMinutes: (s: string) => {
    if (!s || s === '0' || s === '0:00') return 0;
    if (s === '8:00') return 480;
    if (s === '4:00') return 240;
    return 0;
  },
}));

import { runDailyZohoEvaluationCron } from '@/lib/zoho/cron';
import * as zohoClient from '@/lib/zoho/client';
import { GET, POST } from '@/app/api/cron/zoho-evaluation/route';

describe('Daily Zoho Evaluation Cron Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails gracefully when Zoho access token cannot be acquired', async () => {
    vi.mocked(zohoClient.getZohoAccessToken).mockResolvedValue(null);

    const result = await runDailyZohoEvaluationCron({ targetDate: '2026-10-30' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unable to acquire Zoho access token');
    expect(result.usersEvaluated).toBe(0);
    expect(result.tasksEvaluated).toBe(0);
  });

  it('evaluates daily tasks and comments, strictly keeping 0 hrs when not logged', async () => {
    vi.mocked(zohoClient.getZohoAccessToken).mockResolvedValue('mock-access-token');
    vi.mocked(zohoClient.fetchZohoPortalUsers).mockResolvedValue([
      { id: 'zoho-u-1', email: 'dev@creolestudios.com', name: 'John Doe' },
    ]);

    mockListUsers.mockResolvedValue({
      data: {
        users: [
          {
            id: 'auth-u-1',
            email: 'dev@creolestudios.com',
            last_sign_in_at: '2026-10-29T10:00:00Z',
            user_metadata: { full_name: 'John Doe' },
          },
        ],
      },
    });

    // Mock user_profiles
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 'task-db-uuid-1' }, error: null }),
        data: [{ user_id: 'auth-u-1', email: 'dev@creolestudios.com', role: 'developer', years_of_experience: 3 }],
        error: null,
      }),
      upsert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'task-db-uuid-1' }, error: null }),
        }),
      }),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    // Mock Zoho Tasks: Task has duration 8 hours but log_hours is 0 / empty
    vi.mocked(zohoClient.fetchZohoUserTasks).mockResolvedValue([
      {
        id_string: 'z-t-101',
        name: 'Build Automated Cron Pipeline',
        description: 'Implement automated cron evaluation.',
        duration: '8:00',
        log_hours: { billable_hours: '0', non_billable_hours: '0' },
        status: { name: 'Closed' },
        start_date: '10-30-2026',
        project: { name: 'CKP System', id_string: 'p-1' },
      },
    ]);

    vi.mocked(zohoClient.fetchZohoTaskComments).mockResolvedValue([
      { id: 'comm-1', author_name: 'John Doe', content: 'Completed cron pipeline and unit tests.', added_time: '2026-10-30T17:00:00Z' },
    ]);

    const result = await runDailyZohoEvaluationCron({
      targetDate: '2026-10-30',
      dryRun: false,
    });

    expect(result.success).toBe(true);
    expect(result.usersEvaluated).toBe(1);
    expect(result.tasksEvaluated).toBe(1);
    expect(result.commentsIngested).toBe(1);
    expect(result.details[0].totalActualHours).toBe(0); // Strictly 0 hrs because no time logged!
    expect(result.details[0].totalPlannedHours).toBe(8); // 8 planned hrs
  });

  it('runs in dryRun mode without persisting records to database', async () => {
    vi.mocked(zohoClient.getZohoAccessToken).mockResolvedValue('mock-access-token');
    vi.mocked(zohoClient.fetchZohoPortalUsers).mockResolvedValue([
      { id: 'zoho-u-1', email: 'dev@creolestudios.com', name: 'John Doe' },
    ]);

    mockListUsers.mockResolvedValue({
      data: {
        users: [
          {
            id: 'auth-u-1',
            email: 'dev@creolestudios.com',
            last_sign_in_at: '2026-10-29T10:00:00Z',
          },
        ],
      },
    });

    mockFrom.mockReturnValue({
      select: vi.fn().mockResolvedValue({
        data: [{ user_id: 'auth-u-1', email: 'dev@creolestudios.com', role: 'developer' }],
      }),
      upsert: vi.fn(),
      insert: vi.fn(),
    });

    vi.mocked(zohoClient.fetchZohoUserTasks).mockResolvedValue([
      {
        id_string: 'z-t-102',
        name: 'Dry Run Task',
        description: 'Verify dry run.',
        duration: '4:00',
        start_date: '10-30-2026',
        project: { name: 'CKP', id_string: 'p-1' },
      },
    ]);

    vi.mocked(zohoClient.fetchZohoTaskComments).mockResolvedValue([]);

    const result = await runDailyZohoEvaluationCron({
      targetDate: '2026-10-30',
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.evaluationsCreated).toBe(0); // dryRun skips inserts
    expect(result.emailsSent).toBe(1); // Mocks email in dryRun
  });

  it('emails evaluation report to user and configured senior emails after analysis', async () => {
    vi.mocked(zohoClient.getZohoAccessToken).mockResolvedValue('mock-access-token');
    vi.mocked(zohoClient.fetchZohoPortalUsers).mockResolvedValue([
      { id: 'zoho-u-1', email: 'dev@creolestudios.com', name: 'John Doe' },
    ]);

    mockListUsers.mockResolvedValue({
      data: {
        users: [
          {
            id: 'auth-u-1',
            email: 'dev@creolestudios.com',
            last_sign_in_at: '2026-10-29T10:00:00Z',
            user_metadata: {
              full_name: 'John Doe',
              senior_emails: ['lead@creolestudios.com', 'pm@creolestudios.com'],
            },
          },
        ],
      },
    });

    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: 'task-db-uuid-1' }, error: null }),
        data: [{
          user_id: 'auth-u-1',
          email: 'dev@creolestudios.com',
          role: 'developer',
          senior_emails: ['lead@creolestudios.com', 'pm@creolestudios.com'],
        }],
        error: null,
      }),
      upsert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'task-db-uuid-1' }, error: null }),
        }),
      }),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    vi.mocked(zohoClient.fetchZohoUserTasks).mockResolvedValue([
      {
        id_string: 'z-t-105',
        name: 'Feature Implementation',
        description: 'Complete task',
        duration: '4:00',
        log_hours: { billable_hours: '4.0', non_billable_hours: '0' },
        status: { name: 'Closed' },
        start_date: '10-30-2026',
        project: { name: 'CKP System', id_string: 'p-1' },
      },
    ]);

    vi.mocked(zohoClient.fetchZohoTaskComments).mockResolvedValue([
      { id: 'comm-2', author_name: 'John Doe', content: 'Testing passed and ready for review', added_time: '2026-10-30T15:00:00Z' },
    ]);

    const result = await runDailyZohoEvaluationCron({
      targetDate: '2026-10-30',
      dryRun: false,
    });

    expect(result.success).toBe(true);
    expect(result.emailsSent).toBe(1);
    expect(result.details[0].seniorEmails).toEqual(['lead@creolestudios.com', 'pm@creolestudios.com']);
    expect(result.details[0].emailDelivered).toBe(true);
  });

  it('skips execution on weekends (Saturday / Sunday) when skipWeekend is enabled', async () => {
    // 2026-10-31 is Saturday, 2026-11-01 is Sunday
    const satResult = await runDailyZohoEvaluationCron({
      targetDate: '2026-10-31',
      skipWeekend: true,
    });

    expect(satResult.success).toBe(true);
    expect(satResult.skipped).toBe(true);
    expect(satResult.skipReason).toContain('Saturday');
    expect(satResult.emailsSent).toBe(0);

    const sunResult = await runDailyZohoEvaluationCron({
      targetDate: '2026-11-01',
      skipWeekend: true,
    });

    expect(sunResult.success).toBe(true);
    expect(sunResult.skipped).toBe(true);
    expect(sunResult.skipReason).toContain('Sunday');
    expect(sunResult.emailsSent).toBe(0);
  });
});

describe('/api/cron/zoho-evaluation Route Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthorized requests in production when secret is incorrect', async () => {
    const originalEnv = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = 'production';

    const req = new Request('https://portal.creolestudios.com/api/cron/zoho-evaluation', {
      headers: { authorization: 'Bearer wrong-secret' },
    });

    const res = await GET(req);
    expect(res.status).toBe(401);

    (process.env as Record<string, string>).NODE_ENV = originalEnv;
  });

  it('authorizes requests with matching Bearer CRON_SECRET and executes cron', async () => {
    vi.mocked(zohoClient.getZohoAccessToken).mockResolvedValue(null);

    const req = new Request('https://portal.creolestudios.com/api/cron/zoho-evaluation?dryRun=true', {
      method: 'POST',
      headers: { authorization: 'Bearer creole-cron-secret-123' },
    });

    const res = await POST(req);
    // Since mock token is null, it returns 500 with descriptive error
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toContain('Unable to acquire Zoho access token');
  });

  it('skips execution on weekend when requested via /api/cron/zoho-evaluation', async () => {
    // 2026-10-31 is Saturday
    const req = new Request('https://portal.creolestudios.com/api/cron/zoho-evaluation?date=2026-10-31', {
      method: 'GET',
      headers: { authorization: 'Bearer creole-cron-secret-123' },
    });

    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.skipped).toBe(true);
    expect(data.message).toContain('Saturday');
  });
});
