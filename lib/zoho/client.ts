/**
 * Zoho Projects Free API Client & Deep-Link Utility
 *
 * Implements Zoho REST API integration:
 * - OAuth 2.0 token management & automated refresh with in-memory caching
 * - Task, Timelog, and Comment fetching with rate-limit respect
 * - Deep link URL construction for direct one-click navigation
 * - Real-time task syncing and HTML description sanitation
 */

export interface ZohoProject {
  id: string;
  name: string;
  status: string;
}

export interface ZohoTaskRaw {
  id: string;
  name: string;
  description: string;
  status: { name: string; type: string };
  duration: string; // e.g., "4:00"
  duration_in_hours: number;
  created_time_format: string;
  last_updated_time_format: string;
  link: { self: { url: string }; timesheet?: { url: string } };
}

export interface ZohoUserRaw {
  id: string;
  name: string;
  email: string;
  role_name?: string;
  active?: boolean;
}

export interface ZohoTimeLog {
  id: string;
  hours: number;
  minutes: number;
  total_minutes: number;
  log_date: string;
  notes: string;
}

export interface ZohoComment {
  id: string;
  content: string;
  author_name: string;
  added_time: string;
}

/**
 * Strips HTML tags and entities cleanly without super-linear regex backtracking
 */
export function stripHtml(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .replaceAll(/<br\s*\/?>/gi, ' ')
    .replaceAll(/<\/p>/gi, ' ')
    .replaceAll(/<[^>]*>/g, '')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&nbsp;', ' ')
    .trim();
}

/**
 * Builds direct Zoho task URL for one-click navigation from CKP to Zoho Projects
 */
export function buildZohoTaskDeepLink(
  portalId: string,
  projectId: string,
  taskId: string
): string {
  const safePortal = portalId || 'creolestudiosdotcom1';
  return `https://projects.zoho.com/portal/${safePortal}#taskdetail/${projectId}/${taskId}`;
}

/**
 * Parses time string like "4:30" or "4h 30m" into decimal hours and total minutes
 */
export function parseDurationToMinutes(durationStr: string | number): number {
  if (typeof durationStr === 'number') {
    return Math.round(durationStr * 60);
  }
  if (!durationStr || typeof durationStr !== 'string') return 0;

  const trimmed = durationStr.trim();
  if (trimmed.includes(':')) {
    const [h, m] = trimmed.split(':').map(val => parseInt(val, 10));
    const hours = Number.isNaN(h) ? 0 : h;
    const minutes = Number.isNaN(m) ? 0 : m;
    return hours * 60 + minutes;
  }

  const hoursMatch = trimmed.match(/(\d+)\s*h/i);
  const minsMatch = trimmed.match(/(\d+)\s*m/i);
  let total = 0;
  if (hoursMatch) total += parseInt(hoursMatch[1], 10) * 60;
  if (minsMatch) total += parseInt(minsMatch[1], 10);

  if (total === 0) {
    const rawNum = parseFloat(trimmed);
    if (!Number.isNaN(rawNum)) return Math.round(rawNum * 60);
  }

  return total;
}

// Global in-memory token cache to prevent hitting Zoho OAuth rate limiters
let tokenCache: {
  accessToken: string;
  expiresAt: number;
} | null = null;

/**
 * Refreshes Zoho OAuth access token with expiration caching
 */
