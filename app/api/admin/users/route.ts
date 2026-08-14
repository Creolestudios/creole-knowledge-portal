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
    } = body;

    if (!user_id) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('user_profiles')
      .upsert({
        user_id,
        email,
        role: role || 'user',
        current_role,
        years_of_experience,
        primary_tech_stack,
        secondary_tech_stack,
        future_interests,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      })
      .select('*')
      .single();

    if (error) {
      console.error('Database error in PUT /api/admin/users:', error);
      throw error;
    }

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('API Error in PUT /api/admin/users:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

