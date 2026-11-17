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

export function getCachedProjects(): { projects: ZohoProjectItem[] | null; isValid: boolean } {
  const now = Date.now();
  if (cachedProjects && cachedProjects.length > 0 && cacheExpiry > now) {
    return { projects: cachedProjects, isValid: true };
  }
  return { projects: null, isValid: false };
}

export function setCachedProjects(projects: ZohoProjectItem[], ttlMs = 1800000): void {
  cachedProjects = projects;
  cacheExpiry = Date.now() + ttlMs;
}

export function clearProjectsCacheForTesting(): void {
  cachedProjects = null;
  cacheExpiry = 0;
}

