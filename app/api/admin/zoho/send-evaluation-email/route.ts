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
} from '@/lib/zoho/client';
import { generateDynamicPerformanceSummary, evaluateWorkAndCommentMatch } from '@/lib/zoho/heuristics';
import { formatDateYYYYMMDD, formatUserName } from '@/lib/zoho/service';
import { sendDailyEvaluationEmail } from '@/lib/email/service';
import type { TaskEmailItem, DailyEvaluationEmailPayload } from '@/lib/email/templates/daily-evaluation-email';

export async function POST(request: Request) {
  try {
    const adminCheck = await requireAdminUser();
    const isDev = process.env.NODE_ENV === 'development';
    if (!adminCheck && !isDev) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { userIds, date } = body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json(
        { error: 'userIds (array of strings) is required and cannot be empty' },
        { status: 400 }
      );
    }

    const targetDate = date || formatDateYYYYMMDD(new Date());
    const portalId = process.env.ZOHO_PORTAL_ID || 'creolestudios';
    const token = await getZohoAccessToken();

    if (!token) {
      return NextResponse.json(
        { error: 'Unable to acquire Zoho access token. Check credentials.' },
        { status: 500 }
      );
    }

    const zohoUsers = await fetchZohoPortalUsers(token, portalId);
    const { data: authData } = await supabaseAdmin.auth.admin.listUsers();
    const { data: profiles } = await supabaseAdmin.from('user_profiles').select('*');

    const results = [];
    let sentCount = 0;
    let failedCount = 0;

    for (const userId of userIds) {
      const authUser = authData?.users?.find((u) => u.id === userId);
      if (!authUser) {
        results.push({ userId, success: false, error: 'User not found in auth system' });
        failedCount++;
        continue;
      }

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

      const matchedZohoUser = zohoUsers.find(
        (zu) => zu.email && zu.email.toLowerCase().trim() === email
      );

      if (!matchedZohoUser) {
        results.push({
          userId,
          email,
          success: false,
          error: 'No matching Zoho Projects user found for this email address',
        });
        failedCount++;
        continue;
      }

      // Fetch open tasks
      const rawTasks = await fetchZohoUserTasks(token, portalId, matchedZohoUser.id, 'open', 100);

      // Filter strictly for targetDate
      const dayTasks: any[] = [];
      for (const raw of rawTasks) {
        let taskDateStr = '';
        if (raw.start_date) {
          const parts = raw.start_date.split('-');
          if (parts.length === 3) {
            taskDateStr = parts[0].length === 4
              ? `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`
              : `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
          }
        } else if (raw.end_date) {
          const parts = raw.end_date.split('-');
          if (parts.length === 3) {
            taskDateStr = parts[0].length === 4
              ? `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`
              : `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
          }
        }

        if (!taskDateStr && raw.created_time_long) {
          taskDateStr = formatDateYYYYMMDD(new Date(raw.created_time_long));
        }

        if (taskDateStr === targetDate) {
          dayTasks.push(raw);
        }
      }

      if (dayTasks.length === 0) {
        results.push({
          userId,
          email,
          success: false,
          error: `No tasks found for ${targetDate}`,
        });
        failedCount++;
        continue;
      }

      let userPlannedHours = 0;
      let userActualHours = 0;
      let userDoneTasks = 0;
      let userDelayedTasks = 0;
      let userQATasks = 0;
      let scoreSum = 0;
      const userEmailTasks: TaskEmailItem[] = [];
      const userStrengths: string[] = [];
      const userImprovements: string[] = [];

      for (const task of dayTasks) {
        const plannedMins = parseDurationToMinutes(task.duration || task.work || '4:00');
        let actualMins = 0;

        if (task.log_hours) {
          const billableMins = typeof task.log_hours.billable_hours === 'string'
            ? parseDurationToMinutes(task.log_hours.billable_hours)
            : (Number(task.log_hours.billable_hours) || 0) * 60;
          const nonBillableMins = typeof task.log_hours.non_billable_hours === 'string'
            ? parseDurationToMinutes(task.log_hours.non_billable_hours)
            : (Number(task.log_hours.non_billable_hours) || 0) * 60;
          const totalMins = billableMins + nonBillableMins;
          if (totalMins > 0) {
            actualMins = Math.round(totalMins);
          }
        }

        const plannedHours = Math.round((plannedMins / 60) * 100) / 100;
        const actualHours = Math.round((actualMins / 60) * 100) / 100;
        userPlannedHours += plannedHours;
        userActualHours += actualHours;

        const variance = actualMins - plannedMins;
        let timeScore = 10;
        let timeAssessmentLabel = 'ON_TIME';

        if (actualMins === 0) {
          timeScore = 0;
          timeAssessmentLabel = 'NOT_LOGGED';
        } else if (variance > 0 && variance <= 5) {
          timeScore = 10;
          timeAssessmentLabel = 'SLIGHT_OVERRUN_TOLERATED';
        } else if (variance <= 0 && variance >= -15) {
          timeScore = 10;
          timeAssessmentLabel = 'ON_TIME';
        } else if (variance < -15) {
          const earlyGap = Math.abs(variance) - 15;
          const penalty = Math.min(5.0, Number(((earlyGap / (plannedMins || 60)) * 8).toFixed(1)));
          timeScore = Math.max(3.0, Number((10 - penalty).toFixed(1)));
          timeAssessmentLabel = 'UNEXPECTED_EARLY';
        } else {
          const excess = variance - 5;
          const penalty = Math.min(7.0, Number(((excess / (plannedMins || 60)) * 7).toFixed(1)));
          timeScore = Math.max(2.0, Number((10 - penalty).toFixed(1)));
          timeAssessmentLabel = 'OVERDUE';
        }

        const statusName = task.status?.name || 'In Progress';
        const statusLower = statusName.toLowerCase();
        const isDone = statusLower.includes('completed') || statusLower.includes('closed') || task.completed === true;
        const isDelayed = statusLower.includes('delay') || statusLower.includes('overdue') || statusLower.includes('hold');
        const isQAReview = statusLower.includes('qa') || statusLower.includes('review') || (task.name && task.name.toLowerCase().includes('qa'));

        if (isDone) userDoneTasks++;
        if (isDelayed) userDelayedTasks++;
        if (isQAReview) userQATasks++;

        const projectId = String(task.project?.id_string || task.project?.id || '0');
        const taskId = String(task.id_string || task.id || '0');
        const taskName = stripHtml(task.name);
        const projectName = stripHtml(task.project?.name || 'General Project');

        const details = await fetchZohoTaskDetails(token, portalId, projectId, taskId);
        const taskDescription = stripHtml(details?.description || task.description || task.name);
        const apiComments = await fetchZohoTaskComments(token, portalId, projectId, taskId);
        const commentContents = apiComments.map(c => c.content);

        const workMatchResult = evaluateWorkAndCommentMatch(taskDescription, commentContents, {
          userExperienceYears: yearsOfExp,
          seniorityLevel,
          aiSubscriptions,
        });

        const workMatchScore = workMatchResult.workMatchScore;
        const overallScore = Number((workMatchScore * 0.55 + timeScore * 0.40 + (isQAReview ? 0.5 : 0)).toFixed(1));
        scoreSum += overallScore;

        const dyn = generateDynamicPerformanceSummary({
          taskDescription,
          comments: commentContents,
          timeAssessmentLabel,
          workMatchScore,
          seniorityLevel,
          userExperienceYears: yearsOfExp,
          aiSubscriptions,
          isQAReview,
        });

        userEmailTasks.push({
          taskName,
          projectName,
          plannedHours,
          actualHours,
          status: statusName,
          timeAssessmentLabel,
          timeScore: Math.round(timeScore * 10),
          workMatchScore: Math.round(workMatchScore * 10),
          score: Math.round(overallScore * 10),
          feedback: dyn.performanceSummary,
          whereLacked: dyn.whereLacked,
          whereToImprove: dyn.whereToImprove,
          improvementItems: dyn.improvementItems,
        });

        if (timeScore === 10) {
          userStrengths.push('Disciplined delivery within permitted time tolerance buffer.');
        }
        if (dyn.improvementItems) {
          userImprovements.push(...dyn.improvementItems);
        }
      }

      const dailyScore = dayTasks.length > 0 ? Number((scoreSum / dayTasks.length).toFixed(1)) : 0;
      const dailySummary = `Completed ${userDoneTasks}/${dayTasks.length} task(s) on ${targetDate}${userQATasks > 0 ? ` (${userQATasks} in QA review)` : ''}. Logged ${userActualHours}h vs ${userPlannedHours}h planned. Average daily performance score: ${dailyScore}/10.`;

      const payload: DailyEvaluationEmailPayload = {
        userName: fullName,
        userEmail: email,
        date: targetDate,
        dailyScore: Math.round(dailyScore * 10),
        totalPlannedHours: Math.round(userPlannedHours * 100) / 100,
        totalActualHours: Math.round(userActualHours * 100) / 100,
        taskCount: dayTasks.length,
        doneTasks: userDoneTasks,
        delayedTasks: userDelayedTasks,
        qaTasks: userQATasks,
        dailySummary,
        strengths: Array.from(new Set(userStrengths)).slice(0, 3),
        improvements: Array.from(new Set(userImprovements)).slice(0, 4),
        tasks: userEmailTasks,
      };

      const emailResult = await sendDailyEvaluationEmail({
        to: email,
        cc: seniorEmails,
        payload,
        dryRun: false,
      });

      if (emailResult.success) {
        sentCount++;
        results.push({
          userId,
          email,
          userName: fullName,
          seniorEmails,
          taskCount: dayTasks.length,
          dailyScore,
          success: true,
          messageId: emailResult.messageId,
        });
      } else {
        failedCount++;
        results.push({
          userId,
          email,
          success: false,
          error: emailResult.error || 'Failed to dispatch email',
        });
      }
    }

    return NextResponse.json({
      success: true,
      targetDate,
      sentCount,
      failedCount,
      results,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Error in POST /api/admin/zoho/send-evaluation-email:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
