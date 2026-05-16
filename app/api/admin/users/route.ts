import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

const ADMIN_EMAIL = 'priya.dhanani@creolestudios.com';

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || user.email?.toLowerCase() !== ADMIN_EMAIL) {
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

    // Merge users with their profiles (if they exist), excluding the admin
    const mergedUsers = authData.users
      .filter((authUser) => authUser.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase())
      .map((authUser) => {
        const profile = profiles?.find((p) => p.user_id === authUser.id) || {};
        return {
          user_id: authUser.id,
          email: authUser.email,
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
