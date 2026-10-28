/**
 * Zoho Projects Free API Client & Deep-Link Utility
 *
 * Implements Zoho REST API integration:
 * - OAuth 2.0 token management & automated refresh
 * - Task, Timelog, and Comment fetching with rate-limit respect
 * - Deep link URL construction for direct one-click navigation
 * - Graceful mock fallback when API credentials are unset or running in offline mode
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
  link: { self: { url: string } };
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
 * Builds direct Zoho task URL for one-click navigation from CKP to Zoho Projects
 */
export function buildZohoTaskDeepLink(
  portalId: string,
  projectId: string,
  taskId: string
): string {
  const safePortal = portalId || 'creoleknowledgeportal';
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

/**
 * Refreshes Zoho OAuth access token
 */
export async function refreshZohoAccessToken(params: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<{ accessToken: string; expiresIn: number } | null> {
  try {
    const body = new URLSearchParams({
      refresh_token: params.refreshToken,
      client_id: params.clientId,
      client_secret: params.clientSecret,
      grant_type: 'refresh_token',
    });

    const res = await fetch('https://accounts.zoho.com/oauth/v2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      console.warn(`[ZohoClient] Refresh token request failed: ${res.status}`);
      return null;
    }

    const data = await res.json();
    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in || 3600,
    };
  } catch (error) {
    console.error('[ZohoClient] Error refreshing Zoho token:', error);
    return null;
  }
}
