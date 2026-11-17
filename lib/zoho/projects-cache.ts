export interface ZohoProjectItem {
  id: string;
  name: string;
}

export const FALLBACK_PROJECTS: ZohoProjectItem[] = [
  { id: 'ckp_main', name: 'Creole Knowledge Portal' },
  { id: 'creole_web', name: 'Creole Website Revamp' },
  { id: 'mobile_app', name: 'Mobile App Development' },
  { id: 'ai_suite', name: 'Internal AI Automation Suite' },
  { id: 'client_portal', name: 'Client Portal Dashboard' },
];

let cachedProjects: ZohoProjectItem[] | null = null;
let cacheExpiry = 0;
const userProjectsCache: Record<string, { projects: ZohoProjectItem[]; expiry: number }> = {};

export function getCachedProjects(): { projects: ZohoProjectItem[] | null; isValid: boolean } {
  const now = Date.now();
  if (cachedProjects && cachedProjects.length > 0 && cacheExpiry > now) {
    return { projects: cachedProjects, isValid: true };
  }
  return { projects: null, isValid: false };
}

export function getUserCachedProjects(userId: string): { projects: ZohoProjectItem[] | null; isValid: boolean } {
  const now = Date.now();
  const entry = userProjectsCache[userId];
  if (entry && entry.projects.length > 0 && entry.expiry > now) {
    return { projects: entry.projects, isValid: true };
  }
  return { projects: null, isValid: false };
}

export function setCachedProjects(projects: ZohoProjectItem[], ttlMs = 1800000): void {
  cachedProjects = projects;
  cacheExpiry = Date.now() + ttlMs;
}

export function setUserCachedProjects(userId: string, projects: ZohoProjectItem[], ttlMs = 1800000): void {
  userProjectsCache[userId] = {
    projects,
    expiry: Date.now() + ttlMs,
  };
}

export function clearProjectsCacheForTesting(): void {
  cachedProjects = null;
  cacheExpiry = 0;
  for (const k of Object.keys(userProjectsCache)) {
    delete userProjectsCache[k];
  }
}

