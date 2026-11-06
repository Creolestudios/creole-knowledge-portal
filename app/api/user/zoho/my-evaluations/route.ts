import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  resolveDateFilterRange,
  getMockZohoData,
  buildSampleUserSummary,
  formatUserName,
  ZohoUserSummary,
  ZohoTaskItem,
} from '@/lib/zoho/service';
import { getLiveZohoSummariesWithFilter } from '@/lib/zoho/sync';
import {
  generateDynamicPerformanceSummary,
  evaluateWorkAndCommentMatch,
  calculateTimeAdherence,
  computeCompositeTaskScore,
} from '@/lib/zoho/heuristics';
import { getZohoEvaluationRules } from '@/lib/zoho/rules-store';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { searchParams } = new URL(request.url);
    const filterType = (searchParams.get('type') || 'week') as 'week' | 'month' | 'range';
    const weekOffset = parseInt(searchParams.get('weekOffset') || '0', 10);
    const monthOffset = parseInt(searchParams.get('monthOffset') || '0', 10);
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;
    const forceSync = searchParams.get('refresh') === 'true' || searchParams.get('sync') === 'true';

    const dateRange = resolveDateFilterRange({
      type: filterType,
      weekOffset,
      monthOffset,
      startDate,
      endDate,
    });

    let myData: ZohoUserSummary | undefined;

    const userEmail = user?.email?.toLowerCase().trim();
    let targetUserId = user?.id;

    // 1. If explicit sync is requested, attempt live Zoho sync
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
          if (userEmail) {
            myData = liveResult.users.find(
              (u) =>
                (u.email && u.email.toLowerCase().trim() === userEmail) ||
                (targetUserId && u.userId === targetUserId)
            );
          } else {
            myData = liveResult.users[0];
          }
        }
      } catch (liveErr) {
        console.warn('[User Zoho Evaluations API] Live fetch error:', liveErr);
      }
    }

    // 2. Primary source: Fetch from Supabase Database (zoho_tasks, comments, evaluations)
    if (!myData) {
      try {
        let profile: any = null;
        if (targetUserId) {
          const { data: profData } = await supabaseAdmin
            .from('user_profiles')
            .select('*')
            .eq('user_id', targetUserId)
            .single();
          profile = profData;
        } else if (userEmail) {
          const { data: profData } = await supabaseAdmin
            .from('user_profiles')
            .select('*')
            .eq('email', userEmail)
            .single();
          profile = profData;
          if (profile?.user_id) {
            targetUserId = profile.user_id;
          }
        }

        // In dev environment with unauthenticated test session, pick first user profile with tasks
        if (!targetUserId && !userEmail && process.env.NODE_ENV === 'development') {
          const { data: firstTask } = await supabaseAdmin
            .from('zoho_tasks')
            .select('user_id')
            .not('user_id', 'is', null)
            .limit(1)
            .single();
          if (firstTask?.user_id) {
            targetUserId = firstTask.user_id;
            const { data: profData } = await supabaseAdmin
              .from('user_profiles')
              .select('*')
              .eq('user_id', targetUserId)
              .single();
            profile = profData;
          }
        }

        let query = supabaseAdmin
          .from('zoho_tasks')
          .select(`
            *,
            zoho_task_comments (*),
            zoho_task_evaluations (*)
          `)
          .order('task_date', { ascending: false });

        if (targetUserId) {
          query = query.eq('user_id', targetUserId);
        }

        const { data: dbTasks, error: taskErr } = await query;

        if (!taskErr && dbTasks && dbTasks.length > 0) {
          const activeRules = await getZohoEvaluationRules();
          const meta = (user?.user_metadata as Record<string, unknown> | undefined) || {};
          const fullName = formatUserName(
            userEmail || profile?.email || '',
            (meta.full_name as string) || (meta.name as string) || (profile?.name as string)
          );
          const role = (profile?.current_role as string) || 'Developer';
          const yearsOfExp = (profile?.years_of_experience as number) ?? 2;
          const seniorityLevel = yearsOfExp >= 5 ? 'Senior' : yearsOfExp >= 2 ? 'Mid' : 'Junior';
          const profileSubs = Array.isArray(profile?.ai_subscriptions) && profile.ai_subscriptions.length > 0
            ? profile.ai_subscriptions
            : null;
          const metaSubs = Array.isArray(meta?.ai_subscriptions) && meta.ai_subscriptions.length > 0
            ? (meta.ai_subscriptions as string[])
            : null;
          const aiSubscriptions: string[] = profileSubs || metaSubs || [];

          // Helper to build a unified ZohoTaskItem with authoritative strict evaluation
          const buildTaskItemWithEvaluation = (t: any): ZohoTaskItem => {
            const plannedMins = t.planned_minutes != null && Number(t.planned_minutes) > 0
              ? Number(t.planned_minutes)
              : Math.round((Number(t.planned_hours) || 0) * 60) || 240;
            const actualMins = t.actual_minutes != null
              ? Number(t.actual_minutes)
              : Math.round((Number(t.actual_hours) || 0) * 60);
            const dynamicTimeAdh = calculateTimeAdherence(plannedMins, actualMins, activeRules);

            const taskCommentsList = (t.zoho_task_comments || []).map((c: any) => c.comment_content || c.content || '');
            const hasComments = taskCommentsList.length > 0;
            const workMatchResult = evaluateWorkAndCommentMatch(t.task_description, taskCommentsList, {
              userExperienceYears: yearsOfExp,
              seniorityLevel,
              aiSubscriptions,
              plannedMinutes: plannedMins,
              actualMinutes: actualMins,
              taskName: t.task_name,
              rules: activeRules,
            });

            const workMatchScore = workMatchResult.workMatchScore;
            const timeScore = dynamicTimeAdh.timeScore;
            const timeAssessmentLabel = dynamicTimeAdh.assessmentLabel;
            const variance = dynamicTimeAdh.timeVarianceMinutes;
            const raw = t.zoho_task_evaluations?.[0];
            const complexityScore = raw?.complexity_score ? (raw.complexity_score > 10 ? raw.complexity_score / 10 : raw.complexity_score) : 8.0;
            const repetitionScore = raw?.repetition_score ? (raw.repetition_score > 10 ? raw.repetition_score / 10 : raw.repetition_score) : 10.0;
            const overallScore = computeCompositeTaskScore({
              timeScore,
              commentQualityScore: workMatchScore,
              complexityScore,
              repetitionScore,
              isQAReview: Boolean(t.is_qa_review || (t.zoho_status || '').toLowerCase().includes('qa')),
              rules: activeRules,
            });

            const dyn = generateDynamicPerformanceSummary({
              taskDescription: t.task_description || '',
              comments: taskCommentsList,
              timeAssessmentLabel,
              workMatchScore,
              seniorityLevel,
              userExperienceYears: yearsOfExp,
              aiSubscriptions,
              isQAReview: Boolean(t.is_qa_review || (t.zoho_status || '').toLowerCase().includes('qa')),
              complexityScore,
              repetitionScore,
              plannedMinutes: plannedMins,
              actualMinutes: actualMins,
              timeScore,
              rules: activeRules,
            });

            const evalItem = {
              overallScore: Math.min(10.0, overallScore),
              timeScore,
              workMatchScore,
              commentQualityScore: workMatchScore,
              complexityScore,
              repetitionScore,
              timeVarianceMinutes: variance,
              timeAssessmentLabel,
              isRepetitive: raw?.is_repetitive || false,
              repetitionSimilarityPct: raw?.repetition_similarity_pct || 0,
              matchedTaskId: raw?.matched_repetitive_task_id || null,
              workMatchFeedback: workMatchResult.explanation,
              summaryFeedback: raw?.summary_feedback || dyn.performanceSummary,
              whereLacked: dyn.whereLacked,
              whereToImprove: dyn.whereToImprove,
              improvementItems: dyn.improvementItems,
              strengths: (raw?.strengths && raw.strengths.length > 0)
                ? raw.strengths
                : [
                    workMatchScore >= 8.5 ? 'Progress comments justify the task implementation scope.' : 'Task actively tracked in Zoho Projects.',
                    timeScore === 10 ? 'Maintained disciplined delivery within permitted time tolerance buffer.' : 'Work logged and reviewed.',
                  ],
              improvements: dyn.improvementItems,
              aiModelUsed: raw?.ai_model_used || 'engineering-rule-engine',
            };

            return {
              id: t.id,
              zohoTaskId: t.zoho_task_id,
              projectId: t.zoho_project_id,
              projectName: t.project_name || 'Creole Knowledge Portal',
              taskName: t.task_name,
              taskDescription: t.task_description,
              zohoStatus: t.zoho_status,
              isQAReview: Boolean(t.is_qa_review || (t.zoho_status || '').toLowerCase().includes('qa')),
              plannedHours: Number(t.planned_hours) || 4,
              actualHours: Number.isFinite(Number(t.actual_hours)) ? Number(t.actual_hours) : 0,
              plannedMinutes: plannedMins,
              actualMinutes: actualMins,
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
          const mappedUpToDateTasks = dbTasks.map(buildTaskItemWithEvaluation);

          let tillDateDone = 0;
          let tillDateQAReview = 0;
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
            tillDateScoreSum += (item.evaluation?.overallScore || 0) * 10;
            if (item.evaluation?.timeAssessmentLabel === 'OVERDUE') tillDateDelayed++;

            const st = (item.zohoStatus || '').toLowerCase();
            const isClosed = st.includes('closed') || st.includes('completed') || (st.includes('done') && !st.includes('qa'));
            const isQA = Boolean(item.isQAReview || st.includes('qa') || st.includes('review'));

            if (isClosed) {
              tillDateDone++;
            } else if (isQA) {
              tillDateQAReview++;
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

          // 2. Active tasks strictly within date range
          const activeTasks = mappedUpToDateTasks.filter((t) => t.taskDate >= dateRange.start && t.taskDate <= dateRange.end);

          let activeDone = 0;
          let activeQAReview = 0;
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
            activeScoreSum += (item.evaluation?.overallScore || 0) * 10;
            if (item.evaluation?.timeAssessmentLabel === 'OVERDUE') activeDelayed++;

            const st = (item.zohoStatus || '').toLowerCase();
            const isClosed = st.includes('closed') || st.includes('completed') || (st.includes('done') && !st.includes('qa'));
            const isQA = Boolean(item.isQAReview || st.includes('qa') || st.includes('review'));

            if (isClosed) {
              activeDone++;
            } else if (isQA) {
              activeQAReview++;
            } else {
              activePending++;
            }
          }

          const dailyEvaluations = Array.from(activeDaysMap.entries()).map(([date, tList]) => {
            const dayScoreSum = tList.reduce((sum, it) => sum + (it.evaluation?.overallScore || 0), 0);
            const dayScore = tList.length > 0 ? Math.round((dayScoreSum / tList.length) * 10) / 10 : 8.5;
            return {
              date,
              dayScore, // strictly 0.0 - 10.0 scale!
              summary: `Completed ${tList.length} task(s) on ${date}.`,
              tasks: tList,
            };
          });

          myData = {
            userId: targetUserId || 'user-db',
            email: userEmail || profile?.email || '',
            name: fullName,
            role,
            yearsOfExperience: yearsOfExp,
            seniorityLevel,
            aiSubscriptions,
            filterSummary: {
              doneTasks: activeDone,
              qaReviewTasks: activeQAReview,
              pendingTasks: activePending,
              delayedTasks: activeDelayed,
              weeklyAvgScore: activeTasks.length > 0 ? Math.round(activeScoreSum / activeTasks.length) : 0,
              totalHoursLogged: Math.round(activeTotalHours * 10) / 10,
            },
            tillDateSummary: {
              doneTasks: tillDateDone,
              qaReviewTasks: tillDateQAReview,
              pendingTasks: tillDatePending,
              delayedTasks: tillDateDelayed,
              weeklyAvgScore: mappedUpToDateTasks.length > 0 ? Math.round(tillDateScoreSum / mappedUpToDateTasks.length) : 85,
              totalHoursLogged: Math.round(tillDateTotalHours * 10) / 10,
            },
            dailyEvaluations,
            allDailyEvaluationsUpToDate,
          };
        }
      } catch (dbErr) {
        console.warn('[User Zoho Evaluations API] DB fetch fallback:', dbErr);
      }
    }

    // 3. Fallback to mock / sample data
    if (!myData) {
      const allUsers = getMockZohoData();
      if (userEmail) {
        myData = allUsers.find((u) => u.email.toLowerCase() === userEmail);
      }
      if (!myData) {
        myData = {
          ...allUsers[0],
          email: user?.email || allUsers[0].email,
          name: user?.user_metadata?.full_name || allUsers[0].name,
        };
      }

      // Filter mock dailyEvaluations by dateRange
      const inRangeDaily = myData.dailyEvaluations.filter(
        (d) => d.date >= dateRange.start && d.date <= dateRange.end
      );

      // If mock tasks don't match selected dateRange, generate sample tasks for this date range
      if (inRangeDaily.length === 0) {
        myData = buildSampleUserSummary(
          myData.userId,
          myData.email,
          myData.name,
          myData.role,
          myData.yearsOfExperience,
          myData.seniorityLevel,
          myData.aiSubscriptions,
          dateRange
        );
      } else {
        myData = {
          ...myData,
          dailyEvaluations: inRangeDaily,
        };
      }
    }

    return NextResponse.json({
      readOnly: true,
      filter: {
        type: filterType,
        range: dateRange,
      },
      evaluation: myData,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
