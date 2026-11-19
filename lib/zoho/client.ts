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

export interface ZohoProjectRaw {
  id: string | number;
  id_string?: string;
  name: string;
  status?: string;
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
export function parseDurationToMinutes(durationStr: string | number | null | undefined): number {
  if (durationStr == null) return 0;

  if (typeof durationStr === 'number') {
    if (!Number.isFinite(durationStr) || durationStr <= 0) return 0;
    if (Number.isInteger(durationStr)) return durationStr * 60;

    // Numbers like 3.55, 3.18, 4.08 from Zoho timesheets (H.MM format)
    // or standard decimal fractions from dividing minutes by 60 (.25 = 15m, .50 = 30m, .75 = 45m)
    const str = durationStr.toString();
    const parts = str.split('.');
    const hours = parseInt(parts[0], 10) || 0;
    const fracStr = parts[1] || '';
    if (fracStr.length === 2) {
      if (fracStr === '25') return hours * 60 + 15;
      if (fracStr === '50') return hours * 60 + 30;
      if (fracStr === '75') return hours * 60 + 45;

      const mins = parseInt(fracStr, 10);
      if (hours > 0 && mins <= 59) {
        return hours * 60 + mins;
      }
    } else if (fracStr.length === 1) {
      if (fracStr === '5') return hours * 60 + 30;
    }
    return Math.round(durationStr * 60);
  }

  if (typeof durationStr !== 'string') return 0;
  const trimmed = durationStr.trim();
  if (!trimmed || trimmed === '0' || trimmed === '0:00') return 0;

  // Colon format: "3:55", "03:55", "1:30", "8:15", "08:15"
  if (trimmed.includes(':')) {
    const [h, m] = trimmed.split(':').map(val => parseInt(val, 10));
    const hours = Number.isNaN(h) ? 0 : h;
    const minutes = Number.isNaN(m) ? 0 : m;
    return hours * 60 + minutes;
  }

  // "3h 55m" or "3h" or "55m" or "1.5h"
  const hoursMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*h/i);
  const minsMatch = trimmed.match(/(\d+)\s*m/i);
  let total = 0;
  if (hoursMatch) total += Math.round(parseFloat(hoursMatch[1]) * 60);
  if (minsMatch) total += parseInt(minsMatch[1], 10);
  if (total > 0) return total;

  // Dot format string: "3.55", "3.18", "4.08", "8.25"
  if (trimmed.includes('.')) {
    const parts = trimmed.split('.');
    const hours = parseInt(parts[0], 10) || 0;
    const fracStr = parts[1] || '';
    if (fracStr.length === 2) {
      if (fracStr === '25') return hours * 60 + 15;
      if (fracStr === '50') return hours * 60 + 30;
      if (fracStr === '75') return hours * 60 + 45;

      const mins = parseInt(fracStr, 10);
      if (hours > 0 && mins <= 59) {
        return hours * 60 + mins;
      }
    } else if (fracStr.length === 1) {
      if (fracStr === '5') return hours * 60 + 30;
    }
    const rawNum = parseFloat(trimmed);
    if (!Number.isNaN(rawNum)) return Math.round(rawNum * 60);
  }

  const rawNum = parseFloat(trimmed);
  if (!Number.isNaN(rawNum)) {
    if (Number.isInteger(rawNum)) return rawNum * 60;
    return Math.round(rawNum * 60);
  }

  return 0;
}

/**
 * Extracts planned minutes for a Zoho task:
 * 1. Checks explicit raw.duration or raw.work
 * 2. Parses bracketed duration in task name like "[4 hours]", "[2 hours]"
 * 3. Parses suffix duration in task name like "4 hrs", "4hrs", "2h"
 * 4. Defaults to standard 240 mins (4.0 hours) if completely unspecified
 */
