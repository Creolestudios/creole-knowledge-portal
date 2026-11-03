import { NextResponse } from 'next/server';
import { supabaseAdmin, requireAdminUser } from '@/lib/supabase/admin';
import {
  getZohoAccessToken,
  fetchZohoPortalUsers,
  fetchZohoUserTasks,
  fetchZohoTaskComments,
  fetchZohoTaskDetails,
  stripHtml,
  parseDurationToMinutes,
  extractPlannedMinutesFromTask,
} from '@/lib/zoho/client';
import { generateDynamicPerformanceSummary, evaluateWorkAndCommentMatch } from '@/lib/zoho/heuristics';
import { formatDateYYYYMMDD, formatUserName } from '@/lib/zoho/service';
import { sendDailyDigestEmail } from '@/lib/email/service';
import { getDigestRecipientEmails } from '@/lib/zoho/digest-recipients-store';
import {
  type DailyDigestUserRow,
  type DailyDigestEmailPayload,
  buildEvaluationSummaryPointers,
} from '@/lib/email/templates/daily-digest-email';

export async function POST(request: Request) {
  try {
    const adminCheck = await requireAdminUser();
    const isDev = process.env.NODE_ENV === 'development';
    if (!adminCheck && !isDev) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let targetDate = formatDateYYYYMMDD(new Date());
    let recipientOverride: string[] | undefined;

    try {
      const body = await request.json();
      if (body?.date) targetDate = body.date;
      if (Array.isArray(body?.recipients) && body.recipients.length > 0) {
        recipientOverride = body.recipients;
      }
    } catch {
      // Body may be empty, defaults to today
    }

    const portalId = process.env.ZOHO_PORTAL_ID || 'creolestudios';
    const token = await getZohoAccessToken();

    if (!token) {
      return NextResponse.json(
        { error: 'Unable to acquire Zoho access token. Check credentials.' },
        { status: 500 }
      );
    }

    // 1. Resolve recipients - strictly only user-added recipients, never site admin profiles
    let recipientEmails: string[] = [];
    if (recipientOverride && recipientOverride.length > 0) {
      recipientEmails = recipientOverride;
    } else {
      recipientEmails = await getDigestRecipientEmails();
    }

    if (recipientEmails.length === 0) {
      return NextResponse.json(
        { error: 'No digest recipients configured. Please add recipient email addresses in the Digest tab.' },
        { status: 400 }
      );
    }

    // 2. Fetch users and evaluate for target date
    const zohoUsers = await fetchZohoPortalUsers(token, portalId);
    const listUsersResult = await supabaseAdmin.auth.admin.listUsers();
    const authData = listUsersResult?.data;
    const { data: profiles } = await supabaseAdmin.from('user_profiles').select('*');
    let dbDailyEvals: any[] = [];
    try {
      const res = await supabaseAdmin
        .from('zoho_daily_evaluations')
        .select('*')
        .eq('evaluation_date', targetDate);
      if (Array.isArray(res?.data)) dbDailyEvals = res.data;
    } catch {
      // Continue if table or mock unavailable
    }

    let allTasks: any[] = [];
    try {
      const resTasks = await supabaseAdmin
        .from('zoho_tasks')
        .select('*')
        .eq('task_date', targetDate);
      if (Array.isArray(resTasks?.data)) allTasks = resTasks.data;
    } catch {
      // Continue if table or mock unavailable
    }

    const ckpUsers = authData?.users?.filter((u) => u.last_sign_in_at != null) || [];
    const nonAdminUsers = ckpUsers.filter((authUser) => {
      const email = (authUser.email || '').toLowerCase().trim();
      const profile = profiles?.find(
        (p) => p.user_id === authUser.id || (p.email && p.email.toLowerCase().trim() === email)
      );
      return profile?.role !== 'admin';
    });

    const digestUserRows: DailyDigestUserRow[] = [];

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

      const matchedZohoUser = zohoUsers.find(
        (zu) => zu.email && zu.email.toLowerCase().trim() === email
      );

      if (!matchedZohoUser) continue;

      const rawTasks = await fetchZohoUserTasks(token, portalId, matchedZohoUser.id, 'all', 100);

      let userDoneTasks = 0;
      let userDelayedTasks = 0;
      let userQATasks = 0;
      let userPlannedHours = 0;
      let userActualHours = 0;
      let userScoreSum = 0;
      let userTaskCount = 0;
      const userImprovements: string[] = [];
      const userTaskStatuses: string[] = [];

      for (const raw of rawTasks) {
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
        if (!taskDateStr) taskDateStr = targetDate;

        if (taskDateStr !== targetDate) continue;

        userTaskStatuses.push(raw.status?.name || 'In Progress');

        const plannedMins = extractPlannedMinutesFromTask(raw.duration, raw.work, raw.name);
        let actualMins = 0;
        if (raw.log_hours) {
          const billableMins = parseDurationToMinutes(raw.log_hours.billable_hours);
          const nonBillableMins = parseDurationToMinutes(raw.log_hours.non_billable_hours);
          actualMins = billableMins + nonBillableMins;
        }

        const plannedH = plannedMins / 60;
        const actualH = actualMins / 60;
        userPlannedHours += plannedH;
        userActualHours += actualH;

        const statusLower = (raw.status?.name || '').toLowerCase();
        const isDone = statusLower.includes('done') || statusLower.includes('closed') || statusLower.includes('complete');
        const isQA = Boolean(raw.is_qa_review || statusLower.includes('qa'));
        if (isDone) userDoneTasks++;
        if (isQA) userQATasks++;

        const variance = actualMins - plannedMins;
        let timeScore = 10;
        let timeAssessmentLabel = 'ON_TIME';

        if (actualMins === 0) {
          timeScore = 0;
          timeAssessmentLabel = 'NOT_LOGGED';
          userDelayedTasks++;
        } else if (variance > 0 && variance <= 5) {
          timeScore = 10;
          timeAssessmentLabel = 'SLIGHT_OVERRUN_TOLERATED';
        } else if (variance <= 0 && variance >= -15) {
          timeScore = 10;
          timeAssessmentLabel = 'ON_TIME';
        } else if (variance < -15) {
          const gap = Math.abs(variance) - 15;
          const penalty = Math.min(5.0, Number(((gap / (plannedMins || 60)) * 8).toFixed(1)));
          timeScore = Math.max(3.0, Number((10 - penalty).toFixed(1)));
          timeAssessmentLabel = 'UNEXPECTED_EARLY';
        } else {
          const excess = variance - 5;
          const penalty = Math.min(7.0, Number(((excess / (plannedMins || 60)) * 7).toFixed(1)));
          timeScore = Math.max(2.0, Number((10 - penalty).toFixed(1)));
          timeAssessmentLabel = 'OVERDUE';
          userDelayedTasks++;
        }

        // Fetch task description & comments
        let taskDesc = '';
        const projectId = String(raw.project?.id_string || raw.project?.id || '0');
        const taskId = String(raw.id_string || raw.id || '0');
        try {
          const details = await fetchZohoTaskDetails(token, portalId, projectId, taskId);
          if (details?.description) taskDesc = stripHtml(details.description);
        } catch {
          // fallback
        }

        const comments = await fetchZohoTaskComments(token, portalId, projectId, taskId);
        const commentContents = comments.map((c) => stripHtml(c.content || ''));
        const workMatch = evaluateWorkAndCommentMatch(taskDesc, commentContents);

        const taskOverall = Number((
          workMatch.workMatchScore * 0.55 +
          timeScore * 0.40 +
          (isQA ? 0.5 : 0)
        ).toFixed(1));

        userScoreSum += taskOverall;
        userTaskCount++;

        if (timeAssessmentLabel === 'NOT_LOGGED') {
          userImprovements.push('Log timely hours in Zoho for ongoing tasks.');
        } else if (timeAssessmentLabel === 'OVERDUE') {
          userImprovements.push('Proactively update status and flag overtime dependencies.');
        }
      }

      if (userTaskCount > 0) {
        const dailyScore = Number((userScoreSum / userTaskCount).toFixed(1));
        const dynamicSummary = generateDynamicPerformanceSummary({
          taskDescription: 'Daily engineering tasks and progress comments.',
          comments: [],
          timeAssessmentLabel: userDelayedTasks > 0 ? 'OVERDUE' : 'ON_TIME',
          workMatchScore: 8.5,
          seniorityLevel,
          userExperienceYears: yearsOfExp,
          aiSubscriptions,
          isQAReview: userQATasks > 0,
        });

        const rowData: DailyDigestUserRow = {
          userId: authUser.id,
          userName: fullName,
          userEmail: email,
          seniorityLevel,
          totalTasks: userTaskCount,
          doneTasks: userDoneTasks,
          delayedTasks: userDelayedTasks,
          qaTasks: userQATasks,
          totalPlannedHours: Math.round(userPlannedHours * 100) / 100,
          totalActualHours: Math.round(userActualHours * 100) / 100,
          dailyScore,
          reason: dynamicSummary.performanceSummary,
          importantNotes: Array.from(new Set(userImprovements)).slice(0, 3),
          taskStatuses: userTaskStatuses,
        };
        rowData.summaryPointers = buildEvaluationSummaryPointers(rowData);
        digestUserRows.push(rowData);
      } else {
        const dbEval = dbDailyEvals?.find((e) => e.user_id === authUser.id);
        if (dbEval) {
          const scoreNorm = Number(
            (dbEval.daily_score > 10 ? dbEval.daily_score / 10 : dbEval.daily_score).toFixed(1)
          );
          const userTaskItems = (allTasks || []).filter((t: any) => t.user_id === authUser.id);
          const rowData: DailyDigestUserRow = {
            userId: authUser.id,
            userName: fullName,
            userEmail: email,
            seniorityLevel,
            totalTasks: dbEval.total_tasks || 2,
            doneTasks: dbEval.done_tasks || 0,
            delayedTasks: dbEval.delayed_tasks || 0,
            qaTasks: dbEval.qa_review_tasks || 0,
            totalPlannedHours: dbEval.total_planned_hours || 8.0,
            totalActualHours: dbEval.total_actual_hours || 0,
            dailyScore: scoreNorm,
            reason: dbEval.daily_summary || 'Task activity evaluated from Zoho Projects.',
            importantNotes: dbEval.total_actual_hours === 0 ? ['No timelog hours recorded in Zoho for this date'] : ['Timelog entries recorded in Zoho Projects'],
            taskStatuses: userTaskItems.map((t: any) => t.zoho_status || 'In Progress'),
          };
          rowData.summaryPointers = buildEvaluationSummaryPointers(rowData);
          digestUserRows.push(rowData);
        }
      }
    }

    if (digestUserRows.length === 0) {
      return NextResponse.json({
        success: false,
        error: `No evaluated user activity found for date: ${targetDate}`,
      }, { status: 404 });
    }

    const teamAvgScore = digestUserRows.reduce((acc, u) => acc + u.dailyScore, 0) / digestUserRows.length;
    const totalPlanned = digestUserRows.reduce((acc, u) => acc + u.totalPlannedHours, 0);
    const totalActual = digestUserRows.reduce((acc, u) => acc + u.totalActualHours, 0);
    const totalTasks = digestUserRows.reduce((acc, u) => acc + u.totalTasks, 0);
    const totalDone = digestUserRows.reduce((acc, u) => acc + u.doneTasks, 0);
    const totalDelayed = digestUserRows.reduce((acc, u) => acc + u.delayedTasks, 0);

    const payload: DailyDigestEmailPayload = {
      date: targetDate,
      teamAvgScore: Math.round(teamAvgScore * 10) / 10,
      totalUsersEvaluated: digestUserRows.length,
      totalTasks,
      totalDoneTasks: totalDone,
      totalDelayedTasks: totalDelayed,
      totalPlannedHours: Math.round(totalPlanned * 100) / 100,
      totalActualHours: Math.round(totalActual * 100) / 100,
      users: digestUserRows,
      portalUrl: process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    };

    const emailResult = await sendDailyDigestEmail({
      to: recipientEmails,
      payload,
      dryRun: false,
    });

    if (!emailResult.success) {
      return NextResponse.json({
        success: false,
        error: emailResult.error || 'Failed to dispatch daily digest email',
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      targetDate,
      recipientCount: emailResult.recipientCount,
      recipients: recipientEmails,
      usersEvaluated: digestUserRows.length,
      messageId: emailResult.messageId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Error in POST /api/admin/zoho/send-digest-email:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
