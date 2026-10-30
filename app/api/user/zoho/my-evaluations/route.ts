import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  resolveDateFilterRange,
  getMockZohoData,
  buildSampleUserSummary,
  formatUserName,
  ZohoUserSummary,
} from '@/lib/zoho/service';
import { getLiveZohoSummariesWithFilter } from '@/lib/zoho/sync';
import { generateDynamicPerformanceSummary } from '@/lib/zoho/heuristics';

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

    const dateRange = resolveDateFilterRange({
      type: filterType,
      weekOffset,
      monthOffset,
      startDate,
      endDate,
    });

    let myData: ZohoUserSummary | undefined;

    const userEmail = user?.email?.toLowerCase().trim();
    const userId = user?.id;

    // 1. Try Live Zoho cache/fetch with date filter
    try {
      const liveResult = await getLiveZohoSummariesWithFilter({
        type: filterType,
        weekOffset,
        monthOffset,
        startDate,
        endDate,
      });

      if (liveResult && liveResult.users && liveResult.users.length > 0) {
        if (userEmail) {
          myData = liveResult.users.find(
            (u) =>
              (u.email && u.email.toLowerCase().trim() === userEmail) ||
              (userId && u.userId === userId)
          );
        } else {
          // Dev / fallback if unauthenticated
          myData = liveResult.users[0];
        }
      }
    } catch (liveErr) {
      console.warn('[User Zoho Evaluations API] Live fetch error:', liveErr);
    }

    // 2. Try Supabase Database if not found in live cache
    if (!myData && (userEmail || userId)) {
      try {
        let profile: any = null;
        if (userId) {
          const { data: profData } = await supabaseAdmin
            .from('user_profiles')
            .select('*')
            .eq('user_id', userId)
            .single();
          profile = profData;
        }

        const query = supabaseAdmin
          .from('zoho_tasks')
          .select(`
            *,
            zoho_task_comments (*),
            zoho_task_evaluations (*)
          `)
          .order('task_date', { ascending: false });

        if (userId) {
          query.or(`user_id.eq.${userId},user_email.eq.${userEmail}`);
        } else if (userEmail) {
          query.eq('user_email', userEmail);
        }

        const { data: dbTasks, error: taskErr } = await query;

        if (!taskErr && dbTasks && dbTasks.length > 0) {
          const meta = (user?.user_metadata as Record<string, unknown> | undefined) || {};
          const fullName = formatUserName(
            userEmail || '',
            (meta.full_name as string) || (meta.name as string) || (profile?.name as string)
          );
          const role = (profile?.current_role as string) || 'Developer';
          const yearsOfExp = (profile?.years_of_experience as number) ?? 2;
          const seniorityLevel = yearsOfExp >= 5 ? 'Senior' : yearsOfExp >= 2 ? 'Mid' : 'Junior';
          const metaSubs = meta.ai_subscriptions as string[] | undefined;
          const aiSubscriptions = (profile?.ai_subscriptions as string[]) || (Array.isArray(metaSubs) ? metaSubs : ['GitHub Copilot']);

          // Tasks strictly within date range
          const activeTasks = dbTasks.filter((t: any) => t.task_date >= dateRange.start && t.task_date <= dateRange.end);

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
                  timeAssessmentLabel: raw.time_variance_minutes > 5 ? 'OVERDUE' : (raw.time_variance_minutes < -15 ? 'UNEXPECTED_EARLY' : 'ON_TIME'),
                  isRepetitive: raw.is_repetitive || false,
                  repetitionSimilarityPct: raw.repetition_similarity_pct || 0,
                  matchedTaskId: raw.matched_task_id,
                  summaryFeedback: raw.feedback_summary || '',
                  strengths: [],
                  improvements: [],
                  aiModelUsed: 'gemini-2.5-flash',
                };
              }

              const plannedHoursNum = Number(task.planned_hours);
              const plannedMins = Math.round((Number.isFinite(plannedHoursNum) && plannedHoursNum > 0 ? plannedHoursNum : 4) * 60);
              const actualHoursNum = Number(task.actual_hours);
              const actualMins = Math.round((Number.isFinite(actualHoursNum) && actualHoursNum >= 0 ? actualHoursNum : 0) * 60);
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

              const hasComments = task.zoho_task_comments && task.zoho_task_comments.length > 0;
              const workMatchScore = hasComments ? 9.2 : 0;
              const overallScore = Number((workMatchScore * 0.55 + timeScore * 0.40).toFixed(1));

              const dyn = generateDynamicPerformanceSummary({
                taskDescription: task.task_description || '',
                comments: (task.zoho_task_comments || []).map((c: any) => c.comment_content || c.content || ''),
                timeAssessmentLabel,
                workMatchScore,
                seniorityLevel,
                userExperienceYears: yearsOfExp,
                aiSubscriptions,
                isQAReview: (task.zoho_status || '').toLowerCase().includes('qa'),
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
                summaryFeedback: dyn.performanceSummary,
                whereLacked: dyn.whereLacked,
                whereToImprove: dyn.whereToImprove,
                improvementItems: dyn.improvementItems,
                strengths: [],
                improvements: [],
                aiModelUsed: 'engineering-rule-engine',
              };
            })();

            const taskScore = (taskEval.overallScore || 8.5) * 10;
            scoreSum += taskScore;

            const status = (task.zoho_status || '').toLowerCase();
            if (status.includes('closed') || status.includes('complete') || status.includes('done')) {
              done++;
            } else if (taskEval.timeAssessmentLabel === 'OVERDUE') {
              delayed++;
            } else {
              pending++;
            }
          }

          const dailyEvaluations = Array.from(daysMap.entries())
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([date, tList]) => {
              const dayScoreSum = tList.reduce((acc: number, t: any) => {
                const raw = t.zoho_task_evaluations?.[0];
                const score = raw ? (raw.overall_score > 10 ? raw.overall_score : raw.overall_score * 10) : 85;
                return acc + score;
              }, 0);
              return {
                date,
                dayScore: tList.length > 0 ? Math.round(dayScoreSum / tList.length) : 85,
                summary: `Completed ${tList.length} task(s) on ${date}.`,
                tasks: tList.map((t: any) => ({
                  id: t.id,
                  zohoTaskId: t.zoho_task_id,
                  projectId: t.zoho_project_id,
                  projectName: t.project_name || 'Creole Knowledge Portal',
                  taskName: t.task_name,
                  taskDescription: t.task_description,
                  zohoStatus: t.zoho_status,
                  isQAReview: (t.zoho_status || '').toLowerCase().includes('qa'),
                  plannedHours: Number(t.planned_hours) || 4,
                  actualHours: Number.isFinite(Number(t.actual_hours)) ? Number(t.actual_hours) : 0,
                  taskDate: t.task_date,
                  zohoLink: t.zoho_link,
                  comments: (t.zoho_task_comments || []).map((c: any) => ({
                    author: c.author_name || 'Team Member',
                    content: c.comment_content || c.content || '',
                    time: c.created_at ? new Date(c.created_at).toLocaleTimeString() : '12:00 PM',
                  })),
                })),
              };
            });

          myData = {
            userId: userId || 'user-db',
            email: userEmail || '',
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
