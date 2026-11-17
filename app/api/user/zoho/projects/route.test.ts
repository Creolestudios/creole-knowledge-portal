import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { FALLBACK_PROJECTS, clearProjectsCacheForTesting } from '@/lib/zoho/projects-cache';

const mockGetUser = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: mockGetUser,
    },
  })),
}));

const mockGetZohoAccessToken = vi.fn();
const mockFetchZohoPortalProjects = vi.fn();

vi.mock('@/lib/zoho/client', () => ({
  getZohoAccessToken: () => mockGetZohoAccessToken(),
  fetchZohoPortalProjects: (...args: any[]) => mockFetchZohoPortalProjects(...args),
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
});
