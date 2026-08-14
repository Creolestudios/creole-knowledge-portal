import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';

const mockExchangeCodeForSession = vi.fn();
const mockProfileSingle = vi.fn();

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

function mockRequest(url: string) {
  return new Request(url);
}

describe('GET /auth/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
