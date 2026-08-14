import { describe, it, expect, vi, afterEach } from 'vitest';
import { mockUserFromCookie, isMockUserAllowed, MOCK_USER, resolveUserOrMock } from './mock-user';

describe('mockUserFromCookie', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    (process.env as any).NODE_ENV = originalEnv;
  });

  it('returns null in production regardless of cookie value', () => {
    (process.env as any).NODE_ENV = 'production';
    expect(mockUserFromCookie('true')).toBeNull();
  });

  it('returns null when cookie value is not "true"', () => {
    (process.env as any).NODE_ENV = 'test';
    expect(mockUserFromCookie('false')).toBeNull();
    expect(mockUserFromCookie(undefined)).toBeNull();
  });

  it('returns the mock user when allowed and cookie is "true"', () => {
    (process.env as any).NODE_ENV = 'test';
    expect(mockUserFromCookie('true')).toEqual(MOCK_USER);
  });

  it('isMockUserAllowed reflects NODE_ENV', () => {
    (process.env as any).NODE_ENV = 'production';
    expect(isMockUserAllowed()).toBe(false);
    (process.env as any).NODE_ENV = 'development';
    expect(isMockUserAllowed()).toBe(true);
  });
});

describe('resolveUserOrMock', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    (process.env as any).NODE_ENV = originalEnv;
    vi.doUnmock('next/headers');
  });

  it('returns the real Supabase user when present', async () => {
    const supabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'real-user' } } }) },
    };

    const user = await resolveUserOrMock(supabase);
    expect(user).toEqual({ id: 'real-user' });
  });

  it('falls back to the mock-user cookie when there is no real session', async () => {
    (process.env as any).NODE_ENV = 'test';
    vi.doMock('next/headers', () => ({
      cookies: vi.fn().mockResolvedValue({
        get: vi.fn().mockReturnValue({ value: 'true' }),
      }),
    }));

    const supabase = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    };

    const user = await resolveUserOrMock(supabase);
    expect(user).toEqual(MOCK_USER);
  });
});
