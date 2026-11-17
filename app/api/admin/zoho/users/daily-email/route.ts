import { NextResponse } from 'next/server';
import { supabaseAdmin, requireAdminUser } from '@/lib/supabase/admin';

export async function PATCH(request: Request) {
  try {
    const adminCheck = await requireAdminUser();
    const isDev = process.env.NODE_ENV === 'development';
    if (!adminCheck && !isDev) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { userId, enabled, all } = body;

    const isBulk = Boolean(all || userId === 'all');

    if (!isBulk) {
      if (!userId || typeof enabled !== 'boolean') {
        return NextResponse.json(
          { error: 'userId (string) and enabled (boolean) are required' },
          { status: 400 }
        );
      }
    } else if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'enabled (boolean) is required' },
        { status: 400 }
      );
    }

    // Bulk update for all users combinely
    if (isBulk) {
      try {
        await supabaseAdmin
          .from('user_profiles')
          .update({ daily_email_enabled: enabled, updated_at: new Date().toISOString() })
          .neq('user_id', '00000000-0000-0000-0000-000000000000');
      } catch (dbErr) {
        console.warn('[daily-email] user_profiles bulk update fallback:', dbErr);
      }

      try {
        const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
        for (const u of usersData?.users || []) {
          const existingMeta = (u.user_metadata as Record<string, unknown> | undefined) || {};
          await supabaseAdmin.auth.admin.updateUserById(u.id, {
            user_metadata: {
              ...existingMeta,
              daily_email_enabled: enabled,
            },
          });
        }
      } catch (authErr) {
        console.warn('[daily-email] auth bulk update fallback:', authErr);
      }

      return NextResponse.json({
        success: true,
        all: true,
        dailyEmailEnabled: enabled,
        message: `Daily evaluation email notification ${enabled ? 'enabled' : 'disabled'} for all users.`,
      });
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'userId (string) and enabled (boolean) are required' },
        { status: 400 }
      );
    }

    // 1. Update in Supabase Auth user_metadata
    try {
      const { data: authUserData } = await supabaseAdmin.auth.admin.getUserById(userId);
      const existingMeta = (authUserData?.user?.user_metadata as Record<string, unknown> | undefined) || {};
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: {
          ...existingMeta,
          daily_email_enabled: enabled,
        },
      });
    } catch (authErr) {
      console.warn('[daily-email] Could not update auth user_metadata:', authErr);
    }

    // 2. Update in user_profiles table (with graceful fallback if column is missing)
    try {
      await supabaseAdmin
        .from('user_profiles')
        .update({ daily_email_enabled: enabled, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
    } catch (dbErr) {
      console.warn('[daily-email] user_profiles update fallback:', dbErr);
    }

    return NextResponse.json({
      success: true,
      userId,
      dailyEmailEnabled: enabled,
      message: `Daily evaluation email notification ${enabled ? 'enabled' : 'disabled'} for user.`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Error in PATCH /api/admin/zoho/users/daily-email:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
