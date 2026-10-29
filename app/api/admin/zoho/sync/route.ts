import { NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/supabase/admin';
import { syncLiveZohoTasks } from '@/lib/zoho/sync';

export async function POST(request: Request) {
  try {
    const adminCheck = await requireAdminUser();
    const isDev = process.env.NODE_ENV === 'development';
    if (!adminCheck && !isDev) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await syncLiveZohoTasks(true);

    if (!result.success && result.error) {
      return NextResponse.json(
        {
          error: result.error,
          lastSyncedAt: result.lastSyncedAt,
          taskCount: result.taskCount,
          userCount: result.userCount,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Successfully synchronized ${result.taskCount} live tasks across ${result.userCount} users from Zoho Projects.`,
      lastSyncedAt: result.lastSyncedAt,
      taskCount: result.taskCount,
      userCount: result.userCount,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Admin Zoho Sync API] Error syncing:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const adminCheck = await requireAdminUser();
    const isDev = process.env.NODE_ENV === 'development';
    if (!adminCheck && !isDev) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await syncLiveZohoTasks(false);

    return NextResponse.json({
      success: result.success,
      lastSyncedAt: result.lastSyncedAt,
      taskCount: result.taskCount,
      userCount: result.userCount,
      isLive: result.success,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
