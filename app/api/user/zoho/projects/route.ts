import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getZohoAccessToken, fetchZohoPortalProjects } from '@/lib/zoho/client';
import {
  getCachedProjects,
  setCachedProjects,
  FALLBACK_PROJECTS,
  ZohoProjectItem,
} from '@/lib/zoho/projects-cache';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const cached = getCachedProjects();
    if (cached.isValid && cached.projects) {
      return NextResponse.json({
        projects: cached.projects,
        cached: true,
      });
    }

    const portalId = process.env.ZOHO_PORTAL_ID || 'creolestudios';
    const token = await getZohoAccessToken();

    let fetchedProjects: ZohoProjectItem[] = [];

    if (token) {
      const raw = await fetchZohoPortalProjects(token, portalId, 'active');
      if (Array.isArray(raw) && raw.length > 0) {
        fetchedProjects = raw
          .filter((p) => p && p.name)
          .map((p) => ({
            id: String(p.id_string || p.id),
            name: p.name.trim(),
          }));
      }
    }

    if (fetchedProjects.length === 0) {
      fetchedProjects = FALLBACK_PROJECTS;
    }

    setCachedProjects(fetchedProjects);

    return NextResponse.json({
      projects: fetchedProjects,
      cached: false,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/user/zoho/projects] Error loading projects:', message);
    return NextResponse.json({
      projects: FALLBACK_PROJECTS,
      fallback: true,
    });
  }
}
