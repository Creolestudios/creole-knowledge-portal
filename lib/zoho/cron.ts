import { supabaseAdmin } from '../supabase/admin';
import {
  getZohoAccessToken,
  fetchZohoPortalUsers,
  fetchZohoUserTasks,
  fetchZohoTaskComments,
  fetchZohoTaskDetails,
  stripHtml,
  buildZohoTaskDeepLink,
  parseDurationToMinutes,
} from './client';
import { evaluateZohoTask } from './evaluator';
import { formatDateYYYYMMDD, formatUserName } from './service';
import { sendDailyEvaluationEmail } from '../email/service';
import type { TaskEmailItem, DailyEvaluationEmailPayload } from '../email/templates/daily-evaluation-email';

export interface UserEvaluationDetail {
  userEmail: string;
  userName: string;
  taskCount: number;
  commentCount: number;
  dailyScore: number;
  totalPlannedHours: number;
  totalActualHours: number;
  seniorEmails?: string[];
  emailDelivered?: boolean;
}

export interface DailyZohoEvaluationCronResult {
  success: boolean;
  date: string;
  dryRun: boolean;
  usersEvaluated: number;
  tasksEvaluated: number;
  commentsIngested: number;
  evaluationsCreated: number;
  emailsSent: number;
  emailsFailed: number;
  durationMs: number;
  error?: string;
  details: UserEvaluationDetail[];
  skipped?: boolean;
  skipReason?: string;
}

export interface DailyZohoEvaluationCronOptions {
  targetDate?: string;
  dryRun?: boolean;
  allowWeekend?: boolean;
  skipWeekend?: boolean;
}

/**
 * Strips HTML tags and entities from raw task text
 */
function cleanText(str: string | null | undefined): string {
  if (!str) return '';
  return stripHtml(str);
}

/**
 * Runs the dedicated daily 10 PM Zoho Evaluation Cron.
 * Monday to Friday only (skips Saturday and Sunday unless allowWeekend is true).
 *
 * Steps:
 * 1. Checks if current day is weekend (skips if Saturday/Sunday).
 * 2. Fetches all registered Zoho Portal users and maps them to CKP user profiles.
 * 3. For every user, gathers tasks active or logged for the specified date.
 * 4. For every task, fetches all comments and logged hours (strictly keeping 0 if unlogged).
 * 5. Runs the heuristic + AI task evaluation engine.
 * 6. Persists task records, comments, task evaluations, and daily summary rollups to Supabase.
 * 7. Dispatches evaluation email reports to users and seniors (if daily email is enabled).
 */
