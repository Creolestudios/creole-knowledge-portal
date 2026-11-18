import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  getZohoAccessToken,
  fetchZohoPortalProjects,
  fetchZohoUserProjects,
  fetchZohoPortalUsers,
} from '@/lib/zoho/client';
import {
  getUserCachedProjects,
  setUserCachedProjects,
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

    const cached = getUserCachedProjects(user.id);
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
      // 1. Resolve developer's Zoho User ID to fetch only projects assigned to them
      let zohoUserId: string | undefined;
      const { data: mapping } = await supabase
        .from('zoho_user_mappings')
        .select('zoho_user_id')
        .eq('user_id', user.id)
        .single();

      if (mapping?.zoho_user_id) {
        zohoUserId = String(mapping.zoho_user_id);
      } else if (user.email) {
        const portalUsers = await fetchZohoPortalUsers(token, portalId);
        if (Array.isArray(portalUsers)) {
          const userEmail = user.email.toLowerCase().trim();
          const matched = portalUsers.find(
            (u: any) => u.email && u.email.toLowerCase().trim() === userEmail
          );
          if (matched) {
            zohoUserId = String((matched as any).id_string || matched.id);
          }
        }
      }

      // 2. Fetch projects assigned to this user
      if (zohoUserId) {
        const userProjects = await fetchZohoUserProjects(token, portalId, zohoUserId);
        if (Array.isArray(userProjects) && userProjects.length > 0) {
          fetchedProjects = userProjects
            .filter((p) => p && p.name)
            .map((p) => ({
              id: String(p.id_string || p.id),
              name: p.name.trim(),
            }));
        }
      }

      // 3. Fallback to active portal projects if user has no assigned projects or mapping is missing
      if (fetchedProjects.length === 0) {
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
    }

    if (fetchedProjects.length === 0) {
      fetchedProjects = FALLBACK_PROJECTS;
    }

    setUserCachedProjects(user.id, fetchedProjects);

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
