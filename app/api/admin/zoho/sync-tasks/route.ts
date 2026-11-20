import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { syncQueuedPlannedTasks } from '@/lib/zoho/planned-task-sync';

export const runtime = 'nodejs';

/**
 * Helper to verify that current requester is an active Admin
 */
async function verifyAdminAuth() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { authorized: false, error: 'Unauthorized', status: 401 };
  }

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('role')
    .eq('user_id', user.id)
    .single();

  const role = (profile?.role || '').toLowerCase();
  if (role !== 'admin' && !role.includes('admin')) {
    return { authorized: false, error: 'Forbidden: Admin access required', status: 403 };
  }

  return { authorized: true, user };
}

/**
 * GET /api/admin/zoho/sync-tasks
 * Returns the count of queued tasks currently awaiting parent task creation in Zoho Projects
 */
export async function GET() {
  try {
    const auth = await verifyAdminAuth();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { count, error } = await supabaseAdmin
      .from('zoho_tasks')
      .select('id', { count: 'exact', head: true })
      .eq('sync_status', 'queued');

    if (error) {
      // Fallback check if sync_status is not yet populated
      const { data: fallbackTasks } = await supabaseAdmin
        .from('zoho_tasks')
        .select('id, zoho_task_id')
        .eq('zoho_status', 'Planned');

      const unsyncedCount = (fallbackTasks || []).filter(
        (t: any) => !t.zoho_task_id || String(t.zoho_task_id).startsWith('temp_')
      ).length;

      return NextResponse.json({ queuedCount: unsyncedCount });
    }

    return NextResponse.json({ queuedCount: count || 0 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/admin/zoho/sync-tasks
 * Manually executes planned task synchronization for queued tasks.
 * When the PM creates the week parent task in Zoho Projects, clicking this triggers
 * synchronization to Zoho under the parent task and dispatches the admin digest email.
 */
export async function POST(req: Request) {
  try {
    const auth = await verifyAdminAuth();
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    let targetDate = new Date().toISOString().split('T')[0];
    try {
      const body = await req.json();
      if (body?.taskDate) {
        targetDate = body.taskDate;
      }
    } catch {
      // No JSON body provided, fallback to today's date
    }

    const syncResult = await syncQueuedPlannedTasks(targetDate);

    let message = 'No queued tasks found for synchronization.';
    if (syncResult.syncedCount > 0) {
      message = `Successfully synchronized ${syncResult.syncedCount} queued task(s) to Zoho Projects under the active week parent task.`;
    } else if (syncResult.skippedCount > 0) {
      message = `Parent task not found in Zoho Projects for this week. ${syncResult.skippedCount} task(s) kept safely queued in CKP without fallback.`;
    }

    return NextResponse.json({
      success: true,
      syncedCount: syncResult.syncedCount,
      skippedCount: syncResult.skippedCount,
      failedCount: syncResult.failedCount,
      totalQueued: syncResult.totalQueued,
      adminEmailSent: syncResult.adminEmailSent,
      message,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[admin/zoho/sync-tasks/POST] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
