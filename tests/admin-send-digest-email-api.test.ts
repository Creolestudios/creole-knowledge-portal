import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequireAdminUser = vi.fn();
const mockListUsers = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  requireAdminUser: (...args: any[]) => mockRequireAdminUser(...args),
  supabaseAdmin: {
    auth: {
      admin: {
        listUsers: (...args: any[]) => mockListUsers(...args),
      },
    },
    from: (...args: any[]) => mockFrom(...args),
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
  stripHtml: (str: string) => (str ? str.replace(/<[^>]*>/g, '') : ''),
  parseDurationToMinutes: (d: string) => {
    if (!d) return 0;
    const parts = d.split(':');
    return parseInt(parts[0] || '0', 10) * 60 + parseInt(parts[1] || '0', 10);
  },
  extractPlannedMinutesFromTask: (_dur: any, _work: any, _name: any) => 240,
}));

const mockSendDailyDigestEmail = vi.fn();

vi.mock('@/lib/email/service', () => ({
  sendDailyDigestEmail: (...args: any[]) => mockSendDailyDigestEmail(...args),
}));

import { POST as sendDigestPost } from '@/app/api/admin/zoho/send-digest-email/route';

describe('POST /api/admin/zoho/send-digest-email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminUser.mockResolvedValue({ userId: 'admin-id-1' });
    mockGetZohoAccessToken.mockResolvedValue('mock-zoho-token');
    mockListUsers.mockResolvedValue({ data: { users: [] }, error: null });
  });

  it('fails with 401 when user is not admin in production', async () => {
    mockRequireAdminUser.mockResolvedValue(null);
    vi.stubEnv('NODE_ENV', 'production');

    const req = new Request('http://localhost/api/admin/zoho/send-digest-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const res = await sendDigestPost(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe('Unauthorized');

    vi.unstubAllEnvs();
  });

  it('returns 400 when no active digest recipients are found or configured', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'admin_digest_recipients') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      if (table === 'user_profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      };
    });

    const req = new Request('http://localhost/api/admin/zoho/send-digest-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const res = await sendDigestPost(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('No digest recipients configured');
  });

  it('evaluates active team members and dispatches consolidated digest email', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'admin_digest_recipients') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [{ email: 'director@creolestudios.com' }],
              error: null,
            }),
          }),
        };
      }
      if (table === 'user_profiles') {
        return {
          select: vi.fn().mockResolvedValue({
            data: [
              {
                user_id: 'auth-user-1',
                email: 'dev@creolestudios.com',
                role: 'developer',
                years_of_experience: 4,
              },
            ],
            error: null,
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      };
    });

    mockListUsers.mockResolvedValue({
      data: {
        users: [
          {
            id: 'auth-user-1',
            email: 'dev@creolestudios.com',
            last_sign_in_at: '2026-11-01T08:00:00Z',
            user_metadata: { full_name: 'Developer One' },
          },
        ],
      },
    });

    mockFetchZohoPortalUsers.mockResolvedValue([
      { id: 'zoho-u-1', email: 'dev@creolestudios.com', name: 'Developer One' },
    ]);

    mockFetchZohoUserTasks.mockResolvedValue([
      {
        id_string: 'zt-1',
        name: 'Build Digest Feature',
        start_date: '11-02-2026',
        duration: '8:00',
        log_hours: { billable_hours: '7:30', non_billable_hours: '0:00' },
        status: { name: 'Closed' },
      },
    ]);

    mockFetchZohoTaskDetails.mockResolvedValue({
      description: 'Implement full digest table email dispatch.',
    });
    mockFetchZohoTaskComments.mockResolvedValue([
      { content: 'Completed tasks and verified automated report.' },
    ]);

    mockSendDailyDigestEmail.mockResolvedValue({
      success: true,
      recipientCount: 1,
      messageId: 'digest-msg-uuid-999',
    });

    const req = new Request('http://localhost/api/admin/zoho/send-digest-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2026-11-02' }),
    });

    const res = await sendDigestPost(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.usersEvaluated).toBe(1);
    expect(body.recipientCount).toBe(1);
    expect(body.messageId).toBe('digest-msg-uuid-999');
    expect(mockSendDailyDigestEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['director@creolestudios.com'],
        payload: expect.objectContaining({
          date: '2026-11-02',
          totalTasks: 1,
          totalDoneTasks: 1,
        }),
      })
    );
  });
});
