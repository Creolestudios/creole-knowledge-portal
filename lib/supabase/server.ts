import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { authCookieDefaults } from './cookie-options';

export async function createClient(response?: { cookies: { set: (name: string, value: string, options?: any) => any } }) {
  const cookieStore = await cookies();
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const rawKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const url = rawUrl ? rawUrl.replace(/^["']|["']$/g, '').trim() : undefined;
  const key = rawKey ? rawKey.replace(/^["']|["']$/g, '').trim() : undefined;

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
              const mergedOptions = {
                ...options,
                ...authCookieDefaults(),
              };
              cookieStore.set(name, value, mergedOptions);
              if (response) {
                try {
                  response.cookies.set(name, value, mergedOptions);
                } catch {
                  // ignore if response cookies cannot be modified
                }
              }
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
