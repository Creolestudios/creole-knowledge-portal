const BLOG_SERVICE_URL =
  process.env.BLOG_SERVICE_URL || 'http://localhost:8000/api/v1';

const INTERNAL_TOKEN =
  process.env.BLOG_INTERNAL_TOKEN ||
  process.env.AUTH_SECRET_KEY ||
  'change-me-to-a-32-char-secret';

export function blogServiceHeaders(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'X-Internal-Token': INTERNAL_TOKEN,
  };
}

export function blogServiceUrl(path: string): string {
  return `${BLOG_SERVICE_URL.replace(/\/$/, '')}${path}`;
}
