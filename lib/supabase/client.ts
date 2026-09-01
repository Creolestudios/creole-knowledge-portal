import { createBrowserClient } from '@supabase/ssr';
import { authCookieDefaults } from './cookie-options';

export function createClient() {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const rawKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const url = rawUrl ? rawUrl.replace(/^["']|["']$/g, '').trim() : undefined;
  const key = rawKey ? rawKey.replace(/^["']|["']$/g, '').trim() : undefined;

  if (!url || !key) {
    // Return a dummy client or handle the error gracefully for build/preview
    console.warn('Supabase URL or Anon Key is missing. Shared/Deployed builds will require these secrets.');
  }

  const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';

  return createBrowserClient(
    url || 'https://placeholder.supabase.co',
    key || 'placeholder-key',
    {
      cookieOptions: authCookieDefaults(),
    }
  );
}
