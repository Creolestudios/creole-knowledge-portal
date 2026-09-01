import { createBrowserClient } from '@supabase/ssr';
import { authCookieDefaults } from './cookie-options';

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    // Return a dummy client or handle the error gracefully for build/preview
    console.warn('Supabase URL or Anon Key is missing. Shared/Deployed builds will require these secrets.');
  }

  return createBrowserClient(
    url || 'https://placeholder.supabase.co',
    key || 'placeholder-key',
    {
      cookieOptions: authCookieDefaults(),
    }
  );
}