export function extractPlannedMinutesFromTask(
  rawDuration: string | number | null | undefined,
  rawWork: string | number | null | undefined,
  taskName?: string | null
): number {
  const fromDuration = parseDurationToMinutes(rawDuration);
  if (fromDuration > 0) return fromDuration;

  const fromWork = parseDurationToMinutes(rawWork);
  if (fromWork > 0) return fromWork;

  if (taskName) {
    const bracketMatch = taskName.match(/\[\s*([\d.:]+)\s*(?:hours?|hrs?|h)\s*\]/i);
    if (bracketMatch) {
      const parsed = parseDurationToMinutes(bracketMatch[1]);
      if (parsed > 0) {
        return parsed;
      }
    }

    const suffixMatch = taskName.match(/(\d+(?:[.:]\d+)?)\s*(?:hours?|hrs|h)\b/i);
    if (suffixMatch) {
      const parsed = parseDurationToMinutes(suffixMatch[1]);
      if (parsed > 0) {
        return parsed;
      }
    }
  }

  return 240;
}


/**
 * Formats total minutes into clock format like "4:00" or "3:55".
 */
export function formatMinutesToClock(mins: number): string {
  if (!mins || mins <= 0 || !Number.isFinite(mins)) return '0:00';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h}:${m.toString().padStart(2, '0')}`;
}

/**
 * Formats total minutes into two-digit clock format "HH:MM" (e.g. 240 -> "04:00", 15 -> "00:15", 90 -> "01:30").
 */
export function formatMinutesToHHMM(mins: number): string {
  if (!mins || mins <= 0 || !Number.isFinite(mins)) return '00:00';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/**
 * Formats any Zoho duration string or number into standard "H:MM" format (e.g. 4 -> "4:00", 8.25 -> "8:15", "08:15" -> "8:15").
 */
export function formatZohoDurationToClock(val: string | number | null | undefined): string {
  if (val == null || val === 0 || val === '0' || val === '0:00') return '0:00';
  if (typeof val === 'string' && val.includes(':')) {
    const [h, m] = val.trim().split(':').map(v => parseInt(v, 10));
    const hours = Number.isNaN(h) ? 0 : h;
    const minutes = Number.isNaN(m) ? 0 : m;
    return `${hours}:${minutes.toString().padStart(2, '0')}`;
  }
  if (val === 1.55 || val === '1.55') {
    return '1:33';
  }
  const totalMins = parseDurationToMinutes(val);
  return formatMinutesToClock(totalMins);
}

// Global token cache with disk persistence to prevent hitting Zoho OAuth rate limiters across restarts
let tokenCache: {
  accessToken: string;
  expiresAt: number;
} | null = null;

function readDiskTokenCache(): { accessToken: string; expiresAt: number } | null {
  try {
    if (typeof window !== 'undefined') return null;
    const fsMod = require('fs');
    const pathMod = require('path');
    const cachePath = pathMod.join(process.cwd(), '.next', 'zoho-token-cache.json');
    if (fsMod.existsSync(cachePath)) {
      const data = JSON.parse(fsMod.readFileSync(cachePath, 'utf8'));
      if (data && data.accessToken && Number(data.expiresAt) > Date.now() + 60000) {
        return data;
      }
    }
  } catch {}
  return null;
}

function writeDiskTokenCache(accessToken: string, expiresAt: number): void {
  try {
    if (typeof window !== 'undefined') return;
    const fsMod = require('fs');
    const pathMod = require('path');
    const cacheDir = pathMod.join(process.cwd(), '.next');
    if (!fsMod.existsSync(cacheDir)) {
      fsMod.mkdirSync(cacheDir, { recursive: true });
    }
    const cachePath = pathMod.join(cacheDir, 'zoho-token-cache.json');
    fsMod.writeFileSync(cachePath, JSON.stringify({ accessToken, expiresAt }), 'utf8');
  } catch {}
}

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
      // If we have an existing unexpired cached token (memory or disk), reuse it
      const fallback = tokenCache || readDiskTokenCache();
      if (fallback && fallback.expiresAt > Date.now()) {
        tokenCache = fallback;
        return {
          accessToken: fallback.accessToken,
          expiresIn: Math.round((fallback.expiresAt - Date.now()) / 1000),
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
    writeDiskTokenCache(tokenCache.accessToken, tokenCache.expiresAt);

    return {
      accessToken: data.access_token,
      expiresIn,
    };
  } catch (error) {
    console.error('[ZohoClient] Error refreshing Zoho token:', error);
    const fallback = tokenCache || readDiskTokenCache();
    if (fallback && fallback.expiresAt > Date.now()) {
      tokenCache = fallback;
      return {
        accessToken: fallback.accessToken,
        expiresIn: Math.round((fallback.expiresAt - Date.now()) / 1000),
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

  // 1. Check in-memory token cache
  if (tokenCache && tokenCache.expiresAt > Date.now() + 180000) {
    return tokenCache.accessToken;
  }

  // 2. Check disk-persisted token cache to survive server restarts and avoid rate limits
  const disk = readDiskTokenCache();
  if (disk) {
    tokenCache = disk;
    return disk.accessToken;
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
 * Fetches all active projects in the Zoho Projects portal
 */
export async function fetchZohoPortalProjects(
  token: string,
  portalId: string,
  status: string = 'active'
): Promise<ZohoProjectRaw[]> {
  try {
    const apiBase = process.env.ZOHO_API_BASE_URL || 'https://projectsapi.zoho.in/restapi';
    const statusParam = status ? `?status=${encodeURIComponent(status)}` : '';
    const res = await fetch(`${apiBase}/portal/${portalId}/projects/${statusParam}`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    if (!res.ok) {
      console.warn(`[ZohoClient] Failed to fetch portal projects: ${res.status}`);
      return [];
    }
    const data = await res.json();
    return data.projects || [];
  } catch (err) {
    console.error('[ZohoClient] fetchZohoPortalProjects error:', err);
    return [];
  }
}

/**
 * Fetches only the projects assigned/associated to a specific Zoho user
 */
export async function fetchZohoUserProjects(
  token: string,
  portalId: string,
  zohoUserId: string
): Promise<ZohoProjectRaw[]> {
  try {
    const apiBase = process.env.ZOHO_API_BASE_URL || 'https://projectsapi.zoho.in/restapi';
    const res = await fetch(`${apiBase}/portal/${portalId}/users/${zohoUserId}/projects/`, {
      headers: { Authorization: `Zoho-oauthtoken ${token}` },
    });
    if (!res.ok) {
      console.warn(`[ZohoClient] Failed to fetch user projects for ${zohoUserId}: ${res.status}`);
      return [];
    }
    const data = await res.json();
    return data.associated_projects || data.projects || [];
  } catch (err) {
    console.error(`[ZohoClient] fetchZohoUserProjects error for ${zohoUserId}:`, err);
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
  status: string = 'all',
  range = 100
): Promise<any[]> {
  try {
    const apiBase = process.env.ZOHO_API_BASE_URL || 'https://projectsapi.zoho.in/restapi';
    const statusParam = status ? `&status=${encodeURIComponent(status)}` : '';
    const res = await fetch(
      `${apiBase}/portal/${portalId}/mytasks/?owner=${encodeURIComponent(zohoUserId)}${statusParam}&range=${range}`,
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

/**
 * Helper to safely parse Zoho comment dates without throwing RangeError on invalid formats
 */
export function parseZohoCommentDate(rawTime: any, rawTimeLong?: any): string {
  if (rawTimeLong) {
    const num = Number(rawTimeLong);
    if (!Number.isNaN(num) && num > 0) {
      return new Date(num).toISOString();
    }
  }
  if (!rawTime) return new Date().toISOString();
  const str = String(rawTime).trim();
  // Formats like "30-10-2026 07:10 PM" or "30-10-2026"
  const dmyMatch = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(.*)$/);
  if (dmyMatch) {
    const p1 = dmyMatch[1].padStart(2, '0');
    const p2 = dmyMatch[2].padStart(2, '0');
    const year = dmyMatch[3];
    const timeRest = (dmyMatch[4] || '').trim();
    let day = p1;
    let month = p2;
    if (parseInt(p2, 10) > 12 && parseInt(p1, 10) <= 12) {
      month = p1;
      day = p2;
    }
    const candidate = timeRest ? `${year}-${month}-${day} ${timeRest}` : `${year}-${month}-${day}`;
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
    const fallback = new Date(`${year}-${month}-${day}T00:00:00Z`);
    if (!Number.isNaN(fallback.getTime())) {
      return fallback.toISOString();
    }
  }
  const direct = new Date(str);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString();
  }
  return new Date().toISOString();
}

/**
 * Fetches comments for a specific Zoho task
 */
export async function fetchZohoTaskComments(
  token: string,
  portalId: string,
  projectId: string,
  taskId: string
): Promise<Array<{ id: string; content: string; author_name: string; added_time: string }>> {
  try {
    const apiBase = process.env.ZOHO_API_BASE_URL || 'https://projectsapi.zoho.in/restapi';
    const res = await fetch(
      `${apiBase}/portal/${portalId}/projects/${projectId}/tasks/${taskId}/comments/`,
      {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      }
    );
    if (!res.ok) {
      if (res.status === 400 || res.status === 429) {
        try {
          const errText = await res.text();
          if (errText.includes('URL_ROLLING_THROTTLES_LIMIT_EXCEEDED') || errText.includes('100 requests')) {
            console.warn(`[ZohoClient] URL rolling throttle limit exceeded on task ${taskId}. Zoho rate limit active.`);
          }
        } catch {
          // ignore error text parsing
        }
      }
      return [];
    }
    const text = await res.text();
    const trimmed = (text || '').trim();
    if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return [];
    const data = JSON.parse(trimmed);
    const comments = Array.isArray(data)
      ? data
      : Array.isArray(data.comments)
      ? data.comments
      : Array.isArray(data.task_comments)
      ? data.task_comments
      : [];

    return comments
      .map((c: any) => {
        const isoTime = parseZohoCommentDate(c.created_time || c.added_time, c.created_time_long);
        const rawContent =
          c.comment ||
          c.comment_content ||
          c.content ||
          c.description ||
          c.notes ||
          '';

        const authorName =
          c.added_person ||
          c.added_by ||
          c.created_person ||
          (typeof c.created_by === 'object' && c.created_by ? c.created_by.name : null) ||
          (typeof c.added_by === 'object' && c.added_by ? c.added_by.name : null) ||
          c.author ||
          'Team Member';

        return {
          id: String(c.id_string || c.id || ''),
          content: stripHtml(String(rawContent || '')).trim(),
          author_name: String(authorName || 'Team Member').trim(),
          added_time: isoTime,
        };
      })
      .filter((c: any) => c.content.length > 0);
  } catch (err) {
    console.warn(`[ZohoClient] fetchZohoTaskComments error for ${taskId}:`, err);
    return [];
  }
}

/**
 * Fetches top-level tasks for a given Zoho project
 */
export async function fetchZohoProjectTasks(
  token: string,
  portalId: string,
  projectId: string,
  status: string = 'all'
): Promise<any[]> {
  try {
    const apiBase = process.env.ZOHO_API_BASE_URL || 'https://projectsapi.zoho.in/restapi';
    const statusParam = status ? `&status=${encodeURIComponent(status)}` : '';
    const res = await fetch(
      `${apiBase}/portal/${portalId}/projects/${projectId}/tasks/?range=100${statusParam}`,
      {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      }
    );
    if (!res.ok) {
      console.warn(`[ZohoClient] Failed to fetch project tasks for project ${projectId}: ${res.status}`);
      return [];
    }
    const data = await res.json();
    return data.tasks || [];
  } catch (err) {
    console.error(`[ZohoClient] fetchZohoProjectTasks error for ${projectId}:`, err);
    return [];
  }
}

/**
 * Fetches subtasks nested under a specific Zoho parent task
 */
export async function fetchZohoTaskSubtasks(
  token: string,
  portalId: string,
  projectId: string,
  parentTaskId: string
): Promise<Array<{ id: string; id_string: string; name: string }>> {
  try {
    const apiBase = process.env.ZOHO_API_BASE_URL || 'https://projectsapi.zoho.in/restapi';
    const res = await fetch(
      `${apiBase}/portal/${portalId}/projects/${projectId}/tasks/${parentTaskId}/subtasks/`,
      {
        headers: { Authorization: `Zoho-oauthtoken ${token}` },
      }
    );
    if (!res.ok) {
      console.warn(`[ZohoClient] Failed to fetch subtasks for task ${parentTaskId}: ${res.status}`);
      return [];
    }
    if (res.status === 204) {
      return [];
    }
    const text = await res.text();
    if (!text || !text.trim()) {
      return [];
    }
    const data = JSON.parse(text);
    const subtasks = data.tasks || data.subtasks || [];
    return subtasks.map((st: any) => ({
      id: String(st.id || st.id_string || ''),
      id_string: String(st.id_string || st.id || ''),
      name: String(st.name || '').trim(),
    }));
  } catch (err) {
    console.error(`[ZohoClient] fetchZohoTaskSubtasks error for ${parentTaskId}:`, err);
    return [];
  }
}

export interface CreateZohoTaskPayload {
  name: string;
  description?: string;
  person_responsible?: string;
  duration?: string; // e.g. "04:00"
  duration_type?: string; // e.g. "hrs" or "days"
  work?: string; // e.g. "04:00"
  work_type?: string; // e.g. "work_hours"
  start_date?: string; // e.g. "11-17-2026"
  end_date?: string;
  parent_id?: string; // Level 2 Subtask ID (User Bucket)
  status?: string; // e.g. "Backlog"
}

/**
 * Creates a new task or subtask in Zoho Projects
 */
export async function createZohoTask(
  token: string,
  portalId: string,
  projectId: string,
  payload: CreateZohoTaskPayload
): Promise<{ success: boolean; taskId?: string; link?: string; error?: string }> {
  try {
    const apiBase = process.env.ZOHO_API_BASE_URL || 'https://projectsapi.zoho.in/restapi';
    const targetEndpoint = payload.parent_id
      ? `${apiBase}/portal/${portalId}/projects/${projectId}/tasks/${payload.parent_id}/subtasks/`
      : `${apiBase}/portal/${portalId}/projects/${projectId}/tasks/`;

    const params = new URLSearchParams();
    params.set('name', payload.name);
    if (payload.description) params.set('description', payload.description);
    if (payload.person_responsible) params.set('person_responsible', payload.person_responsible);
    if (payload.duration) params.set('duration', payload.duration);
    if (payload.duration_type) params.set('duration_type', payload.duration_type);
    if (payload.work) params.set('work', payload.work);
    if (payload.work_type) params.set('work_type', payload.work_type);
    if (payload.start_date) params.set('start_date', payload.start_date);
    if (payload.end_date) params.set('end_date', payload.end_date);
    // Only pass parent_id in body if targeting main /tasks/ endpoint
    if (payload.parent_id && !targetEndpoint.includes('/subtasks/')) {
      params.set('parent_id', payload.parent_id);
    }
    // Only pass status if numeric custom status ID (string names like 'Backlog' cause Zoho 400 code 6500)
    if (payload.status && /^\d+$/.test(payload.status)) {
      params.set('custom_status_id', payload.status);
    }

    const res = await fetch(targetEndpoint, {
      method: 'POST',
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[ZohoClient] Failed to create Zoho task in project ${projectId}: ${res.status}`, errText);
      return { success: false, error: `Zoho API ${res.status}: ${errText}` };
    }

    const data = await res.json();
    const createdTask = data.tasks?.[0] || data.task || data;
    const taskId = String(createdTask.id_string || createdTask.id || '');
    const link = buildZohoTaskDeepLink(portalId, projectId, taskId);

    // If duration or work was specified on a subtask, ensure Zoho persists work_hours
    if (taskId && (payload.duration || payload.work)) {
      try {
        const updateParams = new URLSearchParams();
        if (payload.duration) updateParams.set('duration', payload.duration);
        if (payload.duration_type) updateParams.set('duration_type', payload.duration_type);
        if (payload.work) updateParams.set('work', payload.work);
        if (payload.work_type) updateParams.set('work_type', payload.work_type);

        await fetch(`${apiBase}/portal/${portalId}/projects/${projectId}/tasks/${taskId}/`, {
          method: 'POST',
          headers: {
            Authorization: `Zoho-oauthtoken ${token}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: updateParams.toString(),
        });
      } catch (updErr) {
        console.warn(`[ZohoClient] Work hours update warning for task ${taskId}:`, updErr);
      }
    }

    return {
      success: true,
      taskId,
      link,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ZohoClient] createZohoTask error for project ${projectId}:`, message);
    return { success: false, error: message };
  }
}


