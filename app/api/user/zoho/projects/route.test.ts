import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { FALLBACK_PROJECTS, clearProjectsCacheForTesting } from '@/lib/zoho/projects-cache';

const mockGetUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: mockGetUser,
    },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null }),
    })),
  })),
}));

const mockGetZohoAccessToken = vi.fn();
const mockFetchZohoPortalProjects = vi.fn();
const mockFetchZohoUserProjects = vi.fn();
const mockFetchZohoPortalUsers = vi.fn();

vi.mock('@/lib/zoho/client', () => ({
  getZohoAccessToken: () => mockGetZohoAccessToken(),
  fetchZohoPortalProjects: (...args: any[]) => mockFetchZohoPortalProjects(...args),
  fetchZohoUserProjects: (...args: any[]) => mockFetchZohoUserProjects(...args),
  fetchZohoPortalUsers: (...args: any[]) => mockFetchZohoPortalUsers(...args),
}));

describe('GET /api/user/zoho/projects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearProjectsCacheForTesting();
  });

  it('returns 401 Unauthorized if user is not signed in', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });

    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns active Zoho projects from Zoho Projects API', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'usr-123', email: 'dev@creolestudios.com' } },
    });
    mockGetZohoAccessToken.mockResolvedValueOnce('valid-zoho-token');
    mockFetchZohoPortalProjects.mockResolvedValueOnce([
      { id: '1892000000099000', id_string: '1892000000099000', name: 'Creole Knowledge Portal', status: 'active' },
      { id: '1892000000088000', id_string: '1892000000088000', name: 'Client Banking Mobile App', status: 'active' },
    ]);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toBeDefined();
    expect(body.projects.length).toBeGreaterThanOrEqual(2);
    expect(body.projects.some((p: any) => p.name === 'Creole Knowledge Portal')).toBe(true);
  });

  it('falls back to default projects gracefully if Zoho token is unavailable', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'usr-456', email: 'test@creolestudios.com' } },
    });
    mockGetZohoAccessToken.mockResolvedValueOnce(null);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toBeDefined();
    expect(body.projects.length).toBe(FALLBACK_PROJECTS.length);
  });

  it('returns only projects assigned to user when zoho_user_id mapping exists', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'usr-srushti', email: 'srushti@creolestudios.com' } },
    });
    mockGetZohoAccessToken.mockResolvedValueOnce('valid-zoho-token');
    mockFetchZohoPortalUsers.mockResolvedValueOnce([
      { id: '60063203095', id_string: '60063203095', email: 'srushti@creolestudios.com', name: 'Srushti' },
    ]);
    mockFetchZohoUserProjects.mockResolvedValueOnce([
      { id: '56869000011123471', id_string: '56869000011123471', name: 'Research & Training 2025' },
      { id: '56869000013341337', id_string: '56869000013341337', name: 'CKP Portal' },
    ]);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toBeDefined();
    expect(body.projects.length).toBe(2);
    expect(body.projects[0].name).toBe('Research & Training 2025');
    expect(body.projects[1].name).toBe('CKP Portal');
    expect(mockFetchZohoUserProjects).toHaveBeenCalled();
  });

  it('bypasses cache when ?refresh=true is provided', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'usr-refresh', email: 'dev@creolestudios.com' } },
    });
    mockGetZohoAccessToken.mockResolvedValue('valid-zoho-token');
    mockFetchZohoPortalProjects
      .mockResolvedValueOnce([
        { id: 'p1', id_string: 'p1', name: 'Initial Project', status: 'active' },
      ])
      .mockResolvedValueOnce([
        { id: 'p1', id_string: 'p1', name: 'Initial Project', status: 'active' },
        { id: 'p2', id_string: 'p2', name: 'Newly Allocated Project', status: 'active' },
      ]);

    // Initial fetch caches 1 project
    const initialRes = await GET();
    const initialBody = await initialRes.json();
    expect(initialBody.projects.length).toBe(1);

    // Call with ?refresh=true forces a live re-fetch
    const req = new Request('http://localhost:3000/api/user/zoho/projects?refresh=true');
    const refreshRes = await GET(req);
    const refreshBody = await refreshRes.json();
    expect(refreshBody.projects.length).toBe(2);
    expect(refreshBody.projects.some((p: any) => p.name === 'Newly Allocated Project')).toBe(true);
  });
});
