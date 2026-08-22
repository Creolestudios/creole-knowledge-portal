/** Normalized app base path from NEXT_PUBLIC_BASE_PATH (empty locally). */
export function getBasePath(): string {
  const raw = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  if (!raw || raw === '/') return '';
  return raw.startsWith('/') ? raw.replace(/\/$/, '') : `/${raw.replace(/\/$/, '')}`;
}

/** Prefix an app route with the configured base path. */
export function withBasePath(path: string): string {
  const base = getBasePath();
  const normalized = path.startsWith('/') ? path : `/${path}`;

  if (!base) return normalized;
  if (normalized === '/') return `${base}/`;
  return `${base}${normalized}`;
}

/** Public origin for auth redirects (localhost keeps port; prod uses https). */
export function getPublicOrigin(hostname: string, protocol: string, port?: string): string {
  const isLocalhost = hostname === 'localhost';
  return isLocalhost
    ? `${protocol}//${hostname}${port ? `:${port}` : ''}`
    : `https://${hostname}`;
}

export function getPublicOriginFromUrl(url: URL): string {
  return getPublicOrigin(url.hostname, url.protocol, url.port || undefined);
}

/** Full Supabase redirect URL for the auth callback handler. */
export function getAuthCallbackUrl(origin: string): string {
  return `${origin}${withBasePath('/auth/callback')}`;
}
