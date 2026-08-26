import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function GET() {
  try {
    // 1. Get all users from auth
    const { data: { users }, error: authError } = await supabaseAdmin.auth.admin.listUsers();
    if (authError) throw authError;

    // 2. Get all activity logs for read time
    const { data: readLogs, error: readError } = await supabaseAdmin
      .from('user_activity_logs')
      .select('user_id, metadata')
      .eq('action_type', 'article_read');
    
    // Ignore missing table errors for optional gamification tables
    if (readError && readError.code !== 'PGRST205' && readError.code !== '42P01') {
      throw readError;
    }

    // 3. Get all quiz attempts for scores
    const { data: quizAttempts, error: quizError } = await supabaseAdmin
      .from('quiz_attempts')
      .select('user_id, score')
      .eq('status', 'completed');
      
    if (quizError && quizError.code !== 'PGRST205' && quizError.code !== '42P01') {
      throw quizError;
    }

    // 4. Get xp/level from user_profiles
    let profiles: any = null;
    const { data: fullProfiles, error: pError } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, xp, level, coins, current_role');
      
    if (pError) {
      console.warn('Leaderboard: Gamification columns missing in user_profiles. Falling back to basic profile fetch.', pError.message);
      // Fallback: columns might not exist if gamification migration wasn't run
      const { data: basicProfiles, error: basicError } = await supabaseAdmin
        .from('user_profiles')
        .select('user_id, current_role');
        
      if (!basicError) {
        profiles = basicProfiles;
      }
    } else {
      profiles = fullProfiles;
    }
    
    // 5. Aggregate metrics per user
    const leaderboardMap: Record<string, any> = {};

    for (const user of users) {
      leaderboardMap[user.id] = {
        userId: user.id,
        email: user.email,
        readTimeSec: 0,
        totalScore: 0,
        xp: 0,
        level: 1,
        role: 'Reader'
      };
    }

    if (profiles) {
      for (const p of profiles) {
        if (leaderboardMap[p.user_id]) {
          leaderboardMap[p.user_id].xp = p.xp || 0;
          leaderboardMap[p.user_id].level = p.level || 1;
          leaderboardMap[p.user_id].role = p.current_role || 'Reader';
        }
      }
    }

    if (readLogs) {
      for (const log of readLogs) {
        if (leaderboardMap[log.user_id]) {
          leaderboardMap[log.user_id].readTimeSec += log.metadata?.read_seconds || 0;
        }
      }
    }

    if (quizAttempts) {
      for (const q of quizAttempts) {
        if (leaderboardMap[q.user_id]) {
          leaderboardMap[q.user_id].totalScore += q.score || 0;
        }
      }
    }

    // 6. Sort to determine rank
    // Primary: XP, Secondary: Total Score, Tertiary: Read Time
    const leaderboard = Object.values(leaderboardMap)
      // Only show users who have actually done something (or keep everyone, but let's keep all active users)
      .filter((u: any) => u.readTimeSec > 0 || u.totalScore > 0 || u.xp > 0)
      .sort((a: any, b: any) => {
        if (b.xp !== a.xp) return b.xp - a.xp;
        if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
        return b.readTimeSec - a.readTimeSec;
      });

    return NextResponse.json({ success: true, leaderboard });
  } catch (error: any) {
    console.error('Leaderboard fetch error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
