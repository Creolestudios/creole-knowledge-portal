import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const mockGetUser = vi.fn();
const mockSingle = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockImplementation(() => ({
    auth: { getUser: mockGetUser },
  })),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ single: mockSingle }),
      }),
    }),
  })),
}));

// admin.ts throws at module-load time if SUPABASE_SERVICE_ROLE_KEY is unset,
// so it must be stubbed before the (dynamic) import evaluates the module.
let requireAdminUser: typeof import('./admin').requireAdminUser;

beforeAll(async () => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  ({ requireAdminUser } = await import('./admin'));
});

describe('requireAdminUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when there is no authenticated user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const result = await requireAdminUser();
    expect(result).toBeNull();
  });

  it('returns null when the profile lookup errors', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockSingle.mockResolvedValue({ data: null, error: new Error('db error') });

    const result = await requireAdminUser();
    expect(result).toBeNull();
  });

  it('returns null when the user profile role is not admin', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockSingle.mockResolvedValue({ data: { role: 'user' }, error: null });

    const result = await requireAdminUser();
    expect(result).toBeNull();
  });

  it('returns the userId when the profile role is admin', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockSingle.mockResolvedValue({ data: { role: 'admin' }, error: null });

    const result = await requireAdminUser();
    expect(result).toEqual({ userId: 'u1' });
  });
});
