import { supabaseAdmin } from '../supabase/admin';
import {
  getZohoAccessToken,
  fetchZohoPortalUsers,
  fetchZohoUserTasks,
  stripHtml,
  buildZohoTaskDeepLink,
  parseDurationToMinutes,
} from './client';
import {
  evaluateZohoTask,
  TaskEvaluationResult,
} from './evaluator';
import {
  ZohoUserSummary,
  ZohoTaskItem,
  DateFilterOptions,
  resolveDateFilterRange,
  formatDateYYYYMMDD,
  formatUserName,
  buildSampleUserSummary,
} from './service';

// In-memory cache for live synced data across requests
interface ZohoLiveCache {
  lastSyncedAt: string;
  users: ZohoUserSummary[];
}

let liveCache: ZohoLiveCache | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes cache

/**
 * Strips HTML entities from titles/descriptions
 */
function cleanText(str: string | null | undefined): string {
  if (!str) return '';
  return stripHtml(str);
}

/**
 * Synchronizes real-time tasks, descriptions, and hours from Zoho Projects
 * for all authenticated CKP users.
 */
export async function syncLiveZohoTasks(forceRefresh = false): Promise<{
  success: boolean;
  userCount: number;
  taskCount: number;
  lastSyncedAt: string;
  users: ZohoUserSummary[];
  error?: string;
}> {
  // Return cached result if still valid and forceRefresh is false
  if (
    !forceRefresh &&
    liveCache &&
    Date.now() - new Date(liveCache.lastSyncedAt).getTime() < CACHE_TTL_MS
  ) {
    const totalTasks = liveCache.users.reduce(
      (acc, u) => acc + u.dailyEvaluations.reduce((tAcc, d) => tAcc + d.tasks.length, 0),
      0
    );
    return {
      success: true,
      userCount: liveCache.users.length,
      taskCount: totalTasks,
      lastSyncedAt: liveCache.lastSyncedAt,
      users: liveCache.users,
    };
  }

  try {
    const portalId = process.env.ZOHO_PORTAL_ID || '60005825626';
    const token = await getZohoAccessToken();

    if (!token) {
      console.warn('[ZohoSync] Zoho access token unavailable. Falling back to local data.');
      return {
        success: false,
        userCount: 0,
        taskCount: 0,
        lastSyncedAt: new Date().toISOString(),
        users: liveCache?.users || [],
        error: 'Unable to acquire Zoho access token. Check credentials in .env.local.',
      };
    }

    // 1. Fetch Zoho Portal users
    const zohoUsers = await fetchZohoPortalUsers(token, portalId);

    // 2. Fetch CKP auth users and profiles
    const { data: authData } = await supabaseAdmin.auth.admin.listUsers();
    const ckpUsers = authData?.users?.filter((u) => u.last_sign_in_at != null) || [];

    const { data: profiles } = await supabaseAdmin.from('user_profiles').select('*');

    // Filter out admin users
    const nonAdminUsers = ckpUsers.filter((authUser) => {
      const email = (authUser.email || '').toLowerCase().trim();
      const profile = profiles?.find(
        (p) => p.user_id === authUser.id || (p.email && p.email.toLowerCase().trim() === email)
      );
      return profile?.role !== 'admin';
    });

    const syncedSummaries: ZohoUserSummary[] = [];
    let grandTotalTasks = 0;

    for (const authUser of nonAdminUsers) {
      const email = (authUser.email || '').toLowerCase().trim();
      const profile = profiles?.find(
        (p) => p.user_id === authUser.id || (p.email && p.email.toLowerCase().trim() === email)
      );
      const meta = (authUser.user_metadata as Record<string, unknown> | undefined) || {};
      const fullName = formatUserName(
        authUser.email || '',
        (meta.full_name as string) || (meta.name as string) || (profile?.name as string)
      );
      const userRole = (profile?.current_role as string) || 'Developer';
      const yearsOfExp = (profile?.years_of_experience as number) ?? 2;
      const seniorityLevel = yearsOfExp >= 5 ? 'Senior' : yearsOfExp >= 2 ? 'Mid' : 'Junior';
      const metaSubs = meta.ai_subscriptions as string[] | undefined;
      const aiSubscriptions =
        (profile?.ai_subscriptions as string[]) ||
        (Array.isArray(metaSubs) ? metaSubs : ['GitHub Copilot']);

      // Find matching Zoho user
      const matchedZohoUser = zohoUsers.find(
        (zu) => zu.email && zu.email.toLowerCase().trim() === email
      );

      if (matchedZohoUser) {
        // Fetch real-time tasks from Zoho
        const rawTasks = await fetchZohoUserTasks(token, portalId, matchedZohoUser.id, 50);

        const taskItems: ZohoTaskItem[] = [];
        let doneTasks = 0;
        let pendingTasks = 0;
        let delayedTasks = 0;
        let totalHoursLogged = 0;
        let scoreSum = 0;

        for (const raw of rawTasks) {
          const plannedMins = parseDurationToMinutes(raw.duration || raw.work || '4:00');
          const actualMins = parseDurationToMinutes(raw.work || raw.duration || '4:00');
          const plannedHours = Math.round((plannedMins / 60) * 100) / 100;
          const actualHours = Math.round((actualMins / 60) * 100) / 100;
          totalHoursLogged += actualHours;

          const statusName = raw.status?.name || 'In Progress';
          const statusLower = statusName.toLowerCase();
          const isDone =
            statusLower.includes('completed') ||
            statusLower.includes('closed') ||
            raw.completed === true;
          const isDelayed =
            statusLower.includes('delay') ||
            statusLower.includes('overdue') ||
            statusLower.includes('hold');

          if (isDone) doneTasks++;
          else pendingTasks++;
          if (isDelayed) delayedTasks++;

          const isQAReview =
            statusLower.includes('qa') ||
            statusLower.includes('review') ||
            (raw.name && raw.name.toLowerCase().includes('qa'));

          // Determine date in YYYY-MM-DD
          let taskDateStr = '';
          if (raw.created_time_long) {
            taskDateStr = formatDateYYYYMMDD(new Date(raw.created_time_long));
          } else if (raw.created_time) {
            // Zoho format often MM-DD-YYYY or DD-MM-YYYY
            const parts = raw.created_time.split('-');
            if (parts.length === 3) {
              // Assume MM-DD-YYYY or YYYY-MM-DD
              if (parts[0].length === 4) {
                taskDateStr = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
              } else {
                taskDateStr = `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
              }
            }
          }
          if (!taskDateStr) {
            taskDateStr = formatDateYYYYMMDD(new Date());
          }

          const taskName = cleanText(raw.name);
          const taskDescription = cleanText(raw.description || raw.name);
          const projectName = cleanText(raw.project?.name || 'General Project');
          const projectId = String(raw.project?.id_string || raw.project?.id || '0');
          const taskId = String(raw.id_string || raw.id || '0');

          // Run evaluation heuristics on live task (fast, deterministic heuristic mode for batch sync)
          const evalResult = await evaluateZohoTask({
            taskName,
            taskDescription,
            projectName,
            plannedMinutes: plannedMins || 240,
            actualMinutes: actualMins || 240,
            zohoStatus: statusName,
            isQAReview,
            comments: [
              `Task status: ${statusName}`,
              `Duration: ${raw.duration || 'N/A'}, Work hours: ${raw.work || 'N/A'}`,
            ],
            userExperienceYears: yearsOfExp,
            seniorityLevel,
            aiSubscriptions,
          }, { useAi: false });

          scoreSum += evalResult.overallScore;

          taskItems.push({
            id: `zoho-live-${taskId}`,
            zohoTaskId: taskId,
            projectId,
            projectName,
            taskName,
            taskDescription,
            zohoStatus: statusName,
            isQAReview,
            plannedHours,
            actualHours,
            taskDate: taskDateStr,
            zohoLink: buildZohoTaskDeepLink(portalId, projectId, taskId),
            comments: [
              {
                author: raw.created_person || fullName,
                content: `Logged: ${raw.work || raw.duration || 'hours'} | Status: ${statusName}`,
                time: raw.created_time_format || taskDateStr,
              },
            ],
            evaluation: evalResult,
          });
        }

        grandTotalTasks += taskItems.length;

        // Group tasks by date
        const dateGroups = new Map<string, ZohoTaskItem[]>();
        for (const item of taskItems) {
          if (!dateGroups.has(item.taskDate)) {
            dateGroups.set(item.taskDate, []);
          }
          dateGroups.get(item.taskDate)!.push(item);
        }

        const dailyEvaluations = Array.from(dateGroups.entries())
          .sort((a, b) => b[0].localeCompare(a[0])) // latest date first
          .map(([date, tList]) => {
            const dayScoreSum = tList.reduce((acc, t) => acc + (t.evaluation?.overallScore || 85), 0);
            return {
              date,
              dayScore: tList.length > 0 ? Math.round(dayScoreSum / tList.length) : 85,
              summary: `Completed ${tList.length} task(s) on ${date}.`,
              tasks: tList,
            };
          });

        const avgScore = taskItems.length > 0 ? Math.round(scoreSum / taskItems.length) : 85;

        syncedSummaries.push({
          userId: authUser.id,
          email: authUser.email || '',
          name: fullName,
          role: userRole,
          yearsOfExperience: yearsOfExp,
          seniorityLevel,
          aiSubscriptions,
          tillDateSummary: {
            doneTasks,
            pendingTasks,
            delayedTasks,
            weeklyAvgScore: avgScore,
            totalHoursLogged: Math.round(totalHoursLogged * 10) / 10,
          },
          dailyEvaluations,
        });
      } else {
        // User is a valid CKP login user but has no mapped Zoho account
        // Provide sample data so portal remains functional
        const sampleSummary = buildSampleUserSummary(
          authUser.id,
          authUser.email || '',
          fullName,
          userRole,
          yearsOfExp,
          seniorityLevel,
          aiSubscriptions,
          {
            start: formatDateYYYYMMDD(new Date(Date.now() - 7 * 86400000)),
            end: formatDateYYYYMMDD(new Date()),
          }
        );
        syncedSummaries.push(sampleSummary);
      }
    }

    const nowIso = new Date().toISOString();
    liveCache = {
      lastSyncedAt: nowIso,
      users: syncedSummaries,
    };

    return {
      success: true,
      userCount: syncedSummaries.length,
      taskCount: grandTotalTasks,
      lastSyncedAt: nowIso,
      users: syncedSummaries,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ZohoSync] Error syncing live tasks:', msg);
    return {
      success: false,
      userCount: liveCache?.users?.length || 0,
      taskCount: 0,
      lastSyncedAt: liveCache?.lastSyncedAt || new Date().toISOString(),
      users: liveCache?.users || [],
      error: msg,
    };
  }
}

/**
 * Returns filtered Zoho user summaries according to selected date criteria
 */
export async function getLiveZohoSummariesWithFilter(
  filter?: DateFilterOptions,
  forceRefresh = false
): Promise<{
  users: ZohoUserSummary[];
  lastSyncedAt: string;
  isLive: boolean;
}> {
  const syncResult = await syncLiveZohoTasks(forceRefresh);
  const rawUsers = syncResult.users;

  if (!filter) {
    return {
      users: rawUsers,
      lastSyncedAt: syncResult.lastSyncedAt,
      isLive: syncResult.success,
    };
  }

  const range = resolveDateFilterRange(filter);

  // Filter dailyEvaluations within range
  const filteredUsers = rawUsers.map((u) => {
    const inRangeDaily = u.dailyEvaluations.filter(
      (d) => d.date >= range.start && d.date <= range.end
    );

    // If there are tasks in range, recalculate scores for that period
    if (inRangeDaily.length > 0) {
      return {
        ...u,
        dailyEvaluations: inRangeDaily,
      };
    }

    // If no tasks fall in this range, return dailyEvaluations empty or latest
    return {
      ...u,
      dailyEvaluations: [],
    };
  });

  return {
    users: filteredUsers,
    lastSyncedAt: syncResult.lastSyncedAt,
    isLive: syncResult.success,
  };
}

/**
 * Handles incoming real-time Zoho Projects webhook payload
 */
export async function processZohoWebhookTask(payload: any): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    if (!payload) {
      return { success: false, message: 'Empty webhook payload' };
    }

    console.log('[ZohoWebhook] Received payload:', JSON.stringify(payload).slice(0, 300));

    // Force refresh next sync cycle
    liveCache = null;

    return {
      success: true,
      message: 'Task webhook processed. Live cache invalidated for immediate refresh.',
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: msg };
  }
}
