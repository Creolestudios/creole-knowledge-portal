import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetAll = vi.fn(() => [{ name: 'sb', value: '1' }]);
const mockSet = vi.fn();
const mockCreateServerClient = vi.fn((_url: string, _key: string, options: any) => {
  options.cookies.getAll();
  options.cookies.setAll([{ name: 'sb', value: '2', options: { path: '/' } }]);
  return { ok: true };
});

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    getAll: mockGetAll,
    set: mockSet,
  })),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: (...args: unknown[]) =>
    mockCreateServerClient(...(args as [string, string, unknown])),
}));

vi.mock('./cookie-options', () => ({
  authCookieDefaults: () => ({ sameSite: 'lax', secure: false, path: '/' }),
}));

describe('createClient (server)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  });

  it('builds a server client with env credentials and cookie adapters', async () => {
    const { createClient } = await import('./server');
    const client = await createClient();

    expect(client).toEqual({ ok: true });
    expect(mockCreateServerClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'anon-key',
      expect.objectContaining({ cookies: expect.any(Object) }),
    );
    expect(mockGetAll).toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledWith(
      'sb',
      '2',
      expect.objectContaining({ path: '/' }),
    );
  });

  it('falls back to placeholders and warns when env vars are missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { createClient } = await import('./server');
    await createClient();

    expect(warn).toHaveBeenCalledWith(
      'Supabase URL or Anon Key is missing in server context.',
    );
    expect(mockCreateServerClient).toHaveBeenCalledWith(
      'https://placeholder.supabase.co',
      'placeholder-key',
      expect.any(Object),
    );
    warn.mockRestore();
  });

  it('swallows cookie write failures from Server Components', async () => {
    mockSet.mockImplementationOnce(() => {
      throw new Error('cookies locked');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { createClient } = await import('./server');
    await createClient();

    expect(warn).toHaveBeenCalledWith(
      '[supabase/server] could not persist auth cookies:',
      expect.any(Error),
    );
    warn.mockRestore();
  });
});