export async function runDailyZohoEvaluationCron(
  options?: DailyZohoEvaluationCronOptions
): Promise<DailyZohoEvaluationCronResult> {
  const startTime = Date.now();
  const dryRun = options?.dryRun ?? false;
  const targetDate = options?.targetDate || formatDateYYYYMMDD(new Date());

  // Skip weekends (Saturday and Sunday) by default
  if (!options?.allowWeekend) {
    const [y, m, d] = targetDate.split('-').map(Number);
    const dateObj = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    const dayOfWeek = dateObj.getUTCDay(); // 0 is Sunday, 6 is Saturday
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      const dayName = dayOfWeek === 0 ? 'Sunday' : 'Saturday';
      console.log(`[ZohoCron] Skipping daily evaluation: ${targetDate} is ${dayName} (weekend). Automated evaluations and emails run Monday to Friday only.`);
      return {
        success: true,
        date: targetDate,
        dryRun,
        usersEvaluated: 0,
        tasksEvaluated: 0,
        commentsIngested: 0,
        evaluationsCreated: 0,
        emailsSent: 0,
        emailsFailed: 0,
        durationMs: Date.now() - startTime,
        details: [],
        skipped: true,
        skipReason: `Weekend (${dayName}) - automated evaluations and emails only run Monday to Friday.`,
      };
    }
  }

  const details: UserEvaluationDetail[] = [];
  let totalTasksEvaluated = 0;
  let totalCommentsIngested = 0;
  let totalEvaluationsCreated = 0;
  let totalEmailsSent = 0;
  let totalEmailsFailed = 0;

  try {
    const portalId = process.env.ZOHO_PORTAL_ID || 'creolestudios';
    const token = await getZohoAccessToken();

    if (!token) {
      console.warn('[ZohoCron] Unable to acquire Zoho access token. Check credentials in .env.local.');
      return {
        success: false,
        date: targetDate,
        dryRun,
        usersEvaluated: 0,
        tasksEvaluated: 0,
        commentsIngested: 0,
        evaluationsCreated: 0,
        emailsSent: 0,
        emailsFailed: 0,
        durationMs: Date.now() - startTime,
        error: 'Unable to acquire Zoho access token. Check credentials in .env.local.',
        details: [],
      };
    }

    // 1. Fetch Zoho Portal users
    const zohoUsers = await fetchZohoPortalUsers(token, portalId);

    // 2. Fetch CKP auth users and profiles
    const { data: authData } = await supabaseAdmin.auth.admin.listUsers();
    const ckpUsers = authData?.users?.filter((u) => u.last_sign_in_at != null) || [];
    const { data: profiles } = await supabaseAdmin.from('user_profiles').select('*');

    // Filter out administrators from evaluation
    const nonAdminUsers = ckpUsers.filter((authUser) => {
      const email = (authUser.email || '').toLowerCase().trim();
      const profile = profiles?.find(
        (p) => p.user_id === authUser.id || (p.email && p.email.toLowerCase().trim() === email)
      );
      return profile?.role !== 'admin';
    });

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
      const yearsOfExp = (profile?.years_of_experience as number) ?? 2;
      const seniorityLevel = yearsOfExp >= 5 ? 'Senior' : yearsOfExp >= 2 ? 'Mid' : 'Junior';
      const metaSubs = meta.ai_subscriptions as string[] | undefined;
      const aiSubscriptions =
        (profile?.ai_subscriptions as string[]) ||
        (Array.isArray(metaSubs) ? metaSubs : ['GitHub Copilot']);
      const metaSenior = meta.senior_emails as string[] | undefined;
      const seniorEmails: string[] =
        (profile?.senior_emails as string[]) ||
        (Array.isArray(metaSenior) ? metaSenior : []);
      const metaDailyEmail = meta.daily_email_enabled as boolean | undefined;
      const dailyEmailEnabled =
        profile?.daily_email_enabled !== undefined
          ? Boolean(profile.daily_email_enabled)
          : metaDailyEmail !== undefined
          ? Boolean(metaDailyEmail)
          : true;

      // Find matching Zoho user
      const matchedZohoUser = zohoUsers.find(
        (zu) => zu.email && zu.email.toLowerCase().trim() === email
      );

      if (!matchedZohoUser) {
        continue;
      }

      // Upsert user mapping
      if (!dryRun) {
        try {
          await supabaseAdmin.from('zoho_user_mappings').upsert(
            {
              user_id: authUser.id,
              zoho_user_id: String(matchedZohoUser.id),
              zoho_user_email: email,
              ai_subscriptions: aiSubscriptions,
              seniority_level: seniorityLevel,
              is_active: true,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'zoho_user_id' }
          );
        } catch (mErr) {
          console.warn('[ZohoCron] zoho_user_mappings warning:', mErr);
        }
      }

      // Fetch user's active & open tasks from Zoho
      const rawTasks = await fetchZohoUserTasks(token, portalId, matchedZohoUser.id, 'open', 100);

      let userDoneTasks = 0;
      let userDelayedTasks = 0;
      let userQATasks = 0;
      let userPlannedHours = 0;
      let userActualHours = 0;
      let userScoreSum = 0;
      let userCommentsCount = 0;
      let userTaskCount = 0;
      const userEmailTasks: TaskEmailItem[] = [];
      const userStrengths: string[] = [];
      const userImprovements: string[] = [];

      for (const raw of rawTasks) {
        // Resolve task date
        let taskDateStr = '';
        if (raw.start_date) {
          const parts = raw.start_date.split('-');
          if (parts.length === 3) {
            taskDateStr = `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
          }
        }
        if (!taskDateStr && raw.created_time_long) {
          taskDateStr = formatDateYYYYMMDD(new Date(raw.created_time_long));
        }
        if (!taskDateStr) {
          taskDateStr = targetDate;
        }

        // Only evaluate tasks assigned or active on the target evaluation date
        if (taskDateStr !== targetDate) {
          continue;
        }

        const plannedMins = parseDurationToMinutes(raw.duration || raw.work || '4:00');
        let actualMins = 0;

        if (raw.log_hours) {
          const billableMins = typeof raw.log_hours.billable_hours === 'string'
            ? parseDurationToMinutes(raw.log_hours.billable_hours)
            : (Number(raw.log_hours.billable_hours) || 0) * 60;
          const nonBillableMins = typeof raw.log_hours.non_billable_hours === 'string'
            ? parseDurationToMinutes(raw.log_hours.non_billable_hours)
            : (Number(raw.log_hours.non_billable_hours) || 0) * 60;
          const totalMins = billableMins + nonBillableMins;
          if (totalMins > 0) {
            actualMins = Math.round(totalMins);
          }
        }

        // Strictly 0 if unlogged in Zoho Projects
        const actualHours = Math.round((actualMins / 60) * 100) / 100;
        const plannedHours = Math.round((plannedMins / 60) * 100) / 100;

        userPlannedHours += plannedHours;
        userActualHours += actualHours;

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
        const isQAReview =
          statusLower.includes('qa') ||
          statusLower.includes('review') ||
          (raw.name && raw.name.toLowerCase().includes('qa'));

        if (isDone) userDoneTasks++;
        if (isDelayed) userDelayedTasks++;
        if (isQAReview) userQATasks++;

        const taskName = cleanText(raw.name);
        const projectName = cleanText(raw.project?.name || 'General Project');
        const projectId = String(raw.project?.id_string || raw.project?.id || '0');
        const taskId = String(raw.id_string || raw.id || '0');
        const zohoLink = buildZohoTaskDeepLink(portalId, projectId, taskId);

        let taskDescription = cleanText(raw.description || raw.name);
        if (taskDescription.length < 50) {
          try {
            const details = await fetchZohoTaskDetails(token, portalId, projectId, taskId);
            if (details?.description) {
              taskDescription = cleanText(details.description);
            }
          } catch {
            // Keep existing description
          }
        }

        // Fetch all task comments
        let apiComments: Array<{ author_name: string; content: string; added_time: string }> = [];
        try {
          apiComments = await fetchZohoTaskComments(token, portalId, projectId, taskId);
          userCommentsCount += apiComments.length;
        } catch (commErr) {
          console.warn(`[ZohoCron] Task comments fetch warning for ${taskId}:`, commErr);
        }

        let dbTaskUuid: string | null = null;

        // Persist task and comments if not dryRun
        if (!dryRun) {
          try {
            const { data: upsertedTask } = await supabaseAdmin.from('zoho_tasks').upsert(
              {
                zoho_task_id: taskId,
                zoho_project_id: projectId,
                project_name: projectName,
                user_id: authUser.id,
                task_name: taskName,
                task_description: taskDescription,
                zoho_status: statusName,
                is_qa_review: isQAReview,
                planned_hours: plannedHours,
                actual_hours: actualHours,
                task_date: taskDateStr,
                zoho_link: zohoLink,
                created_time: raw.created_time_long
                  ? new Date(raw.created_time_long).toISOString()
                  : new Date().toISOString(),
                last_modified_time: raw.last_updated_time_long
                  ? new Date(raw.last_updated_time_long).toISOString()
                  : new Date().toISOString(),
                synced_at: new Date().toISOString(),
              },
              { onConflict: 'zoho_task_id' }
            ).select('id').single();

            dbTaskUuid = upsertedTask?.id || null;

            for (const c of apiComments) {
              if (c.content) {
                await supabaseAdmin.from('zoho_task_comments').upsert(
                  {
                    zoho_comment_id: `zc-${taskId}-${c.added_time || Date.now()}`,
                    zoho_task_id: taskId,
                    author_name: c.author_name || 'Team Member',
                    comment_content: c.content,
                    comment_added_time: c.added_time || new Date().toISOString(),
                  },
                  { onConflict: 'zoho_comment_id' }
                );
              }
            }
          } catch (dbErr) {
            console.warn(`[ZohoCron] Task persistence warning for ${taskId}:`, dbErr);
          }
        }

        // Run full evaluation engine
        const evalResult = await evaluateZohoTask(
          {
            taskName,
            taskDescription,
            projectName,
            plannedMinutes: plannedMins || 240,
            actualMinutes: actualMins,
            zohoStatus: statusName,
            isQAReview,
            comments: apiComments.map((c) => `${c.author_name}: ${c.content}`),
            userExperienceYears: yearsOfExp,
            seniorityLevel,
            aiSubscriptions,
          },
          { useAi: false }
        );

        userScoreSum += evalResult.overallScore;
        userTaskCount++;
        totalTasksEvaluated++;

        userEmailTasks.push({
          taskName,
          projectName,
          plannedHours,
          actualHours,
          status: statusName,
          timeAssessmentLabel: evalResult.timeAssessmentLabel,
          score: Math.round(evalResult.overallScore * 10),
          timeScore: Math.round(evalResult.timeScore * 10),
          workMatchScore: Math.round((evalResult.workMatchScore || evalResult.commentQualityScore || 0) * 10),
          feedback: evalResult.summaryFeedback,
          whereLacked: evalResult.whereLacked,
          whereToImprove: evalResult.whereToImprove,
          improvementItems: evalResult.improvementItems,
        });

        if (Array.isArray(evalResult.strengths)) {
          userStrengths.push(...evalResult.strengths);
        }
        if (Array.isArray(evalResult.improvements)) {
          userImprovements.push(...evalResult.improvements);
        }

        // Persist task evaluation record if not dryRun and task ID exists
        if (!dryRun && dbTaskUuid) {
          try {
            await supabaseAdmin.from('zoho_task_evaluations').insert({
              task_id: dbTaskUuid,
              user_id: authUser.id,
              evaluation_date: targetDate,
              overall_score: Math.round(evalResult.overallScore * 10),
              time_score: Math.round(evalResult.timeScore * 10),
              comment_quality_score: Math.round(evalResult.commentQualityScore * 10),
              complexity_score: Math.round(evalResult.complexityScore * 10),
              repetition_score: Math.round(evalResult.repetitionScore * 10),
              time_variance_minutes: evalResult.timeVarianceMinutes,
              time_assessment_label: evalResult.timeAssessmentLabel,
              is_repetitive: evalResult.isRepetitive,
              repetition_similarity_pct: evalResult.repetitionSimilarityPct,
              matched_repetitive_task_id: evalResult.matchedTaskId,
              summary_feedback: evalResult.summaryFeedback,
              strengths: evalResult.strengths,
              improvements: evalResult.improvements,
              ai_model_used: evalResult.aiModelUsed,
            });
            totalEvaluationsCreated++;
          } catch (evalErr) {
            console.warn(`[ZohoCron] Task evaluation persistence error for ${taskId}:`, evalErr);
          }
        }
      }

      totalCommentsIngested += userCommentsCount;

      const dailyScore = userTaskCount > 0 ? Math.round((userScoreSum / userTaskCount) * 10) : 0;
      const dailySummary = `Completed ${userDoneTasks}/${userTaskCount} task(s) on ${targetDate}. Logged ${userActualHours}h vs ${userPlannedHours}h planned. Average score: ${dailyScore / 10}/10.`;

      // Persist daily evaluation aggregation
      if (!dryRun && userTaskCount > 0) {
        try {
          await supabaseAdmin.from('zoho_daily_evaluations').upsert(
            {
              user_id: authUser.id,
              evaluation_date: targetDate,
              total_tasks: userTaskCount,
              done_tasks: userDoneTasks,
              qa_review_tasks: userQATasks,
              delayed_tasks: userDelayedTasks,
              total_planned_hours: userPlannedHours,
              total_actual_hours: userActualHours,
              daily_score: dailyScore,
              daily_summary: dailySummary,
            },
            { onConflict: 'user_id,evaluation_date' }
          );
        } catch (dayErr) {
          console.warn(`[ZohoCron] zoho_daily_evaluations upsert warning for ${email}:`, dayErr);
        }
      }

      // Dispatch daily evaluation email to user and senior CC emails (if enabled)
      let emailDelivered = false;
      if (userTaskCount > 0 && dailyEmailEnabled) {
        try {
          const emailPayload: DailyEvaluationEmailPayload = {
            userName: fullName,
            userEmail: email,
            date: targetDate,
            dailyScore,
            totalPlannedHours: Math.round(userPlannedHours * 100) / 100,
            totalActualHours: Math.round(userActualHours * 100) / 100,
            taskCount: userTaskCount,
            doneTasks: userDoneTasks,
            delayedTasks: userDelayedTasks,
            qaTasks: userQATasks,
            dailySummary,
            strengths: Array.from(new Set(userStrengths)).slice(0, 4),
            improvements: Array.from(new Set(userImprovements)).slice(0, 4),
            tasks: userEmailTasks,
          };

          const emailResult = await sendDailyEvaluationEmail({
            to: email,
            cc: seniorEmails,
            payload: emailPayload,
            dryRun,
          });

          if (emailResult.success) {
            totalEmailsSent++;
            emailDelivered = true;
          } else {
            totalEmailsFailed++;
          }
        } catch (emailErr) {
          totalEmailsFailed++;
          console.warn(`[ZohoCron] Daily evaluation email dispatch failed for ${email}:`, emailErr);
        }
      } else if (userTaskCount > 0 && !dailyEmailEnabled) {
        console.log(`[ZohoCron] Daily evaluation email is disabled for ${email}. Skipping dispatch.`);
      }

      details.push({
        userEmail: email,
        userName: fullName,
        taskCount: userTaskCount,
        commentCount: userCommentsCount,
        dailyScore,
        totalPlannedHours: Math.round(userPlannedHours * 100) / 100,
        totalActualHours: Math.round(userActualHours * 100) / 100,
        seniorEmails,
        emailDelivered,
      });
    }

    return {
      success: true,
      date: targetDate,
      dryRun,
      usersEvaluated: details.length,
      tasksEvaluated: totalTasksEvaluated,
      commentsIngested: totalCommentsIngested,
      evaluationsCreated: totalEvaluationsCreated,
      emailsSent: totalEmailsSent,
      emailsFailed: totalEmailsFailed,
      durationMs: Date.now() - startTime,
      details,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[ZohoCron] Error executing daily evaluation cron:', err);
    return {
      success: false,
      date: targetDate,
      dryRun,
      usersEvaluated: details.length,
      tasksEvaluated: totalTasksEvaluated,
      commentsIngested: totalCommentsIngested,
      evaluationsCreated: totalEvaluationsCreated,
      emailsSent: totalEmailsSent,
      emailsFailed: totalEmailsFailed,
      durationMs: Date.now() - startTime,
      error: errorMsg,
      details,
    };
  }
}
