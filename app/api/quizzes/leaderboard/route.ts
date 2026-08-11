import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const blogId = searchParams.get('blogId');

    // Build the query
    let query = supabaseAdmin
      .from('quiz_attempts')
      .select(`
        id,
        user_id,
        score,
        percentage,
        time_taken_seconds,
        completed_at,
        blog_id
      `)
      .eq('status', 'completed')
      .order('score', { ascending: false })
      .order('time_taken_seconds', { ascending: true })
      .order('completed_at', { ascending: true })
      .limit(50);

    // Filter by specific blog if requested
    if (blogId) {
      query = query.eq('blog_id', blogId);
    }

    const { data: attempts, error } = await query;

    if (error) {
      throw error;
    }

    // Fetch user profiles separately to avoid Foreign Key schema cache issues
    const userIds = [...new Set((attempts || []).map(a => a.user_id))];
    const profilesMap: Record<string, any> = {};
    
    if (userIds.length > 0) {
      const { data: { users }, error: authError } = await supabaseAdmin.auth.admin.listUsers();
      if (!authError && users) {
        users.forEach((u: any) => {
          profilesMap[u.id] = { 
            email: u.email, 
            current_role: u.user_metadata?.current_role || 'Developer' 
          };
        });
      }
    }

    // Format the response
    const leaderboard = (attempts || []).map((attempt: any, index: number) => {
      const profile = profilesMap[attempt.user_id] || { email: 'anonymous@user.com', current_role: 'Developer' };
      return {
        rank: index + 1,
        userId: attempt.user_id,
        userName: profile.email.split('@')[0], // Use email handle as name
        role: profile.current_role || 'Developer',
        score: attempt.score,
        percentage: attempt.percentage,
        timeTaken: attempt.time_taken_seconds
      };
    });

    return NextResponse.json({
      success: true,
      leaderboard
    });

  } catch (error: any) {
    console.error('Leaderboard fetch error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
