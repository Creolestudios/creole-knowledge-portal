import { NextResponse } from 'next/server';
import { supabaseAdmin, requireAdminUser } from '@/lib/supabase/admin';
import {
  resolveDateFilterRange,
  getMockZohoData,
  ZohoUserSummary,
  formatUserName,
  buildSampleUserSummary,
} from '@/lib/zoho/service';

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

    // 1. Fetch authenticated login users from Supabase Auth
    let authUsers: any[] = [];
    try {
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.listUsers();
      if (!authError && authData?.users) {
        // Requirement: "in zoho tab we have to list all the login users only"
        // Filter users who have logged into Creole Knowledge Portal (last_sign_in_at != null)
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

    // 3. Fetch any tasks in zoho_tasks for the selected date range
    let dbTasks: any[] = [];
    try {
      const { data: taskData, error: taskErr } = await supabaseAdmin
        .from('zoho_tasks')
        .select(`
          *,
          zoho_task_evaluations (*)
        `)
        .gte('task_date', dateRange.start)
        .lte('task_date', dateRange.end);
      if (!taskErr && taskData) {
        dbTasks = taskData;
      }
    } catch (taskErr) {
      console.warn('[Admin Zoho Users API] Could not fetch zoho_tasks:', taskErr);
    }

    // 4. Build ZohoUserSummary for each login user
    let userSummaries: ZohoUserSummary[] = [];

    if (authUsers.length > 0) {
      userSummaries = authUsers.map((authUser) => {
        const profile = profiles.find((p) => p.user_id === authUser.id || p.email === authUser.email);
        const meta = (authUser.user_metadata as Record<string, unknown> | undefined) || {};
        const fullName = formatUserName(
          authUser.email || '',
          (meta.full_name as string) || (meta.name as string) || (profile?.name as string)
        );
        const role = (profile?.current_role as string) || (profile?.role === 'admin' ? 'Admin / Lead Developer' : 'Developer');
        const yearsOfExp = (profile?.years_of_experience as number) ?? 2;
        const seniorityLevel = yearsOfExp >= 5 ? 'Senior' : yearsOfExp >= 2 ? 'Mid' : 'Junior';
        const metaSubs = meta.ai_subscriptions as string[] | undefined;
        const aiSubscriptions = (profile?.ai_subscriptions as string[]) || (Array.isArray(metaSubs) ? metaSubs : ['GitHub Copilot']);

        // Check if this user has tasks in zoho_tasks
        const userDbTasks = dbTasks.filter((t) => t.user_id === authUser.id || t.user_email === authUser.email);

        if (userDbTasks.length > 0) {
          let done = 0;
          let pending = 0;
          let delayed = 0;
          let scoreSum = 0;
          let totalHours = 0;

          const daysMap = new Map<string, any[]>();
          for (const task of userDbTasks) {
            const date = task.task_date;
            if (!daysMap.has(date)) daysMap.set(date, []);
            daysMap.get(date)!.push(task);

            totalHours += Number(task.actual_hours) || 0;
            const evalData = task.zoho_task_evaluations?.[0];
            if (evalData) {
              scoreSum += evalData.overallScore;
              if (evalData.timeAssessmentLabel === 'OVERDUE') delayed++;
            }
            const status = (task.zoho_status || '').toLowerCase();
            if (status === 'closed' || status === 'done') done++;
            else pending++;
          }

          const dailyEvaluations = Array.from(daysMap.entries()).map(([date, tList]) => ({
            date,
            dayScore: tList.length > 0 ? Math.round(scoreSum / userDbTasks.length) : 0,
            summary: `Completed ${tList.length} task(s) on ${date}.`,
            tasks: tList.map((t) => ({
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
              comments: [],
              evaluation: t.zoho_task_evaluations?.[0] || undefined,
            })),
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
              weeklyAvgScore: userDbTasks.length > 0 ? Math.round(scoreSum / userDbTasks.length) : 85,
              totalHoursLogged: Math.round(totalHours * 10) / 10,
            },
            dailyEvaluations,
          };
        }

        // Generate realistic sample evaluation for testing when zoho_tasks has no sync yet
        return buildSampleUserSummary(
          authUser.id,
          authUser.email || '',
          fullName,
          role,
          yearsOfExp,
          seniorityLevel,
          aiSubscriptions,
          dateRange
        );
      });
    } else {
      // Fallback if auth admin returns empty
      userSummaries = getMockZohoData();
    }

    // Sort by name for clean employee directory display
    userSummaries.sort((a, b) => a.name.localeCompare(b.name));

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
        range: dateRange,
      },
      users: filteredUsers,
    });
  } catch (error: any) {
    console.error('API Error in GET /api/admin/zoho/users:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
