import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { config } from '@/middleware';

const ORIGINAL_ENV = { ...process.env };

describe('authCookieDefaults', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('window', undefined);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
  });

  it('uses Secure/SameSite=None on an https origin', async () => {
    process.env.APP_URL = 'https://portal.example.com';
    const { authCookieDefaults } = await import('./cookie-options');
    expect(authCookieDefaults()).toEqual({ sameSite: 'none', secure: true, path: '/' });
  });

  it('does not set Secure on a plain http origin, so refreshed tokens persist', async () => {
    process.env.APP_URL = 'http://localhost:3000';
    const { authCookieDefaults } = await import('./cookie-options');
    expect(authCookieDefaults()).toEqual({ sameSite: 'lax', secure: false, path: '/' });
  });
});

describe('middleware matcher', () => {
  it('covers /api so the Supabase session is refreshed on API calls', () => {
    expect(config.matcher).toContain('/api/:path*');
  });
});
