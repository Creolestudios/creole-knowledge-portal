import { supabaseAdmin } from '../supabase/admin';
import {
  getZohoAccessToken,
  fetchZohoProjectTasks,
  fetchZohoTaskSubtasks,
  fetchZohoPortalUsers,
  createZohoTask,
  formatZohoDurationToClock,
} from './client';

export interface PlannedTaskSyncResult {
  totalQueued: number;
  syncedCount: number;
  failedCount: number;
  skippedCount: number;
  details: Array<{
    taskId: string;
    taskName: string;
    userName: string;
    zohoTaskId?: string;
    status: 'synced' | 'failed' | 'skipped';
    error?: string;
  }>;
}

/**
 * Computes ISO week number for a given date string (YYYY-MM-DD)
 */
export function getISOWeekNumber(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1, d));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.getTime();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7));
  }
  return 1 + Math.ceil((firstThursday - target.getTime()) / 604800000);
}

/**
 * Resolves the matching Level 2 subtask bucket under the Weekly Main Task
 * (e.g. matches "srushti" to "srushti 10", or falls back to "others 20")
 */
export function resolveUserSubtaskBucket(
  subtasks: Array<{ id: string; id_string: string; name: string }>,
  userFirstName: string
): { id: string; name: string; isFallback: boolean } | null {
  if (!subtasks || subtasks.length === 0) return null;

  const cleanUser = userFirstName.trim().toLowerCase();

  // 1. Direct user match: subtask name starts with user's first name (e.g., "srushti 10")
  const namedSubtask = subtasks.find((sub) => {
    const cleanName = sub.name.trim().toLowerCase();
    return cleanName.startsWith(cleanUser + ' ') || cleanName === cleanUser;
  });

  if (namedSubtask) {
    return {
      id: namedSubtask.id_string || namedSubtask.id,
      name: namedSubtask.name,
      isFallback: false,
    };
  }

  // 2. Fallback match: "others" bucket (e.g., "others 20")
  const othersSubtask = subtasks.find((sub) =>
    sub.name.trim().toLowerCase().startsWith('others')
  );

  if (othersSubtask) {
    return {
      id: othersSubtask.id_string || othersSubtask.id,
      name: othersSubtask.name,
      isFallback: true,
    };
  }

  // 3. Fallback to first available subtask
  const first = subtasks[0];
  return {
    id: first.id_string || first.id,
    name: first.name,
    isFallback: true,
  };
}

/**
 * Formats YYYY-MM-DD into MM-DD-YYYY for Zoho REST API
 */
