'use client';

import { createClient } from '@/lib/supabase/client';

/**
 * fetch() that recovers from a single expired-session 401.
 *
 * Middleware normally rotates the auth cookie on every request, but a page that
 * stays open for a long time without navigating (e.g. an in-progress quiz) can
 * still hit the window where the access token has just expired. On a 401 we ask
 * Supabase to refresh and replay the request exactly once.
 */
export async function fetchWithAuthRetry(
  input: string,
  init?: RequestInit
): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status !== 401) return res;

  try {
    const supabase = createClient();
    const { error } = await supabase.auth.refreshSession();
    if (error) return res;
  } catch {
    return res;
  }

  return fetch(input, init);
}
