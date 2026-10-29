import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';

const mockListUsers = vi.fn();
let mockProfiles: any[] = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    auth: {
      admin: {
        listUsers: (...args: any[]) => mockListUsers(...args),
      },
    },
    from: vi.fn((table: string) => {
      if (table === 'user_profiles') {
        return {
          select: vi.fn(() => Promise.resolve({ data: mockProfiles, error: null })),
        };
      }
      return {
        select: vi.fn(() => ({
          order: vi.fn(() => Promise.resolve({ data: [], error: null })),
          gte: vi.fn(() => ({
            lte: vi.fn(() => Promise.resolve({ data: [], error: null })),
          })),
        })),
      };
    }),
  },
  requireAdminUser: vi.fn(() => Promise.resolve({ userId: 'admin-123' })),
}));

describe('Admin Zoho Users API (/api/admin/zoho/users)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProfiles = [];
    mockListUsers.mockResolvedValue({ data: { users: [] }, error: null });
  });

  it('returns users list and resolved filter range for default week filter', async () => {
    const req = new Request('http://localhost:3000/api/admin/zoho/users?type=week');
    const response = await GET(req);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.users).toBeDefined();
    expect(json.users.length).toBeGreaterThan(0);
    expect(json.filter.type).toBe('week');
    expect(json.filter.range.start).toBeDefined();
    expect(json.filter.range.end).toBeDefined();

    const firstUser = json.users[0];
    expect(firstUser.tillDateSummary).toBeDefined();
    expect(firstUser.tillDateSummary.doneTasks).toBeDefined();
    expect(firstUser.tillDateSummary.delayedTasks).toBeDefined();
    expect(firstUser.dailyEvaluations).toBeDefined();
    expect(firstUser.dailyEvaluations[0].tasks[0].zohoLink).toContain('projects.zoho.com');
  });

  it('filters users by search query', async () => {
    const req = new Request('http://localhost:3000/api/admin/zoho/users?search=jayesh');
    const response = await GET(req);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.users.length).toBe(1);
    expect(json.users[0].name).toContain('Jayesh');
  });

  it('lists only users who have logged in (last_sign_in_at != null)', async () => {
    mockListUsers.mockResolvedValue({
      data: {
        users: [
          {
            id: 'u-login-1',
            email: 'arjun.latiwala@creolestudios.com',
            last_sign_in_at: '2026-09-01T07:24:47.077502Z',
            user_metadata: { full_name: 'Arjun Latiwala' },
          },
          {
            id: 'u-never-logged-in',
            email: 'ghost@creolestudios.com',
            last_sign_in_at: null,
            user_metadata: {},
          },
        ],
      },
      error: null,
    });

    const req = new Request('http://localhost:3000/api/admin/zoho/users?type=week');
    const response = await GET(req);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.users).toHaveLength(1);
    expect(json.users[0].name).toBe('Arjun Latiwala');
    expect(json.users[0].email).toBe('arjun.latiwala@creolestudios.com');
  });

  it('excludes admin users from the user list based on profile role', async () => {
    mockProfiles = [
      { user_id: 'u-admin-1', email: 'admin@creolestudios.com', role: 'admin' },
      { user_id: 'u-user-1', email: 'priya.dhanani@creolestudios.com', role: 'user' },
      { user_id: 'u-user-2', email: 'dev@creolestudios.com', role: 'user' },
    ];

    mockListUsers.mockResolvedValue({
      data: {
        users: [
          {
            id: 'u-admin-1',
            email: 'admin@creolestudios.com',
            last_sign_in_at: '2026-09-01T07:24:47.077502Z',
            user_metadata: { full_name: 'Admin User' },
          },
          {
            id: 'u-user-1',
            email: 'priya.dhanani@creolestudios.com',
            last_sign_in_at: '2026-09-01T07:24:47.077502Z',
            user_metadata: { full_name: 'Priya Dhanani' },
          },
          {
            id: 'u-user-2',
            email: 'dev@creolestudios.com',
            last_sign_in_at: '2026-09-01T07:24:47.077502Z',
            user_metadata: { full_name: 'Regular Dev' },
          },
        ],
      },
      error: null,
    });

    const req = new Request('http://localhost:3000/api/admin/zoho/users?type=week');
    const response = await GET(req);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.users).toHaveLength(2);
    expect(json.users.map((u: any) => u.email)).toEqual([
      'dev@creolestudios.com',
      'priya.dhanani@creolestudios.com',
    ]);
  });
});