export function formatDateForZoho(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[1]}-${parts[2]}-${parts[0]}`;
  }
  return dateStr;
}

/**
 * Ingests queued planned tasks for a target date into Zoho Projects under Option B:
 * - Queries queued tasks from public.zoho_tasks
 * - Creates them in Zoho Projects under the active week's Level 2 subtask bucket
 * - Updates the SAME ROW in public.zoho_tasks with zoho_task_id, link, and sync_status = 'synced'
 */
export async function syncQueuedPlannedTasks(
  targetDate: string,
  options?: { dryRun?: boolean }
): Promise<PlannedTaskSyncResult> {
  const dryRun = options?.dryRun ?? false;
  const result: PlannedTaskSyncResult = {
    totalQueued: 0,
    syncedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    details: [],
  };

  // 1. Fetch queued planned tasks for targetDate
  let queuedTasks: any[] | null = null;
  const { data: primaryData, error: dbErr } = await supabaseAdmin
    .from('zoho_tasks')
    .select('id, user_id, zoho_project_id, project_name, task_name, task_description, planned_hours, task_date, sync_status')
    .eq('task_date', targetDate)
    .eq('sync_status', 'queued');

  if (dbErr) {
    if (dbErr.code === '42703' || dbErr.message?.includes('sync_status')) {
      console.warn('[planned-task-sync] sync_status column not yet migrated, falling back to zoho_status = Planned');
      const { data: fallbackData, error: fallbackErr } = await supabaseAdmin
        .from('zoho_tasks')
        .select('id, user_id, zoho_project_id, project_name, task_name, task_description, planned_hours, task_date')
        .eq('task_date', targetDate)
        .eq('zoho_status', 'Planned');

      if (fallbackErr) {
        console.error('[planned-task-sync] Fallback DB fetch error:', fallbackErr);
        return result;
      }
      queuedTasks = fallbackData;
    } else {
      console.error('[planned-task-sync] DB fetch error:', dbErr);
      return result;
    }
  } else {
    queuedTasks = primaryData;
  }

  if (!queuedTasks || queuedTasks.length === 0) {
    console.log(`[planned-task-sync] No queued planned tasks found for date ${targetDate}`);
    return result;
  }

  result.totalQueued = queuedTasks.length;
  console.log(`[planned-task-sync] Found ${queuedTasks.length} queued task(s) to sync for ${targetDate}`);

  // 2. Acquire Zoho API access token
  const portalId = process.env.ZOHO_PORTAL_ID || 'creolestudios';
  const token = await getZohoAccessToken();

  if (!token && !dryRun) {
    console.warn('[planned-task-sync] No Zoho token available. Skipping Zoho task creation.');
    return result;
  }

  // 3. Cache weekly container subtasks per project to avoid repetitive API hits
  const weekNumber = getISOWeekNumber(targetDate);
  const weekPrefix = `W${weekNumber}`; // e.g. "W47"
  const projectSubtasksCache: Record<string, Array<{ id: string; id_string: string; name: string }>> = {};

  for (const task of queuedTasks) {
    try {
      // 3.1 Fetch user Zoho mapping
      const { data: mapping } = await supabaseAdmin
        .from('zoho_user_mappings')
        .select('zoho_user_id, zoho_user_email')
        .eq('user_id', task.user_id)
        .single();

      let userEmail = mapping?.zoho_user_email || '';
      let zohoUserId = mapping?.zoho_user_id;

      // Auto-fallback: if mapping not yet populated, resolve via Zoho portal users list by email
      if (!zohoUserId && token) {
        try {
          const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(task.user_id);
          const email = authUser?.user?.email;
          if (email) {
            userEmail = email;
            const portalUsers = await fetchZohoPortalUsers(token, portalId);
            const matched = portalUsers.find(
              (u: any) => u.email && u.email.toLowerCase().trim() === email.toLowerCase().trim()
            );
            if (matched) {
              zohoUserId = String((matched as any).id_string || matched.id);
            }
          }
        } catch {
          // Continue with best-effort
        }
      }

      const userFirstName = userEmail ? (userEmail.split('@')[0].split('.')[0] || 'developer') : 'developer';

      const projectId = task.zoho_project_id || 'default_proj';

      // 3.2 Fetch or use cached Level 2 subtasks under the Weekly Main Task
      if (!projectSubtasksCache[projectId] && token) {
        const projectTasks = await fetchZohoProjectTasks(token, portalId, projectId);
        // Find task starting with W{week}
        const weeklyMain = projectTasks.find((pt: any) => {
          const cleanName = String(pt.name || '').trim().toUpperCase();
          return cleanName.startsWith(weekPrefix) || cleanName.startsWith(`W - ${weekNumber}`);
        });

        if (weeklyMain) {
          const mainTaskId = String(weeklyMain.id_string || weeklyMain.id);
          const subtasks = await fetchZohoTaskSubtasks(token, portalId, projectId, mainTaskId);
          projectSubtasksCache[projectId] = subtasks;
        } else {
          projectSubtasksCache[projectId] = [];
        }
      }

      const availableSubtasks = projectSubtasksCache[projectId] || [];
      const bucket = resolveUserSubtaskBucket(availableSubtasks, userFirstName);

      if (dryRun) {
        result.syncedCount++;
        result.details.push({
          taskId: task.id,
          taskName: task.task_name,
          userName: userFirstName,
          zohoTaskId: `mock_zoho_${Date.now()}`,
          status: 'synced',
        });
        continue;
      }

      // 3.3 Create task in Zoho Projects
      const zohoFormattedDate = formatDateForZoho(task.task_date);
      const formattedDuration = formatZohoDurationToClock(task.planned_hours);

      const taskNameWithHours = `${task.task_name} [${Number(task.planned_hours).toFixed(1)} hrs]`;

      const createRes = await createZohoTask(token!, portalId, projectId, {
        name: taskNameWithHours,
        description: task.task_description || undefined,
        person_responsible: zohoUserId || undefined,
        duration: formattedDuration,
        start_date: zohoFormattedDate,
        parent_id: bucket?.id,
      });

      if (createRes.success && createRes.taskId) {
        // 3.4 Update the SAME ROW in public.zoho_tasks (Option B: Single Table)
        const updatePayload: Record<string, any> = {
          zoho_task_id: createRes.taskId,
          zoho_link: createRes.link,
          zoho_status: 'Open',
        };
        const { error: updErr } = await supabaseAdmin
          .from('zoho_tasks')
          .update({
            ...updatePayload,
            planned_bucket_subtask_id: bucket?.id,
            sync_status: 'synced',
          })
          .eq('id', task.id);

        if (updErr && (updErr.code === '42703' || updErr.message?.includes('sync_status'))) {
          // Fallback update without new schema columns if migration not yet applied
          await supabaseAdmin
            .from('zoho_tasks')
            .update(updatePayload)
            .eq('id', task.id);
        }

        result.syncedCount++;
        result.details.push({
          taskId: task.id,
          taskName: task.task_name,
          userName: userFirstName,
          zohoTaskId: createRes.taskId,
          status: 'synced',
        });
      } else {
        // Mark failed
        const { error: failErr } = await supabaseAdmin
          .from('zoho_tasks')
          .update({
            sync_status: 'failed',
          })
          .eq('id', task.id);

        if (failErr && (failErr.code === '42703' || failErr.message?.includes('sync_status'))) {
          // No-op if column doesn't exist
        }

        result.failedCount++;
        result.details.push({
          taskId: task.id,
          taskName: task.task_name,
          userName: userFirstName,
          status: 'failed',
          error: createRes.error || 'Zoho task creation failed',
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[planned-task-sync] Error syncing task ${task.id}:`, message);
      result.failedCount++;
      result.details.push({
        taskId: task.id,
        taskName: task.task_name,
        userName: 'unknown',
        status: 'failed',
        error: message,
      });
    }
  }

  return result;
}

