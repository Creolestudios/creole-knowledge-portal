import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';

const mockExchangeCodeForSession = vi.fn();
const mockProfileSingle = vi.fn();
const mockAdminInsert = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { exchangeCodeForSession: (...args: any[]) => mockExchangeCodeForSession(...args) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ single: (...args: any[]) => mockProfileSingle(...args) }),
      }),
    }),
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn().mockReturnValue({
      insert: (...args: any[]) => mockAdminInsert(...args)
    })
  }
}));

function mockRequest(url: string) {
  return new Request(url);
}

describe('GET /auth/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminInsert.mockResolvedValue({ error: null });
  });

  it('redirects to the login page with the error message when the provider returns an error param', async () => {
    const res = await GET(
      mockRequest('http://localhost/auth/callback?error=access_denied&error_description=User+cancelled'),
    );
    expect(res.status).toBe(307);
    const location = res.headers.get('location');
    expect(location).toContain('/?error=User%20cancelled');
  });

  it('redirects with a generic error when neither code nor error is present', async () => {
    const res = await GET(mockRequest('http://localhost/auth/callback'));
    const location = res.headers.get('location');
    expect(location).toContain('error=Authentication%20failed');
  });

  it('redirects with a friendlier message on an expired flow-state exchange error', async () => {
    mockExchangeCodeForSession.mockResolvedValue({
      data: {},
      error: { message: 'invalid flow state, no valid flow state found' },
    });

    const res = await GET(mockRequest('http://localhost/auth/callback?code=abc123'));
    const location = res.headers.get('location');
    expect(location).toContain('Login%20session%20expired');
  });

  it('redirects to /dashboard for a regular authenticated user', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@x.com' } }, error: null });
    mockProfileSingle.mockResolvedValue({ data: { role: 'user' } });

    const res = await GET(mockRequest('http://localhost/auth/callback?code=abc123'));
    const location = res.headers.get('location');
    expect(location).toContain('/dashboard');
  });

  it('redirects admin users to /admin/dashboard', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ data: { user: { id: 'u1', email: 'admin@x.com' } }, error: null });
    mockProfileSingle.mockResolvedValue({ data: { role: 'admin' } });

    const res = await GET(mockRequest('http://localhost/auth/callback?code=abc123'));
    const location = res.headers.get('location');
    expect(location).toContain('/admin/dashboard');
  });

  it('redirects with an error when the exchange succeeds but no user is returned', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ data: { user: null }, error: null });

    const res = await GET(mockRequest('http://localhost/auth/callback?code=abc123'));
    const location = res.headers.get('location');
    expect(location).toContain('No%20user%20found');
  });

  it('redirects with an internal-error message when the exchange throws', async () => {
    mockExchangeCodeForSession.mockRejectedValue(new Error('boom'));

    const res = await GET(mockRequest('http://localhost/auth/callback?code=abc123'));
    const location = res.headers.get('location');
    expect(location).toContain('Internal%20auth%20error');
  });

  it('still redirects to the intended destination when the profile lookup throws', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    mockProfileSingle.mockRejectedValue(new Error('profile lookup failed'));

    const res = await GET(mockRequest('http://localhost/auth/callback?code=abc123&next=/dashboard/quizzes'));
    const location = res.headers.get('location');
    expect(location).toContain('/dashboard/quizzes');
  });

  it('creates a default user profile if none exists and redirects to /dashboard', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ data: { user: { id: 'u123', email: 'user@x.com' } }, error: null });
    mockProfileSingle.mockResolvedValue({ data: null, error: { message: 'Profile not found' } });

    const res = await GET(mockRequest('http://localhost/auth/callback?code=abc123'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/dashboard');
    expect(mockAdminInsert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'u123',
      email: 'user@x.com',
      role: 'user',
    }));
  });

  it('creates a default admin profile for Priya if none exists and redirects to /admin/dashboard', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ data: { user: { id: 'u456', email: 'priya.dhanani@creolestudios.com' } }, error: null });
    mockProfileSingle.mockResolvedValue({ data: null, error: { message: 'Profile not found' } });

    const res = await GET(mockRequest('http://localhost/auth/callback?code=abc123'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/admin/dashboard');
    expect(mockAdminInsert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'u456',
      email: 'priya.dhanani@creolestudios.com',
      role: 'admin',
    }));
  });

  it('handles database insertion error when creating a default profile', async () => {
    mockExchangeCodeForSession.mockResolvedValue({ data: { user: { id: 'u789', email: 'user@x.com' } }, error: null });
    mockProfileSingle.mockResolvedValue({ data: null, error: { message: 'Profile not found' } });
    mockAdminInsert.mockResolvedValue({ error: new Error('Database insert failed') });

    const res = await GET(mockRequest('http://localhost/auth/callback?code=abc123'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/dashboard');
  });
});
