import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { authCookieDefaults } from './cookie-options';

export async function createClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.warn('Supabase URL or Anon Key is missing in server context.');
  }

  return createServerClient(
    url || 'https://placeholder.supabase.co',
    key || 'placeholder-key',
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, {
                ...options,
                ...authCookieDefaults(),
              });
            });
          } catch (error) {
            // Server Components cannot write cookies; middleware refreshes the
            // session instead. Anywhere else this is a real failure worth seeing.
            console.warn('[supabase/server] could not persist auth cookies:', error);
          }
        },
      },
    }
  );
}
