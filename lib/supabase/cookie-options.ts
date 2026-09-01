/**
 * Shared auth-cookie attributes.
 *
 * `Secure` cookies are silently discarded by browsers over plain http, which
 * breaks Supabase's refresh-token rotation: the old token is consumed, the
 * replacement is dropped, and every later request 401s. So only send
 * `secure` + `sameSite: 'none'` when we are genuinely on https.
 */
export function isSecureOrigin(): boolean {
  if (typeof window !== 'undefined') {
    return window.location.protocol === 'https:';
  }

  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '';
  if (appUrl.startsWith('https://')) return true;
  if (appUrl.startsWith('http://')) return false;

  return process.env.NODE_ENV === 'production';
}

export type AuthCookieDefaults = {
  sameSite: 'none' | 'lax';
  secure: boolean;
  path: string;
};

export function authCookieDefaults(): AuthCookieDefaults {
  return isSecureOrigin()
    ? { sameSite: 'none', secure: true, path: '/' }
    : { sameSite: 'lax', secure: false, path: '/' };
}
