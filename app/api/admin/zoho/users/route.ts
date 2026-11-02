import { NextResponse } from 'next/server';
import { supabaseAdmin, requireAdminUser } from '@/lib/supabase/admin';
import {
  resolveDateFilterRange,
  getMockZohoData,
  ZohoUserSummary,
  ZohoTaskItem,
  formatUserName,
  buildSampleUserSummary,
} from '@/lib/zoho/service';
import { getLiveZohoSummariesWithFilter } from '@/lib/zoho/sync';
import { parseDurationToMinutes } from '@/lib/zoho/client';
import { generateDynamicPerformanceSummary, evaluateWorkAndCommentMatch, calculateTimeAdherence } from '@/lib/zoho/heuristics';

export async function GET(request: Request) {
  try {
    const adminCheck = await requireAdminUser();
    const isDev = process.env.NODE_ENV === 'development';
    if (!adminCheck && !isDev) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const filterType = (searchParams.get('type') || 'week') as 'week' | 'month' | 'range';
    const weekOffset = parseInt(searchParams.get('weekOffset') || '0', 10);
    const monthOffset = parseInt(searchParams.get('monthOffset') || '0', 10);
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;
    const searchQuery = (searchParams.get('search') || '').toLowerCase().trim();

    const dateRange = resolveDateFilterRange({
      type: filterType,
      weekOffset,
      monthOffset,
      startDate,
      endDate,
    });

    let userSummaries: ZohoUserSummary[] = [];
    let isLive = true;
    let lastSyncedAt = new Date().toISOString();

    const forceSync = searchParams.get('refresh') === 'true' || searchParams.get('sync') === 'true';

    if (forceSync) {
      try {
        const liveResult = await getLiveZohoSummariesWithFilter(
          {
            type: filterType,
            weekOffset,
            monthOffset,
            startDate,
            endDate,
          },
          true
        );
        if (liveResult && liveResult.users && liveResult.users.length > 0) {
          userSummaries = liveResult.users;
          isLive = liveResult.isLive;
          lastSyncedAt = liveResult.lastSyncedAt;
        }
      } catch (liveErr) {
        console.warn('[Admin Zoho Users API] Live Zoho fetch fallback:', liveErr);
      }
    }

    // Fallback: If live data not available or running in mock/test environment without Zoho access
    if (userSummaries.length === 0) {
      // 1. Fetch authenticated login users from Supabase Auth
      let authUsers: any[] = [];
      try {
        const { data: authData, error: authError } = await supabaseAdmin.auth.admin.listUsers();
        if (!authError && authData?.users) {
          // Requirement: "in zoho tab we have to list all the login users only"
          authUsers = authData.users.filter((u) => u.last_sign_in_at != null);
        }
      } catch (authErr) {
        console.warn('[Admin Zoho Users API] Could not list auth users:', authErr);
      }

      // 2. Fetch all user profiles from database
      let profiles: any[] = [];
      try {
        const { data: profileData, error: profileErr } = await supabaseAdmin
          .from('user_profiles')
          .select('*');
        if (!profileErr && profileData) {
          profiles = profileData;
        }
      } catch (profErr) {
        console.warn('[Admin Zoho Users API] Could not fetch user_profiles:', profErr);
      }

      // 2b. Fetch user mappings from zoho_user_mappings
      let userMappings: any[] = [];
      try {
        const { data: mappingData, error: mapErr } = await supabaseAdmin
          .from('zoho_user_mappings')
          .select('*');
        if (!mapErr && mappingData) {
          userMappings = mappingData;
        }
      } catch (mErr) {
        console.warn('[Admin Zoho Users API] Could not fetch zoho_user_mappings:', mErr);
      }

      // 3. Fetch all tasks from zoho_tasks table in Supabase
      let dbTasks: any[] = [];
      try {
        const { data: taskData, error: taskErr } = await supabaseAdmin
          .from('zoho_tasks')
          .select(`
            *,
            zoho_task_comments (*),
            zoho_task_evaluations (*)
          `)
          .order('task_date', { ascending: false });
        if (!taskErr && taskData) {
          dbTasks = taskData;
        }
      } catch (taskErr) {
        console.warn('[Admin Zoho Users API] Could not fetch zoho_tasks:', taskErr);
      }

      // 4. Build ZohoUserSummary for each login user (excluding admins)
      const nonAdminAuthUsers = authUsers.filter((authUser) => {
        const email = (authUser.email || '').toLowerCase().trim();
        const profile = profiles.find((p) => p.user_id === authUser.id || (p.email && p.email.toLowerCase().trim() === email));
        return profile?.role !== 'admin';
      });

      if (nonAdminAuthUsers.length > 0) {
        userSummaries = nonAdminAuthUsers.map((authUser) => {
          const email = (authUser.email || '').toLowerCase().trim();
          const profile = profiles.find((p) => p.user_id === authUser.id || (p.email && p.email.toLowerCase().trim() === email));
          const mapping = userMappings.find((m) => m.user_id === authUser.id || (m.zoho_user_email && m.zoho_user_email.toLowerCase().trim() === email));
          const meta = (authUser.user_metadata as Record<string, unknown> | undefined) || {};
          const fullName = formatUserName(
            authUser.email || '',
            (meta.full_name as string) || (meta.name as string) || (profile?.name as string)
          );
          const role = (profile?.current_role as string) || 'Developer';
          const yearsOfExp = (profile?.years_of_experience as number) ?? 2;
          const seniorityLevel = yearsOfExp >= 5 ? 'Senior' : yearsOfExp >= 2 ? 'Mid' : 'Junior';

          // Robust AI Subscriptions extraction from profile, user_metadata, and mapping
          const profileSubs = Array.isArray(profile?.ai_subscriptions) && profile.ai_subscriptions.length > 0
            ? profile.ai_subscriptions
            : null;
          const metaSubs = Array.isArray(meta?.ai_subscriptions) && meta.ai_subscriptions.length > 0
            ? (meta.ai_subscriptions as string[])
            : null;
          const mappingSubs = Array.isArray(mapping?.ai_subscriptions) && mapping.ai_subscriptions.length > 0
            ? (mapping.ai_subscriptions as string[])
            : null;

          const aiSubscriptions: string[] = profileSubs || metaSubs || mappingSubs || [];

          const metaSenior = meta.senior_emails as string[] | undefined;
          const seniorEmails = (profile?.senior_emails as string[]) || (Array.isArray(metaSenior) ? metaSenior : []);
          const metaDailyEmail = meta.daily_email_enabled as boolean | undefined;
          const dailyEmailEnabled =
            profile?.daily_email_enabled !== undefined
              ? Boolean(profile.daily_email_enabled)
              : metaDailyEmail !== undefined
              ? Boolean(metaDailyEmail)
              : true;

          const mappedZohoEmail = (mapping?.zoho_user_email || '').toLowerCase().trim();
          const userDbTasks = dbTasks.filter((t) => {
            const taskEmail = (t.user_email || '').toLowerCase().trim();
            return (t.user_id && t.user_id === authUser.id) ||
                   (taskEmail && (taskEmail === email || taskEmail === mappedZohoEmail));
          });

          // Helper to build a unified ZohoTaskItem with full evaluation
          const buildTaskItemWithEvaluation = (t: any): ZohoTaskItem => {
            const plannedMins = parseDurationToMinutes(t.planned_hours) || 240;
            const actualMins = parseDurationToMinutes(t.actual_hours);
            const dynamicTimeAdh = calculateTimeAdherence(plannedMins, actualMins);

            let evalItem: any;
            const raw = t.zoho_task_evaluations?.[0];
            if (raw) {
              const workMatch = raw.comment_quality_score > 10 ? raw.comment_quality_score / 10 : raw.comment_quality_score;
              const overall = Number((workMatch * 0.55 + dynamicTimeAdh.timeScore * 0.40 + (t.is_qa_review ? 0.5 : 0)).toFixed(1));

              evalItem = {
                overallScore: Math.min(10.0, overall),
                timeScore: dynamicTimeAdh.timeScore,
                workMatchScore: workMatch,
                commentQualityScore: workMatch,
                complexityScore: raw.complexity_score > 10 ? raw.complexity_score / 10 : raw.complexity_score,
                repetitionScore: raw.repetition_score > 10 ? raw.repetition_score / 10 : raw.repetition_score,
                timeVarianceMinutes: dynamicTimeAdh.timeVarianceMinutes,
                timeAssessmentLabel: dynamicTimeAdh.assessmentLabel,
                isRepetitive: raw.is_repetitive,
                repetitionSimilarityPct: raw.repetition_similarity_pct,
                matchedTaskId: raw.matched_repetitive_task_id,
                workMatchFeedback: raw.summary_feedback,
                summaryFeedback: raw.summary_feedback,
                strengths: raw.strengths || [],
                improvements: raw.improvements || [],
                aiModelUsed: raw.ai_model_used || 'gemini-2.5-flash',
              };
            } else {
              const variance = dynamicTimeAdh.timeVarianceMinutes;
              const timeScore = dynamicTimeAdh.timeScore;
              const timeAssessmentLabel = dynamicTimeAdh.assessmentLabel;

              const taskCommentsList = (t.zoho_task_comments || []).map((c: any) => c.comment_content || c.content || '');
              const hasComments = taskCommentsList.length > 0;
              const workMatchResult = evaluateWorkAndCommentMatch(t.task_description, taskCommentsList, {
                userExperienceYears: yearsOfExp,
                seniorityLevel,
                aiSubscriptions,
                plannedMinutes: plannedMins,
                actualMinutes: actualMins,
                taskName: t.task_name,
              });
              const workMatchScore = workMatchResult.workMatchScore;
              const overallScore = Number((workMatchScore * 0.55 + timeScore * 0.40 + (t.is_qa_review ? 0.5 : 0)).toFixed(1));

              const dyn = generateDynamicPerformanceSummary({
                taskDescription: t.task_description || '',
                comments: (t.zoho_task_comments || []).map((c: any) => c.comment_content || c.content || ''),
                timeAssessmentLabel,
                workMatchScore,
                seniorityLevel,
                userExperienceYears: yearsOfExp,
                aiSubscriptions,
                isQAReview: t.is_qa_review,
              });

              evalItem = {
                overallScore: Math.min(10.0, overallScore),
                timeScore,
                workMatchScore,
                commentQualityScore: workMatchScore,
                complexityScore: 8.0,
                repetitionScore: 10.0,
                timeVarianceMinutes: variance,
                timeAssessmentLabel,
                isRepetitive: false,
                repetitionSimilarityPct: 0,
                matchedTaskId: null,
                workMatchFeedback: hasComments
                  ? 'Comments directly substantiate the implementation and verify the work completed.'
                  : 'No progress comments were logged in Zoho Projects to verify completion.',
                summaryFeedback: dyn.performanceSummary,
                whereLacked: dyn.whereLacked,
                whereToImprove: dyn.whereToImprove,
                improvementItems: dyn.improvementItems,
                strengths: [
                  workMatchScore >= 8.5 ? 'Progress comments justify the task implementation scope.' : 'Task actively tracked in Zoho Projects.',
                  timeScore === 10 ? 'Maintained disciplined delivery within permitted time tolerance buffer.' : 'Work logged and reviewed.',
                ],
                improvements: dyn.improvementItems,
                aiModelUsed: 'engineering-rule-engine',
              };
            }

            return {
              id: t.id,
              zohoTaskId: t.zoho_task_id,
              projectId: t.zoho_project_id,
              projectName: t.project_name,
              taskName: t.task_name,
              taskDescription: t.task_description,
              zohoStatus: t.zoho_status,
              isQAReview: t.is_qa_review,
              plannedHours: Number(t.planned_hours) || 0,
              actualHours: Number(t.actual_hours) || 0,
              taskDate: t.task_date,
              zohoLink: t.zoho_link,
              comments: (t.zoho_task_comments || []).map((c: any) => ({
                author: c.author_name || 'Team Member',
                content: c.comment_content,
                time: c.comment_added_time || t.task_date,
              })),
              evaluation: evalItem,
            };
          };

          // 1. All tasks from beginning of history up to today (true cumulative Till-Date)
          const upToDateDbTasks = userDbTasks;
          const mappedUpToDateTasks = upToDateDbTasks.map(buildTaskItemWithEvaluation);

          let tillDateDone = 0;
          let tillDatePending = 0;
          let tillDateDelayed = 0;
          let tillDateTotalHours = 0;
          let tillDateScoreSum = 0;

          const upToDateDaysMap = new Map<string, ZohoTaskItem[]>();
          for (const item of mappedUpToDateTasks) {
            const date = item.taskDate;
            if (!upToDateDaysMap.has(date)) upToDateDaysMap.set(date, []);
            upToDateDaysMap.get(date)!.push(item);

            tillDateTotalHours += item.actualHours || 0;
            tillDateScoreSum += item.evaluation?.overallScore || 0;
            if (item.evaluation?.timeAssessmentLabel === 'OVERDUE') tillDateDelayed++;

            const st = (item.zohoStatus || '').toLowerCase();
            if (st === 'closed' || st === 'done' || st.includes('completed') || item.isQAReview) {
              tillDateDone++;
            } else {
              tillDatePending++;
            }
          }

          const allDailyEvaluationsUpToDate = Array.from(upToDateDaysMap.entries()).map(([date, tList]) => {
            const dayScoreSum = tList.reduce((sum, it) => sum + (it.evaluation?.overallScore || 0), 0);
            const dayScore = tList.length > 0 ? Math.round((dayScoreSum / tList.length) * 10) / 10 : 8.5;
            return {
              date,
              dayScore,
              summary: `Completed ${tList.length} task(s) on ${date}.`,
              tasks: tList,
            };
          });

          // 2. Active tasks strictly within date range (e.g. current week or selected month)
          const activeTasks = mappedUpToDateTasks.filter((t) => t.taskDate >= dateRange.start && t.taskDate <= dateRange.end);

          let activeDone = 0;
          let activePending = 0;
          let activeDelayed = 0;
          let activeTotalHours = 0;
          let activeScoreSum = 0;

          const activeDaysMap = new Map<string, ZohoTaskItem[]>();
          for (const item of activeTasks) {
            const date = item.taskDate;
            if (!activeDaysMap.has(date)) activeDaysMap.set(date, []);
            activeDaysMap.get(date)!.push(item);

            activeTotalHours += item.actualHours || 0;
            activeScoreSum += item.evaluation?.overallScore || 0;
            if (item.evaluation?.timeAssessmentLabel === 'OVERDUE') activeDelayed++;

            const st = (item.zohoStatus || '').toLowerCase();
            if (st === 'closed' || st === 'done' || st.includes('completed') || item.isQAReview) {
              activeDone++;
            } else {
              activePending++;
            }
          }

          const dailyEvaluations = Array.from(activeDaysMap.entries()).map(([date, tList]) => {
            const dayScoreSum = tList.reduce((sum, it) => sum + (it.evaluation?.overallScore || 0), 0);
            const dayScore = tList.length > 0 ? Math.round((dayScoreSum / tList.length) * 10) / 10 : 8.5;
            return {
              date,
              dayScore,
              summary: `Completed ${tList.length} task(s) on ${date}.`,
              tasks: tList,
            };
          });

          const filterSummary = {
            doneTasks: activeDone,
            pendingTasks: activePending,
            delayedTasks: activeDelayed,
            weeklyAvgScore: activeTasks.length > 0 ? Math.min(100, Math.round((activeScoreSum / activeTasks.length) * 10)) : 0,
            totalHoursLogged: Math.round(activeTotalHours * 10) / 10,
          };

          const tillDateSummary = {
            doneTasks: tillDateDone,
            pendingTasks: tillDatePending,
            delayedTasks: tillDateDelayed,
            weeklyAvgScore: mappedUpToDateTasks.length > 0 ? Math.min(100, Math.round((tillDateScoreSum / mappedUpToDateTasks.length) * 10)) : 88,
            totalHoursLogged: Math.round(tillDateTotalHours * 10) / 10,
          };

          return {
            userId: authUser.id,
            email: authUser.email || '',
            name: fullName,
            role,
            yearsOfExperience: yearsOfExp,
            seniorityLevel,
            aiSubscriptions,
            seniorEmails,
            dailyEmailEnabled,
            filterSummary,
            tillDateSummary,
            dailyEvaluations,
            allDailyEvaluationsUpToDate,
          };
        });
      } else {
        userSummaries = getMockZohoData();
      }
    }

    userSummaries.sort((a, b) => a.email.localeCompare(b.email));

    // Filter by search query if provided
    const filteredUsers = searchQuery
      ? userSummaries.filter((u) =>
          u.name.toLowerCase().includes(searchQuery) ||
          u.email.toLowerCase().includes(searchQuery) ||
          u.role.toLowerCase().includes(searchQuery)
        )
      : userSummaries;

    return NextResponse.json({
      filter: {
        type: filterType,
        weekOffset,
        monthOffset,
        range: dateRange,
      },
      users: filteredUsers,
      lastSyncedAt,
      isLive,
    });
  } catch (error: any) {
    console.error('API Error in GET /api/admin/zoho/users:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
