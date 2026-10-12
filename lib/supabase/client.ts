import { createBrowserClient } from '@supabase/ssr';
import { authCookieDefaults } from './cookie-options';

let browserClient: ReturnType<typeof createBrowserClient> | undefined;

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    // Return a dummy client or handle the error gracefully for build/preview
    console.warn('Supabase URL or Anon Key is missing. Shared/Deployed builds will require these secrets.');
  }

  if (typeof window !== 'undefined' && browserClient) {
    return browserClient;
  }

  const client = createBrowserClient(
    url || 'https://placeholder.supabase.co',
    key || 'placeholder-key',
    {
      cookieOptions: authCookieDefaults(),
      isSingleton: true,
    }
  );

  if (typeof window !== 'undefined') {
    browserClient = client;
  }

  return client;
}
