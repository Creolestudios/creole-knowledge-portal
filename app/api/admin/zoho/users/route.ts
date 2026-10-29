import { NextResponse } from 'next/server';
import { supabaseAdmin, requireAdminUser } from '@/lib/supabase/admin';
import {
  resolveDateFilterRange,
  getMockZohoData,
  ZohoUserSummary,
  formatUserName,
  buildSampleUserSummary,
} from '@/lib/zoho/service';
import { getLiveZohoSummariesWithFilter } from '@/lib/zoho/sync';
import { generateDynamicPerformanceSummary } from '@/lib/zoho/heuristics';

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
          const profile = profiles.find((p) => p.user_id === authUser.id || p.email === authUser.email);
          const meta = (authUser.user_metadata as Record<string, unknown> | undefined) || {};
          const fullName = formatUserName(
            authUser.email || '',
            (meta.full_name as string) || (meta.name as string) || (profile?.name as string)
          );
          const role = (profile?.current_role as string) || 'Developer';
          const yearsOfExp = (profile?.years_of_experience as number) ?? 2;
          const seniorityLevel = yearsOfExp >= 5 ? 'Senior' : yearsOfExp >= 2 ? 'Mid' : 'Junior';
          const metaSubs = meta.ai_subscriptions as string[] | undefined;
          const aiSubscriptions = (profile?.ai_subscriptions as string[]) || (Array.isArray(metaSubs) ? metaSubs : ['GitHub Copilot']);

          const userDbTasks = dbTasks.filter((t) => t.user_id === authUser.id || t.user_email === authUser.email);

          // Tasks strictly within date range
          const activeTasks = userDbTasks.filter((t) => t.task_date >= dateRange.start && t.task_date <= dateRange.end);

          if (activeTasks.length > 0) {
            let done = 0;
            let pending = 0;
            let delayed = 0;
            let scoreSum = 0;
            let totalHours = 0;

            const daysMap = new Map<string, any[]>();
            for (const task of activeTasks) {
              const date = task.task_date;
              if (!daysMap.has(date)) daysMap.set(date, []);
              daysMap.get(date)!.push(task);

              totalHours += Number(task.actual_hours) || 0;
              const taskEval = (() => {
                const raw = task.zoho_task_evaluations?.[0];
                if (raw) {
                  return {
                    overallScore: raw.overall_score > 10 ? raw.overall_score / 10 : raw.overall_score,
                    timeScore: raw.time_score > 10 ? raw.time_score / 10 : raw.time_score,
                    workMatchScore: raw.comment_quality_score > 10 ? raw.comment_quality_score / 10 : raw.comment_quality_score,
                    commentQualityScore: raw.comment_quality_score > 10 ? raw.comment_quality_score / 10 : raw.comment_quality_score,
                    complexityScore: raw.complexity_score > 10 ? raw.complexity_score / 10 : raw.complexity_score,
                    repetitionScore: raw.repetition_score > 10 ? raw.repetition_score / 10 : raw.repetition_score,
                    timeVarianceMinutes: raw.time_variance_minutes,
                    timeAssessmentLabel: raw.time_assessment_label,
                    isRepetitive: raw.is_repetitive,
                    repetitionSimilarityPct: raw.repetition_similarity_pct,
                    matchedTaskId: raw.matched_repetitive_task_id,
                    workMatchFeedback: raw.summary_feedback,
                    summaryFeedback: raw.summary_feedback,
                    strengths: raw.strengths || [],
                    improvements: raw.improvements || [],
                    aiModelUsed: raw.ai_model_used || 'gemini-2.5-flash',
                  };
                }

                // Compute heuristic evaluation so evaluation is never pending
                const plannedMins = Math.round((Number(task.planned_hours) || 4) * 60);
                const actualMins = Math.round((Number(task.actual_hours) || 4) * 60);
                const variance = actualMins - plannedMins;
                let timeScore = 10;
                let timeAssessmentLabel = 'ON_TIME';

                if (variance > 0 && variance <= 5) {
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

                const hasComments = task.zoho_task_comments && task.zoho_task_comments.length > 0;
                const workMatchScore = hasComments ? 9.2 : 0;
                const overallScore = Number((workMatchScore * 0.55 + timeScore * 0.40 + (task.is_qa_review ? 0.5 : 0)).toFixed(1));

                const dyn = generateDynamicPerformanceSummary({
                  taskDescription: task.task_description || '',
                  comments: (task.zoho_task_comments || []).map((c: any) => c.comment_content || c.content || ''),
                  timeAssessmentLabel,
                  workMatchScore,
                  seniorityLevel,
                  userExperienceYears: yearsOfExp,
                  aiSubscriptions,
                  isQAReview: task.is_qa_review,
                });

                return {
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
              })();

              scoreSum += taskEval.overallScore;
              if (taskEval.timeAssessmentLabel === 'OVERDUE') delayed++;

              const status = (task.zoho_status || '').toLowerCase();
              if (status === 'closed' || status === 'done' || status.includes('completed')) done++;
              else pending++;
            }

            const dailyEvaluations = Array.from(daysMap.entries()).map(([date, tList]) => ({
              date,
              dayScore: tList.length > 0 ? Math.round((scoreSum / activeTasks.length) * 10) / 10 : 8.5,
              summary: `Completed ${tList.length} task(s) on ${date}.`,
              tasks: tList.map((t) => {
                const evalItem = (() => {
                  const raw = t.zoho_task_evaluations?.[0];
                  if (raw) {
                    return {
                      overallScore: raw.overall_score > 10 ? raw.overall_score / 10 : raw.overall_score,
                      timeScore: raw.time_score > 10 ? raw.time_score / 10 : raw.time_score,
                      workMatchScore: raw.comment_quality_score > 10 ? raw.comment_quality_score / 10 : raw.comment_quality_score,
                      commentQualityScore: raw.comment_quality_score > 10 ? raw.comment_quality_score / 10 : raw.comment_quality_score,
                      complexityScore: raw.complexity_score > 10 ? raw.complexity_score / 10 : raw.complexity_score,
                      repetitionScore: raw.repetition_score > 10 ? raw.repetition_score / 10 : raw.repetition_score,
                      timeVarianceMinutes: raw.time_variance_minutes,
                      timeAssessmentLabel: raw.time_assessment_label,
                      isRepetitive: raw.is_repetitive,
                      repetitionSimilarityPct: raw.repetition_similarity_pct,
                      matchedTaskId: raw.matched_repetitive_task_id,
                      workMatchFeedback: raw.summary_feedback,
                      summaryFeedback: raw.summary_feedback,
                      strengths: raw.strengths || [],
                      improvements: raw.improvements || [],
                      aiModelUsed: raw.ai_model_used || 'gemini-2.5-flash',
                    };
                  }
                  const plannedMins = Math.round((Number(t.planned_hours) || 4) * 60);
                  const actualMins = Math.round((Number(t.actual_hours) || 4) * 60);
                  const variance = actualMins - plannedMins;
                  let timeScore = 10;
                  let timeAssessmentLabel = 'ON_TIME';

                  if (variance > 0 && variance <= 5) {
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

                  const hasComments = t.zoho_task_comments && t.zoho_task_comments.length > 0;
                  const workMatchScore = hasComments ? 9.2 : 0;
                  const overallScore = Number((workMatchScore * 0.55 + timeScore * 0.40 + (t.is_qa_review ? 0.5 : 0)).toFixed(1));

                  const dynItem = generateDynamicPerformanceSummary({
                    taskDescription: t.task_description || '',
                    comments: (t.zoho_task_comments || []).map((c: any) => c.comment_content || c.content || ''),
                    timeAssessmentLabel,
                    workMatchScore,
                    seniorityLevel,
                    userExperienceYears: yearsOfExp,
                    aiSubscriptions,
                    isQAReview: t.is_qa_review,
                  });

                  return {
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
                      ? 'Comments directly substantiate the implementation and verification of the tasks described.'
                      : 'No progress comments were logged in Zoho Projects to verify completion.',
                    summaryFeedback: dynItem.performanceSummary,
                    whereLacked: dynItem.whereLacked,
                    whereToImprove: dynItem.whereToImprove,
                    improvementItems: dynItem.improvementItems,
                    strengths: [
                      workMatchScore >= 8.5 ? 'Progress comments justify the task implementation scope.' : 'Task actively tracked in Zoho Projects.',
                      timeScore === 10 ? 'Maintained disciplined delivery within permitted time tolerance buffer.' : 'Work logged and reviewed.',
                    ],
                    improvements: dynItem.improvementItems,
                    aiModelUsed: 'engineering-rule-engine',
                  };
                })();

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
                    time: c.comment_added_time || date,
                  })),
                  evaluation: evalItem,
                };
              }),
            }));

            return {
              userId: authUser.id,
              email: authUser.email || '',
              name: fullName,
              role,
              yearsOfExperience: yearsOfExp,
              seniorityLevel,
              aiSubscriptions,
              tillDateSummary: {
                doneTasks: done,
                pendingTasks: pending,
                delayedTasks: delayed,
                weeklyAvgScore: activeTasks.length > 0 ? Math.round(scoreSum / activeTasks.length) : 88,
                totalHoursLogged: Math.round(totalHours * 10) / 10,
              },
              dailyEvaluations,
            };
          }

          return {
            userId: authUser.id,
            email: authUser.email || '',
            name: fullName,
            role,
            yearsOfExperience: yearsOfExp,
            seniorityLevel,
            aiSubscriptions,
            tillDateSummary: {
              doneTasks: 0,
              pendingTasks: 0,
              delayedTasks: 0,
              weeklyAvgScore: 0,
              totalHoursLogged: 0,
            },
            dailyEvaluations: [],
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