export async function refreshZohoAccessToken(params: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accountsUrl?: string;
}): Promise<{ accessToken: string; expiresIn: number } | null> {
  try {
    const accountsUrl = params.accountsUrl || process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.in';
    const body = new URLSearchParams({
      refresh_token: params.refreshToken,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      grant_type: 'refresh_token',
    });

    const res = await fetch(`${accountsUrl}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[ZohoClient] Refresh token request failed: ${res.status}`, errText);
      // If we have an existing unexpired cached token, reuse it
      if (tokenCache && tokenCache.expiresAt > Date.now()) {
        return {
          accessToken: tokenCache.accessToken,
          expiresIn: Math.round((tokenCache.expiresAt - Date.now()) / 1000),
        };
      }
      return null;
    }

    const data = await res.json();
    if (!data.access_token) {
      console.warn('[ZohoClient] Refresh response did not include access_token:', data);
      return null;
    }

    const expiresIn = data.expires_in || 3600;
    tokenCache = {
      accessToken: data.access_token,
      expiresAt: Date.now() + expiresIn * 1000,
    };

    return {
      accessToken: data.access_token,
      expiresIn,
    };
  } catch (error) {
    console.error('[ZohoClient] Error refreshing Zoho token:', error);
    if (tokenCache && tokenCache.expiresAt > Date.now()) {
      return {
        accessToken: tokenCache.accessToken,
        expiresIn: Math.round((tokenCache.expiresAt - Date.now()) / 1000),
      };
    }
    return null;
  }
}

/**
 * Retrieves valid cached or freshly refreshed Zoho Access Token
 */
export async function getZohoAccessToken(): Promise<string | null> {
  const clientId = process.env.ZOHO_CLIENT_ID;
  const clientSecret = process.env.ZOHO_CLIENT_SECRET;
  const refreshToken = process.env.ZOHO_REFRESH_TOKEN;
  const accountsUrl = process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.in';

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  // If token is cached and has at least 3 minutes left, return it
  if (tokenCache && tokenCache.expiresAt > Date.now() + 180000) {
    return tokenCache.accessToken;
  }

  const result = await refreshZohoAccessToken({
    clientId,
    clientSecret,
    refreshToken,
    accountsUrl,
  });

  return result?.accessToken || null;
}

/**
 * Fetches all users registered in the Zoho Projects portal
 */
export async function fetchZohoPortalUsers(
  token: string,
  portalId: string
): Promise<ZohoUserRaw[]> {
  try {
    const apiBase = process.env.ZOHO_API_BASE_URL || 'https://projectsapi.zoho.in/restapi';
    const res = await fetch(`${apiBase}/portal/${portalId}/users/`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    if (!res.ok) {
      console.warn(`[ZohoClient] Failed to fetch users: ${res.status}`);
      return [];
    }
    const data = await res.json();
    return data.users || [];
  } catch (err) {
    console.error('[ZohoClient] fetchZohoPortalUsers error:', err);
    return [];
  }
}

/**
 * Fetches tasks assigned to a specific Zoho user
 */
export async function fetchZohoUserTasks(
  token: string,
  portalId: string,
  zohoUserId: string,
  range = 100
): Promise<any[]> {
  try {
    const apiBase = process.env.ZOHO_API_BASE_URL || 'https://projectsapi.zoho.in/restapi';
    const res = await fetch(
      `${apiBase}/portal/${portalId}/mytasks/?owner=${encodeURIComponent(zohoUserId)}&range=${range}`,
      {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      }
    );
    if (!res.ok) {
      console.warn(`[ZohoClient] Failed to fetch tasks for user ${zohoUserId}: ${res.status}`);
      return [];
    }
    const data = await res.json();
    return data.tasks || [];
  } catch (err) {
    console.error(`[ZohoClient] fetchZohoUserTasks error for ${zohoUserId}:`, err);
    return [];
  }
}

/**
 * Fetches single task details including full description
 */
export async function fetchZohoTaskDetails(
  token: string,
  portalId: string,
  projectId: string,
  taskId: string
): Promise<{ description: string } | null> {
  try {
    const apiBase = process.env.ZOHO_API_BASE_URL || 'https://projectsapi.zoho.in/restapi';
    const res = await fetch(
      `${apiBase}/portal/${portalId}/projects/${projectId}/tasks/${taskId}/`,
      {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const task = data.tasks?.[0];
    return {
      description: stripHtml(task?.description || ''),
    };
  } catch (err) {
    console.warn(`[ZohoClient] fetchZohoTaskDetails error for ${taskId}:`, err);
    return null;
  }
}
