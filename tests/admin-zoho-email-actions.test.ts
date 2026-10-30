import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequireAdminUser = vi.fn();
const mockListUsers = vi.fn();
const mockGetUserById = vi.fn();
const mockUpdateUserById = vi.fn();
const mockFromUpdate = vi.fn();
const mockFromSelect = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  requireAdminUser: (...args: any[]) => mockRequireAdminUser(...args),
  supabaseAdmin: {
    auth: {
      admin: {
        listUsers: (...args: any[]) => mockListUsers(...args),
        getUserById: (...args: any[]) => mockGetUserById(...args),
        updateUserById: (...args: any[]) => mockUpdateUserById(...args),
      },
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'user_profiles') {
        return {
          update: vi.fn().mockReturnValue({
            eq: (...args: any[]) => mockFromUpdate(...args),
          }),
          select: vi.fn().mockReturnValue(mockFromSelect()),
        };
      }
      return {
        select: vi.fn().mockReturnValue({ data: [] }),
      };
    }),
  },
}));

const mockGetZohoAccessToken = vi.fn();
const mockFetchZohoPortalUsers = vi.fn();
const mockFetchZohoUserTasks = vi.fn();
const mockFetchZohoTaskDetails = vi.fn();
const mockFetchZohoTaskComments = vi.fn();

vi.mock('@/lib/zoho/client', () => ({
  getZohoAccessToken: (...args: any[]) => mockGetZohoAccessToken(...args),
  fetchZohoPortalUsers: (...args: any[]) => mockFetchZohoPortalUsers(...args),
  fetchZohoUserTasks: (...args: any[]) => mockFetchZohoUserTasks(...args),
  fetchZohoTaskDetails: (...args: any[]) => mockFetchZohoTaskDetails(...args),
  fetchZohoTaskComments: (...args: any[]) => mockFetchZohoTaskComments(...args),
  stripHtml: (str: string) => str ? str.replace(/<[^>]*>/g, '') : '',
  parseDurationToMinutes: (d: string) => {
    if (!d) return 0;
    const parts = d.split(':');
    return parseInt(parts[0] || '0', 10) * 60 + parseInt(parts[1] || '0', 10);
  },
}));

const mockSendDailyEvaluationEmail = vi.fn();

vi.mock('@/lib/email/service', () => ({
  sendDailyEvaluationEmail: (...args: any[]) => mockSendDailyEvaluationEmail(...args),
}));

import { PATCH as dailyEmailPatch } from '../app/api/admin/zoho/users/daily-email/route';
import { POST as sendEvaluationEmailPost } from '../app/api/admin/zoho/send-evaluation-email/route';

describe('PATCH /api/admin/zoho/users/daily-email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-id' });
    mockGetUserById.mockResolvedValue({
      data: { user: { user_metadata: { role: 'developer' } } },
      error: null,
    });
    mockUpdateUserById.mockResolvedValue({ data: {}, error: null });
    mockFromUpdate.mockResolvedValue({ data: {}, error: null });
  });

  it('rejects unauthorized requests in production', async () => {
    const originalEnv = process.env.NODE_ENV;
    vi.stubEnv('NODE_ENV', 'production');
    mockRequireAdminUser.mockResolvedValue(null);

    const req = new Request('http://localhost/api/admin/zoho/users/daily-email', {
      method: 'PATCH',
      body: JSON.stringify({ userId: 'u123', enabled: true }),
    });

    const res = await dailyEmailPatch(req);
    expect(res.status).toBe(401);
    vi.unstubAllEnvs();
  });

  it('validates required fields userId and enabled', async () => {
    const req = new Request('http://localhost/api/admin/zoho/users/daily-email', {
      method: 'PATCH',
      body: JSON.stringify({ userId: 'u123' }), // missing enabled
    });

    const res = await dailyEmailPatch(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('userId (string) and enabled (boolean) are required');
  });

  it('successfully updates user_metadata and user_profiles', async () => {
    const req = new Request('http://localhost/api/admin/zoho/users/daily-email', {
      method: 'PATCH',
      body: JSON.stringify({ userId: 'user-xyz', enabled: false }),
    });

    const res = await dailyEmailPatch(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.dailyEmailEnabled).toBe(false);

    expect(mockUpdateUserById).toHaveBeenCalledWith('user-xyz', {
      user_metadata: {
        role: 'developer',
        daily_email_enabled: false,
      },
    });
  });
});

describe('POST /api/admin/zoho/send-evaluation-email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-id' });
    mockGetZohoAccessToken.mockResolvedValue('fake-zoho-token');
    mockFetchZohoPortalUsers.mockResolvedValue([
      { id: 'zoho-1', email: 'priya.dhanani@creolestudios.com', name: 'Priya Dhanani' },
    ]);
    mockListUsers.mockResolvedValue({
      data: {
        users: [
          {
            id: 'user-1',
            email: 'priya.dhanani@creolestudios.com',
            user_metadata: {
              full_name: 'Priya Dhanani',
              senior_emails: ['lead@creolestudios.com'],
            },
          },
        ],
      },
      error: null,
    });
    mockFromSelect.mockResolvedValue({
      data: [
        {
          user_id: 'user-1',
          email: 'priya.dhanani@creolestudios.com',
          name: 'Priya Dhanani',
          years_of_experience: 3,
          senior_emails: ['lead@creolestudios.com'],
        },
      ],
    });
    mockFetchZohoUserTasks.mockResolvedValue([
      {
        id: 'task-1',
        name: 'Implement Daily Evaluation Email',
        start_date: '2026-10-30',
        duration: '4:00',
        status: { name: 'Completed' },
        log_hours: { billable_hours: '4:00', non_billable_hours: '0:00' },
        project: { id_string: 'p1', name: 'Knowledge Portal' },
      },
    ]);
    mockFetchZohoTaskDetails.mockResolvedValue({
      description: 'Implemented email dispatching logic with test suites.',
    });
    mockFetchZohoTaskComments.mockResolvedValue([
      { content: 'Done writing unit tests and verifying email formatting.' },
    ]);
    mockSendDailyEvaluationEmail.mockResolvedValue({
      success: true,
      messageId: 'smtp_success_123',
    });
  });

  it('rejects empty userIds array', async () => {
    const req = new Request('http://localhost/api/admin/zoho/send-evaluation-email', {
      method: 'POST',
      body: JSON.stringify({ userIds: [] }),
    });

    const res = await sendEvaluationEmailPost(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('userIds (array of strings) is required');
  });

  it('evaluates and dispatches email to selected users and seniors', async () => {
    const req = new Request('http://localhost/api/admin/zoho/send-evaluation-email', {
      method: 'POST',
      body: JSON.stringify({
        userIds: ['user-1'],
        date: '2026-10-30',
      }),
    });

    const res = await sendEvaluationEmailPost(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.sentCount).toBe(1);
    expect(body.failedCount).toBe(0);
    expect(body.results[0].email).toBe('priya.dhanani@creolestudios.com');
    expect(body.results[0].seniorEmails).toEqual(['lead@creolestudios.com']);

    expect(mockSendDailyEvaluationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'priya.dhanani@creolestudios.com',
        cc: ['lead@creolestudios.com'],
        dryRun: false,
      })
    );
  });
});
