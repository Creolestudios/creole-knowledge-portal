import { NextResponse } from 'next/server';
import { supabaseAdmin, requireAdminUser } from '@/lib/supabase/admin';

export async function GET() {
  try {
    if (!(await requireAdminUser())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all authenticated users
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.listUsers();
    if (authError) throw authError;

    // Fetch all profiles
    const { data: profiles, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('*');
    if (profileError) throw profileError;

    // Merge users with their profiles (if they exist)
    const mergedUsers = authData.users
      .map((authUser) => {
        const profile = profiles?.find((p) => p.user_id === authUser.id) || {};
        const metaSubscriptions = (authUser.user_metadata as Record<string, unknown> | undefined)?.ai_subscriptions;
        const metaSeniorEmails = (authUser.user_metadata as Record<string, unknown> | undefined)?.senior_emails;
        const metaDailyEmail = (authUser.user_metadata as Record<string, unknown> | undefined)?.daily_email_enabled;
        const dailyEmailEnabled =
          profile.daily_email_enabled !== undefined
            ? Boolean(profile.daily_email_enabled)
            : metaDailyEmail !== undefined
            ? Boolean(metaDailyEmail)
            : true;
        return {
          user_id: authUser.id,
          email: authUser.email,
          role: profile.role || 'user',
          current_role: profile.current_role || '',
          years_of_experience: profile.years_of_experience || null,
          current_tech_stack: profile.current_tech_stack || [],
          primary_tech_stack: profile.primary_tech_stack || [],
          secondary_tech_stack: profile.secondary_tech_stack || [],
          future_interests: profile.future_interests || '',
          ai_subscriptions: profile.ai_subscriptions || (Array.isArray(metaSubscriptions) ? metaSubscriptions : []),
          senior_emails: profile.senior_emails || (Array.isArray(metaSeniorEmails) ? metaSeniorEmails : []),
          daily_email_enabled: dailyEmailEnabled,
          updated_at: profile.updated_at || authUser.updated_at,
        };
      });

    // Sort by most recently updated
    mergedUsers.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

    return NextResponse.json(mergedUsers);
  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    if (!(await requireAdminUser())) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      user_id,
      email,
      role,
      current_role,
      years_of_experience,
      primary_tech_stack,
      secondary_tech_stack,
      future_interests,
      ai_subscriptions,
      senior_emails,
      daily_email_enabled,
    } = body;

    if (!user_id) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const subscriptionsList = Array.isArray(ai_subscriptions) ? ai_subscriptions : [];
    const seniorEmailsList = Array.isArray(senior_emails)
      ? senior_emails
          .map((item: unknown) => (typeof item === 'string' ? item.trim() : ''))
          .filter((item: string) => Boolean(item))
      : [];
    const isDailyEmailEnabled = daily_email_enabled !== undefined ? Boolean(daily_email_enabled) : true;

    // 1. Persist in Supabase Auth user_metadata (schema-free, resilient to database migrations)
    try {
      const { data: authUserData } = await supabaseAdmin.auth.admin.getUserById(user_id);
      const existingMeta = (authUserData?.user?.user_metadata as Record<string, unknown> | undefined) || {};
      await supabaseAdmin.auth.admin.updateUserById(user_id, {
        user_metadata: {
          ...existingMeta,
          ai_subscriptions: subscriptionsList,
          senior_emails: seniorEmailsList,
          daily_email_enabled: isDailyEmailEnabled,
        },
      });
    } catch (authErr) {
      console.warn('Could not update user_metadata in auth:', authErr);
    }

    // 2. Base profile upsert payload
    const basePayload = {
      user_id,
      email,
      role: role || 'user',
      current_role,
      years_of_experience,
      primary_tech_stack,
      secondary_tech_stack,
      future_interests,
      updated_at: new Date().toISOString(),
    };

    // 3. Try upserting with ai_subscriptions, senior_emails, and daily_email_enabled first
    let result = await supabaseAdmin
      .from('user_profiles')
      .upsert({
        ...basePayload,
        ai_subscriptions: subscriptionsList,
        senior_emails: seniorEmailsList,
        daily_email_enabled: isDailyEmailEnabled,
      }, {
        onConflict: 'user_id',
      })
      .select('*')
      .single();

    // 4. Fallback if new columns have not been added to user_profiles table yet
    if (result.error && (
      result.error.message?.includes('ai_subscriptions') ||
      result.error.message?.includes('senior_emails') ||
      result.error.message?.includes('daily_email_enabled') ||
      result.error.code === 'PGRST204'
    )) {
      console.warn('ai_subscriptions, senior_emails, or daily_email_enabled column not found in user_profiles table, retrying upsert with fallback');
      result = await supabaseAdmin
        .from('user_profiles')
        .upsert(basePayload, {
          onConflict: 'user_id',
        })
        .select('*')
        .single();
    }

    if (result.error) {
      console.error('Database error in PUT /api/admin/users:', result.error);
      throw result.error;
    }

    const responseData = {
      ...result.data,
      ai_subscriptions: result.data?.ai_subscriptions || subscriptionsList,
      senior_emails: result.data?.senior_emails || seniorEmailsList,
      daily_email_enabled: result.data?.daily_email_enabled !== undefined ? result.data.daily_email_enabled : isDailyEmailEnabled,
    };

    return NextResponse.json({ success: true, data: responseData });
  } catch (error: any) {
    console.error('API Error in PUT /api/admin/users:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const admin = await requireAdminUser();
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    if (userId === admin.userId) {
      return NextResponse.json({ error: 'You cannot delete your own admin account' }, { status: 400 });
    }

    // 1. Delete from Supabase Auth
    const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (authDeleteError) {
      console.warn('Warning: Could not delete user from auth, deleting from profile:', authDeleteError);
      const { error: profileDeleteError } = await supabaseAdmin
        .from('user_profiles')
        .delete()
        .eq('user_id', userId);

      if (profileDeleteError) {
        throw profileDeleteError;
      }
    } else {
      // Also ensure profile row is cleared
      await supabaseAdmin.from('user_profiles').delete().eq('user_id', userId);
    }

    return NextResponse.json({ success: true, message: 'User deleted successfully' });
  } catch (error: unknown) {
    console.error('API Error in DELETE /api/admin/users:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete user';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

