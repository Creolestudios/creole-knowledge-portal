import { supabaseAdmin } from '../supabase/admin';
import {
  getZohoAccessToken,
  fetchZohoProjectTasks,
  fetchZohoTaskSubtasks,
  fetchZohoPortalUsers,
  createZohoTask,
  formatZohoDurationToClock,
  formatMinutesToHHMM,
  parseDurationToMinutes,
} from './client';

export interface PlannedTaskSyncResult {
  totalQueued: number;
  syncedCount: number;
  failedCount: number;
  skippedCount: number;
  adminEmailSent?: boolean;
  adminEmailRecipients?: number;
  details: Array<{
    taskId: string;
    taskName: string;
    userName: string;
    zohoTaskId?: string;
    status: 'synced' | 'failed' | 'skipped';
    error?: string;
  }>;
}

export interface ProjectHierarchyContext {
  mainTaskId?: string;
  mainTaskName?: string;
  adminId?: string;
  placeholderTaskId?: string;
  userBuckets: Array<{ id: string; id_string: string; name: string }>;
}

/**
 * Checks if a task/subtask name matches the Level 2 Admin Placeholder container pattern
 */
export function isPlaceholderTaskName(name: string): boolean {
  if (!name) return false;
  const clean = name.trim().toLowerCase();
  return (
    clean.startsWith('placeholder task') ||
    clean.startsWith('planned tasks') ||
    clean.includes('placeholder') ||
    clean.includes('tasks container') ||
    clean.includes('planned container')
  );
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
 * Finds the active weekly parent task (Level 1) for a project:
 * - If targetWeekNumber is provided (e.g. for Monday / active sprint week):
 *   STRICTLY finds the parent task matching W{targetWeekNumber}.
 *   Never falls back to older weeks (e.g. never attaches W47 tasks to W46).
 * - If no targetWeekNumber is provided, picks the open task with the highest week number.
 */
export function findLatestActiveWeeklyTask(
  projectTasks: any[],
  targetWeekNumber?: number
): any | null {
  if (!projectTasks || projectTasks.length === 0) return null;

  const parseTime = (t: any): number => {
    if (!t) return 0;
    const timeVal = t.created_time || t.created_date || t.created_time_long || t.created_time_format;
    if (typeof timeVal === 'number') return timeVal;
    if (typeof timeVal === 'string') {
      const parsed = Date.parse(timeVal);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return 0;
  };

  const isClosed = (task: any): boolean => {
    const statusName = String(task.status?.name || task.status || '').toLowerCase().trim();
    return statusName === 'closed' || statusName === 'completed';
  };

  const parseWeekNumber = (name: string): number => {
    const match = String(name || '').match(/\bW\s*-?\s*(\d+)\b/i);
    return match ? parseInt(match[1], 10) : 0;
  };

  // 1. Strict Target Week Matching (specifically for Monday / active sprint week):
  // When targetWeekNumber is provided, ONLY match parent tasks for this exact week.
  // Never fall back to older weeks (e.g. do not attach W47 tasks to W46).
  if (targetWeekNumber) {
    const targetWeekTasks = projectTasks.filter((pt: any) => {
      const weekNum = parseWeekNumber(pt.name);
      return weekNum === targetWeekNumber && !isClosed(pt);
    });

    if (targetWeekTasks.length > 0) {
      targetWeekTasks.sort((a: any, b: any) => parseTime(b) - parseTime(a));
      return targetWeekTasks[0];
    }

    // Do NOT fall back to older weeks!
    return null;
  }

  // 2. Generic fallback only when NO targetWeekNumber is passed:
  const openWeeklyTasks = projectTasks.filter((pt: any) => {
    const weekNum = parseWeekNumber(pt.name);
    return weekNum > 0 && !isClosed(pt);
  });

  if (openWeeklyTasks.length > 0) {
    // Sort by highest week number descending (e.g. W47 > W46), tie-breaking by created_time descending
    openWeeklyTasks.sort((a: any, b: any) => {
      const weekA = parseWeekNumber(a.name);
      const weekB = parseWeekNumber(b.name);
      if (weekB !== weekA) return weekB - weekA;
      return parseTime(b) - parseTime(a);
    });
    return openWeeklyTasks[0];
  }

  return null;
}

/**
 * Parses all user names and hours specified in the parent task title.
 * Examples:
 * - "W47 - Sample tasks added by CKP by individual users - 20 hours (Srushti 14, Priya 6)"
 *   -> [{ name: 'Srushti', hours: 14 }, { name: 'Priya', hours: 6 }]
 * - "W46 - Zoho task analyzing automation - 50 hours (srushti 40, priya 16)"
 *   -> [{ name: 'Srushti', hours: 40 }, { name: 'Priya', hours: 16 }]
 */
export function parseAllUserBucketsFromTitle(parentTitle: string): Array<{ name: string; hours: number }> {
  if (!parentTitle) return [];
  const results: Array<{ name: string; hours: number }> = [];

  const parenMatch = parentTitle.match(/\(([^)]+)\)/);
  if (parenMatch && parenMatch[1]) {
    const pairs = parenMatch[1].split(',');
    for (const pair of pairs) {
      const match = pair.trim().match(/^([A-Za-z]+)[:\s-]+(\d+(?:\.\d+)?)/);
      if (match) {
        const rawName = match[1].trim();
        const capitalName = rawName.charAt(0).toUpperCase() + rawName.slice(1).toLowerCase();
        const hours = Math.round(parseFloat(match[2]));
        if (!Number.isNaN(hours) && hours > 0) {
          results.push({ name: capitalName, hours });
        }
      }
    }
  }

  return results;
}

/**
 * Resolves allocated weekly hours for a specific developer from the Level 1 parent task title.
 * Examples:
 * - "W46 - Zoho task analyzing automation - 50 hours (srushti 40, priya 16)" -> srushti: 40, priya: 16
 * - "W47 - Solar CRM - 32 hours" -> 32
 * - "W47 - Solar CRM" -> defaults to 40
 */
export function resolveAllocatedHoursFromTitle(parentTitle: string, userFirstName: string): number {
  if (!parentTitle || !userFirstName) return 40;

  const cleanTitle = parentTitle.toLowerCase();
  const cleanUser = userFirstName.trim().toLowerCase();

  // Escape special regex characters in username
  const escapedUser = cleanUser.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // 1. Check for specific user mention with hours:
  // e.g. "(srushti 40, priya 16)" or "srushti: 40" or "srushti - 40"
  const userPattern = new RegExp(`\\b${escapedUser}[:\\s-]+(\\d+(?:\\.\\d+)?)\\b`, 'i');
  const userMatch = cleanTitle.match(userPattern);
  if (userMatch && userMatch[1]) {
    const val = parseFloat(userMatch[1]);
    if (!Number.isNaN(val) && val > 0) {
      return Math.round(val);
    }
  }

  // 2. Check for general hours: e.g. "40 hours", "32 hrs"
  const generalMatch = cleanTitle.match(/\b(\d+(?:\.\d+)?)\s*(?:hrs?|hours?)\b/i);
  if (generalMatch && generalMatch[1]) {
    const val = parseFloat(generalMatch[1]);
    if (!Number.isNaN(val) && val > 0) {
      // If team total is <= 40, use it. If > 40 (team total like 50 hours), cap individual dev at 40
      return Math.round(val <= 40 ? val : 40);
    }
  }

  // 3. Fallback standard allocation
  return 40;
}

/**
 * Resolves the matching Level 3 subtask bucket under the Level 2 Placeholder Task
 * (e.g. matches "srushti" to "srushti 10" or "Srushti: 14 hours", or falls back to "others 20")
 */
export function resolveUserSubtaskBucket(
  subtasks: Array<{ id: string; id_string: string; name: string }>,
  userFirstName: string
): { id: string; name: string; isFallback: boolean } | null {
  if (!subtasks || subtasks.length === 0) return null;

  const cleanUser = userFirstName.trim().toLowerCase();

  // 1. Direct user match: subtask name starts with user's first name (e.g., "srushti 10" or "srushti: 14 hours")
  const namedSubtask = subtasks.find((sub) => {
    const cleanName = sub.name.trim().toLowerCase();
    return (
      cleanName.startsWith(cleanUser + ' ') ||
      cleanName.startsWith(cleanUser + ':') ||
      cleanName === cleanUser
    );
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
  targetDate: string = '2026-11-17',
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

  // 1. Fetch queued planned tasks (targetDate commented out for testing as requested)
  let queuedTasks: any[] | null = null;
  const { data: primaryData, error: dbErr } = await supabaseAdmin
    .from('zoho_tasks')
    .select('id, user_id, zoho_project_id, project_name, task_name, task_description, planned_hours, task_date, sync_status')
    // .eq('task_date', targetDate) // Commented out for testing
    .eq('sync_status', 'queued');

  if (dbErr) {
    if (dbErr.code === '42703' || dbErr.message?.includes('sync_status')) {
      console.warn('[planned-task-sync] sync_status column not yet migrated, falling back to zoho_status = Planned');
      const { data: fallbackData, error: fallbackErr } = await supabaseAdmin
        .from('zoho_tasks')
        .select('id, user_id, zoho_project_id, project_name, task_name, task_description, planned_hours, task_date, zoho_task_id')
        // .eq('task_date', targetDate) // Commented out for testing
        .eq('zoho_status', 'Planned');

      if (fallbackErr) {
        console.error('[planned-task-sync] Fallback DB fetch error:', fallbackErr);
        return result;
      }
      // Filter out tasks that have already been synced with real Zoho task IDs
      queuedTasks = (fallbackData || []).filter((t: any) =>
        !t.zoho_task_id || t.zoho_task_id.startsWith('temp_')
      );
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

  // 3. Cache weekly container hierarchy per project to avoid repetitive API hits
  const weekNumber = getISOWeekNumber(targetDate);
  const weekPrefix = `W${weekNumber}`; // e.g. "W47"
  const projectHierarchyCache: Record<string, ProjectHierarchyContext> = {};

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

      // 3.2 Fetch or build 4-Tier Hierarchy:
      // Level 1: Weekly Main Task (W{Week}...)
      // Level 2: Admin Placeholder Task (Status: Backlog, Assigned to Admin, never modified by user/cron)
      // Level 3: User Subtask Bucket (Remaining Unassigned)
      if (!projectHierarchyCache[projectId] && token) {
        const projectTasks = await fetchZohoProjectTasks(token, portalId, projectId);
        const weeklyMain = findLatestActiveWeeklyTask(projectTasks, weekNumber);

        if (weeklyMain) {
          const mainTaskId = String(weeklyMain.id_string || weeklyMain.id);
          const adminId = String(
            weeklyMain.details?.owners?.[0]?.id ||
            weeklyMain.created_person?.id ||
            weeklyMain.owner_id ||
            weeklyMain.created_by ||
            weeklyMain.person_responsible ||
            process.env.ZOHO_DEFAULT_ADMIN_USER_ID ||
            ''
          );

          // Extract the active sprint week number directly from the parent task's title (e.g. "W46" or "W47")
          const parentWeekMatch = String(weeklyMain.name || '').match(/\bW\s*-?\s*(\d+)\b/i);
          const activeWeekNumber = parentWeekMatch ? parseInt(parentWeekMatch[1], 10) : weekNumber;
          const activeWeekPrefix = `W${activeWeekNumber}`;
          const placeholderTaskName = `Week ${activeWeekNumber} - Placeholder Task`;

          // Level 2: Fetch subtasks under Level 1 Weekly Main Task to find or create Placeholder Task
          const l1Subtasks = await fetchZohoTaskSubtasks(token, portalId, projectId, mainTaskId);
          let placeholder = l1Subtasks.find((st: any) => isPlaceholderTaskName(st.name));
          let placeholderTaskId = placeholder ? String(placeholder.id_string || placeholder.id) : undefined;

          if (!placeholderTaskId && !dryRun) {
            // Create Level 2 Placeholder Task directly under Level 1 Main Task (same tier/priority as developer subtask buckets, strictly Unassigned)
            const placeholderRes = await createZohoTask(token, portalId, projectId, {
              name: placeholderTaskName,
              parent_id: mainTaskId,
              unassigned: true,
            });
            if (placeholderRes.success && placeholderRes.taskId) {
              placeholderTaskId = placeholderRes.taskId;
              l1Subtasks.push({
                id: placeholderRes.taskId,
                id_string: placeholderRes.taskId,
                name: placeholderTaskName,
              });
            }
          }

          // Pre-create subtasks for ALL users mentioned in parent title directly under mainTaskId (along with Placeholder)
          const parsedUsers = parseAllUserBucketsFromTitle(String(weeklyMain.name || ''));
          for (const u of parsedUsers) {
            const exists = l1Subtasks.some((st: any) => {
              const clean = st.name.trim().toLowerCase();
              return (
                clean.startsWith(u.name.toLowerCase() + ' ') ||
                clean.startsWith(u.name.toLowerCase() + ':') ||
                clean === u.name.toLowerCase()
              );
            });

            if (!exists && !dryRun) {
              const userBucketRes = await createZohoTask(token, portalId, projectId, {
                name: `${u.name} ${u.hours}`,
                parent_id: mainTaskId, // Direct subtask of Level 1 parent, sibling to placeholder!
                unassigned: true,
              });
              if (userBucketRes.success && userBucketRes.taskId) {
                l1Subtasks.push({
                  id: userBucketRes.taskId,
                  id_string: userBucketRes.taskId,
                  name: `${u.name} ${u.hours}`,
                });
              }
            }
          }

          // User buckets are the developer subtasks directly under mainTaskId (excluding placeholder)
          const userBuckets = l1Subtasks.filter((st: any) => !isPlaceholderTaskName(st.name));

          projectHierarchyCache[projectId] = {
            mainTaskId,
            mainTaskName: String(weeklyMain.name || ''),
            adminId,
            placeholderTaskId,
            userBuckets,
          };
        } else {
          projectHierarchyCache[projectId] = {
            userBuckets: [],
          };
        }
      }

      const hierarchy = projectHierarchyCache[projectId] || { userBuckets: [] };
      const mainTaskId = hierarchy.mainTaskId;
      const placeholderTaskId = hierarchy.placeholderTaskId;

      // If Level 1 weekly parent task was not found for the target week, do NOT create orphaned tasks
      // or attach to older weeks as fallback. Keep tasks queued in CKP.
      if (!mainTaskId && !dryRun) {
        console.warn(`[planned-task-sync] No weekly parent task found for week ${weekNumber} in project ${projectId}. Keeping task queued without fallback.`);
        result.skippedCount++;
        result.details.push({
          taskId: task.id,
          taskName: task.task_name,
          userName: userFirstName,
          status: 'skipped',
          error: `Parent task W${weekNumber} not found in project ${projectId}. Kept queued without fallback.`,
        });
        continue;
      }

      // Find or create User Subtask directly under Level 1 Main Task (along with Placeholder)
      let bucket = resolveUserSubtaskBucket(hierarchy.userBuckets, userFirstName);

      if (!bucket && mainTaskId && !dryRun) {
        const capitalUser = userFirstName.charAt(0).toUpperCase() + userFirstName.slice(1);
        const allocatedHours = resolveAllocatedHoursFromTitle(
          hierarchy.mainTaskName || '',
          userFirstName
        );
        const bucketName = `${capitalUser} ${allocatedHours}`;

        // Create User Subtask directly under Level 1 Main Task (along with Placeholder)
        // Note: person_responsible is strictly omitted so it remains UNASSIGNED
        const bucketRes = await createZohoTask(token!, portalId, projectId, {
          name: bucketName,
          parent_id: mainTaskId,
          unassigned: true,
        });

        if (bucketRes.success && bucketRes.taskId) {
          bucket = {
            id: bucketRes.taskId,
            name: bucketName,
            isFallback: false,
          };
          hierarchy.userBuckets.push({
            id: bucketRes.taskId,
            id_string: bucketRes.taskId,
            name: bucketName,
          });
        }
      }

      // Determine parent for the Work Task: directly under user bucket!
      const workTaskParentId = bucket?.id || hierarchy.mainTaskId;

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

      // 3.3 Create Level 4 Work Task in Zoho Projects under the Level 3 User Subtask
      // Note: start_date and end_date are intentionally omitted so they remain unset ("-") in Zoho Projects
      const hoursNum = Number(task.planned_hours) || 4;
      const formattedClock = formatZohoDurationToClock(task.planned_hours);
      const totalMinutes = parseDurationToMinutes(task.planned_hours);
      const formattedHHMM = formatMinutesToHHMM(totalMinutes);
      const durationLabel =
        hoursNum % 1 === 0 || (hoursNum * 10) % 1 === 0
          ? `${hoursNum.toFixed(1)} hrs`
          : `${formattedClock} hrs`;
      const taskNameWithHours = `${task.task_name} [${durationLabel}]`;

      const ownerWorkPayload = zohoUserId
        ? JSON.stringify([{ user_id: String(zohoUserId), working_hours: formattedClock }])
        : undefined;

      const createRes = await createZohoTask(token!, portalId, projectId, {
        name: taskNameWithHours,
        description: task.task_description || undefined,
        person_responsible: zohoUserId || undefined,
        duration: formattedHHMM,
        duration_type: 'hrs',
        work: formattedHHMM,
        work_type: 'work_hours',
        owner_work: ownerWorkPayload,
        parent_id: workTaskParentId,
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
            planned_placeholder_task_id: placeholderTaskId,
            sync_status: 'synced',
          })
          .eq('id', task.id);

        if (
          updErr &&
          (updErr.code === '42703' ||
            updErr.message?.includes('sync_status') ||
            updErr.message?.includes('planned_placeholder_task_id'))
        ) {
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

  // 4. Dispatch Morning 8:45 AM Planned Tasks Summary Email to Admins
  try {
    const adminEmailRes = await dispatchPlannedTasksAdminEmail(targetDate, { dryRun });
    result.adminEmailSent = adminEmailRes.success;
    result.adminEmailRecipients = adminEmailRes.recipientCount;
  } catch (emailErr) {
    console.warn('[planned-task-sync] Admin email dispatch warning:', emailErr);
  }

  return result;
}

/**
 * Compiles and dispatches the Morning 8:45 AM Planned Tasks Summary Email to Administrators.
 * Displays strictly 2 columns: User Name and Task Count (includes active users with 0 tasks).
 */
export async function dispatchPlannedTasksAdminEmail(
  targetDate: string,
  options?: { dryRun?: boolean }
): Promise<{ success: boolean; recipientCount: number; error?: string }> {
  try {
    // 1. Fetch admin digest recipients
    const { getDigestRecipientEmails } = await import('./digest-recipients-store');
    const adminEmails = await getDigestRecipientEmails();
    if (!adminEmails || adminEmails.length === 0) {
      console.log('[planned-task-sync] No admin digest recipients found. Skipping email.');
      return { success: false, recipientCount: 0, error: 'No admin recipients configured' };
    }

    // 2. Fetch all active non-admin developers
    const { data: profiles } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, name, email, role');

    const nonAdminProfiles = (profiles || []).filter(
      (p: any) => p && p.role !== 'admin' && (p.name || p.email)
    );

    let activeUsers: Array<{ userId: string; name: string }> = [];

    if (nonAdminProfiles.length > 0) {
      activeUsers = nonAdminProfiles.map((p: any) => ({
        userId: String(p.user_id || p.email),
        name: String(p.name || p.email?.split('@')[0] || 'Developer'),
      }));
    } else {
      const { data: mappings } = await supabaseAdmin
        .from('zoho_user_mappings')
        .select('user_id, zoho_user_email, first_name');
      if (mappings && mappings.length > 0) {
        activeUsers = mappings.map((m: any) => ({
          userId: String(m.user_id),
          name: String(m.first_name || m.zoho_user_email?.split('@')[0] || 'Developer'),
        }));
      }
    }

    // 3. Query all planned tasks for this targetDate
    let tasksForDate: any[] = [];
    const { data: plannedData, error: plannedErr } = await supabaseAdmin
      .from('zoho_planned_tasks')
      .select('id, user_id, task_name')
      .eq('task_date', targetDate);

    if (!plannedErr && Array.isArray(plannedData)) {
      tasksForDate = plannedData;
    } else {
      const { data: fallbackTasks } = await supabaseAdmin
        .from('zoho_tasks')
        .select('id, user_id, task_name')
        .eq('task_date', targetDate);
      tasksForDate = fallbackTasks || [];
    }

    // 4. Map task counts per user (guaranteeing 0 if user has no tasks)
    const taskCountMap: Record<string, number> = {};
    for (const t of tasksForDate) {
      const uid = String(t.user_id || '');
      taskCountMap[uid] = (taskCountMap[uid] || 0) + 1;
    }

    // If activeUsers is still empty (e.g. test environment with only tasks), derive from tasks
    if (activeUsers.length === 0 && tasksForDate.length > 0) {
      const uniqueUids = Array.from(new Set(tasksForDate.map(t => String(t.user_id))));
      activeUsers = uniqueUids.map(uid => ({
        userId: uid,
        name: `Developer (${uid.slice(0, 6)})`,
      }));
    }

    const userRows = activeUsers.map(user => {
      const count = taskCountMap[user.userId] || 0;
      return {
        userId: user.userId,
        userName: user.name,
        taskCount: count,
      };
    });

    // Sort: users with tasks first, descending by count, then alphabetically
    userRows.sort((a, b) => {
      if (b.taskCount !== a.taskCount) return b.taskCount - a.taskCount;
      return a.userName.localeCompare(b.userName);
    });

    const totalTasks = tasksForDate.length;
    const totalUsers = userRows.length;
    const zeroCountUsers = userRows.filter(u => u.taskCount === 0).length;

    const payload = {
      date: targetDate,
      totalTasks,
      totalUsers,
      zeroCountUsers,
      users: userRows,
      portalUrl: process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    };

    const { sendPlannedTasksAdminEmail } = await import('../email/service');
    const emailResult = await sendPlannedTasksAdminEmail({
      to: adminEmails,
      payload,
      dryRun: options?.dryRun,
    });

    return emailResult;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[planned-task-sync] Error dispatching planned tasks admin email:', message);
    return { success: false, recipientCount: 0, error: message };
  }
}

