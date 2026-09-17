import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockGetUser = vi.fn();
const mockProfileSingle = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn().mockImplementation(() => ({
    auth: { getUser: (...args: any[]) => mockGetUser(...args) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ single: (...args: any[]) => mockProfileSingle(...args) }),
      }),
    }),
  })),
}));

import { middleware } from './middleware';

function makeRequest(path: string, cookie?: string) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  return new NextRequest(new Request(`http://localhost${path}`, { headers }));
}

describe('middleware', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    (process.env as any).NODE_ENV = 'test';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('passes through untouched when Supabase env vars are not configured', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const res = await middleware(makeRequest('/dashboard'));
    expect(res.status).toBe(200);
  });

  it('redirects an unauthenticated user away from /dashboard to the login page', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await middleware(makeRequest('/dashboard'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/');
  });

  it('redirects an unauthenticated user away from /admin to the login page', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await middleware(makeRequest('/admin/dashboard'));
    expect(res.headers.get('location')).toContain('/');
  });

  it('lets an authenticated non-admin user through to /dashboard', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'dev@x.com' } } });
    mockProfileSingle.mockResolvedValue({ data: { role: 'user' } });

    const res = await middleware(makeRequest('/dashboard'));
    expect(res.status).toBe(200);
  });

  it('redirects an authenticated non-admin away from the AI interview extractor', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'dev@x.com' } } });
    mockProfileSingle.mockResolvedValue({ data: { role: 'user' } });

    const res = await middleware(makeRequest('/dashboard/ai-interview/extractor'));
    expect(res.headers.get('location')).toContain('/dashboard');
  });

  it('redirects an authenticated non-admin away from /admin to /dashboard', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'dev@x.com' } } });
    mockProfileSingle.mockResolvedValue({ data: { role: 'user' } });

    const res = await middleware(makeRequest('/admin/dashboard'));
    expect(res.headers.get('location')).toContain('/dashboard');
  });

  it('redirects an authenticated non-admin away from the login page to /dashboard', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'dev@x.com' } } });
    mockProfileSingle.mockResolvedValue({ data: { role: 'user' } });

    const res = await middleware(makeRequest('/'));
    expect(res.headers.get('location')).toContain('/dashboard');
  });

  it('redirects an authenticated admin away from the login page to /admin/dashboard', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'admin-1', email: 'priya.dhanani@creolestudios.com' } } });
    mockProfileSingle.mockResolvedValue({ data: { role: 'admin' } });

    const res = await middleware(makeRequest('/'));
    expect(res.headers.get('location')).toContain('/admin/dashboard');
  });

  it('lets an authenticated admin through to /admin/dashboard', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'admin-1', email: 'priya.dhanani@creolestudios.com' } } });
    mockProfileSingle.mockResolvedValue({ data: { role: 'admin' } });

    const res = await middleware(makeRequest('/admin/dashboard'));
    expect(res.status).toBe(200);
  });

  it('does not treat a mockUser query param as a logged-in session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await middleware(makeRequest('/dashboard?mockUser=true'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/');
    expect(mockGetUser).toHaveBeenCalled();
  });

  it('does not treat a mock-user cookie as a logged-in session', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await middleware(makeRequest('/dashboard', 'mock-user=true'));
    expect(res.headers.get('location')).toContain('/');
  });

  it('tolerates a getUser failure and treats the request as unauthenticated', async () => {
    mockGetUser.mockRejectedValue(new Error('network error'));
    const res = await middleware(makeRequest('/dashboard'));
    expect(res.headers.get('location')).toContain('/');
  });

  it('tolerates a profile lookup failure and treats the user as non-admin', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'dev@x.com' } } });
    mockProfileSingle.mockRejectedValue(new Error('db down'));

    const res = await middleware(makeRequest('/admin/dashboard'));
    expect(res.headers.get('location')).toContain('/dashboard');
  });
});
