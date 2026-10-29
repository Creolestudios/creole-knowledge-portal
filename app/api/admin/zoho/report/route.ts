import { NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/supabase/admin';
import { resolveDateFilterRange, getMockZohoData, ZohoUserSummary } from '@/lib/zoho/service';

export async function GET(request: Request) {
  try {
    const adminCheck = await requireAdminUser();
    const isDev = process.env.NODE_ENV === 'development';
    if (!adminCheck && !isDev) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
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

    const allUsers = getMockZohoData();
    const targetUser = allUsers.find(u => u.userId === userId) || allUsers[0];

    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const allTasks = targetUser.dailyEvaluations.flatMap(d => d.tasks);
    let onTimeCount = 0;
    let overrunToleratedCount = 0;
    let unexpectedEarlyCount = 0;
    let overdueCount = 0;
    let repetitiveCount = 0;

    for (const t of allTasks) {
      const evalData = t.evaluation;
      if (evalData) {
        if (evalData.timeAssessmentLabel === 'ON_TIME') onTimeCount++;
        else if (evalData.timeAssessmentLabel === 'SLIGHT_OVERRUN_TOLERATED') overrunToleratedCount++;
        else if (evalData.timeAssessmentLabel === 'UNEXPECTED_EARLY') unexpectedEarlyCount++;
        else if (evalData.timeAssessmentLabel === 'OVERDUE') overdueCount++;

        if (evalData.isRepetitive) repetitiveCount++;
      }
    }

    const report = {
      generatedAt: new Date().toISOString(),
      evaluatedPeriod: {
        filterType,
        startDate: dateRange.start,
        endDate: dateRange.end,
      },
      employee: {
        id: targetUser.userId,
        name: targetUser.name,
        email: targetUser.email,
        role: targetUser.role,
        yearsOfExperience: targetUser.yearsOfExperience,
        seniorityLevel: targetUser.seniorityLevel,
        aiSubscriptions: targetUser.aiSubscriptions,
      },
      performanceSummary: {
        averageScore: targetUser.tillDateSummary.weeklyAvgScore,
        totalHoursLogged: targetUser.tillDateSummary.totalHoursLogged,
        doneTasks: targetUser.tillDateSummary.doneTasks,
        pendingTasks: targetUser.tillDateSummary.pendingTasks,
        delayedTasks: targetUser.tillDateSummary.delayedTasks,
        timeAdherenceDistribution: {
          onTime: onTimeCount,
          slightOverrunTolerated: overrunToleratedCount,
          unexpectedEarly: unexpectedEarlyCount,
          overdue: overdueCount,
        },
        repetitiveTasksFlagged: repetitiveCount,
        executiveRemarks:
          targetUser.tillDateSummary.weeklyAvgScore >= 85
            ? 'Strong overall technical delivery with solid engineering discipline and responsible time utilization.'
            : 'Acceptable velocity but requires closer attention to estimation accuracy and avoiding repetitive task patterns.',
      },
      taskRecords: allTasks,
    };

    return NextResponse.json(report);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
