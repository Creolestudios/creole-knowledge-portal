import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  try {
    // 1. Authenticate user
    let userId: string | null = null;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (user) {
      userId = user.id;
    } else {
      // Mock bypass support for local testing/CI
      const isMock = request.headers.get('cookie')?.includes('mock-user=true') || 
                     request.url.includes('mockUser=true');
      if (isMock) {
        userId = 'b632b1ab-71e5-48ca-ab5d-b431c4e65004';
      }
    }

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Default/Mock stats structure
    let xp = 0;
    let level = 1;
    let coins = 0;
    let currentStreak = 0;
    let longestStreak = 0;
    let lastActiveDate = '';
    let streakFreezes = 1;
    let badges: any[] = [];
    
    let dailyQuizCompleted = false;
    let dailyQuizResult: any = null;

    // Load from cookie if exists (for mock/local persistence across reloads!)
    const cookieVal = request.headers.get('cookie');
    let savedStats: any = null;
    if (cookieVal) {
      const match = cookieVal.match(/mock_gamification_stats=([^;]+)/);
      if (match) {
        try {
          savedStats = JSON.parse(decodeURIComponent(match[1]));
        } catch (e) {}
      }
    }

    if (savedStats) {
      xp = savedStats.xp ?? 0;
      level = savedStats.level ?? 1;
      coins = savedStats.coins ?? 0;
      currentStreak = savedStats.currentStreak ?? 0;
      longestStreak = savedStats.longestStreak ?? 0;
      lastActiveDate = savedStats.lastActiveDate ?? '';
      badges = savedStats.badges ?? [];
      dailyQuizCompleted = savedStats.dailyQuizCompleted ?? false;
      dailyQuizResult = savedStats.dailyQuizResult ?? null;
    } else {
      // Default fallback starter values
      xp = 320;
      level = 2;
      coins = 85;
      currentStreak = 3;
      longestStreak = 7;
      lastActiveDate = new Date().toISOString().split('T')[0];
      badges = [
        {
          id: "knowledge-contributor",
          name: "Knowledge Contributor",
          description: "Synthesized or logged 5 technical activities.",
          rarity: "common",
          unlocked_at: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()
        }
      ];
    }

    let hasRealDbRecords = false;

    // 3. Try reading from real database
    try {
      // Fetch user profile values
      const { data: profile, error: pErr } = await supabaseAdmin
        .from('user_profiles')
        .select('*')
        .eq('user_id', userId)
        .single();
      
      if (!pErr && profile) {
        hasRealDbRecords = true;
        xp = profile.xp || 0;
        level = profile.level || 1;
        coins = profile.coins || 0;
      }

      // Fetch streak values
      const { data: streakRecord, error: sErr } = await supabaseAdmin
        .from('streaks')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (!sErr && streakRecord) {
        hasRealDbRecords = true;
        currentStreak = streakRecord.current_streak;
        longestStreak = streakRecord.longest_streak;
        lastActiveDate = streakRecord.last_active_date;
        streakFreezes = streakRecord.streak_freezes;
      }

      // Fetch user badges
      const { data: userBadges, error: ubErr } = await supabaseAdmin
        .from('user_badges')
        .select('unlocked_at, badge_id, badges(name, description, rarity)')
        .eq('user_id', userId);

      if (!ubErr && userBadges && userBadges.length > 0) {
        hasRealDbRecords = true;
        badges = userBadges.map((ub: any) => ({
          id: ub.badge_id,
          name: ub.badges?.name || ub.badge_id,
          description: ub.badges?.description || '',
          rarity: ub.badges?.rarity || 'common',
          unlocked_at: ub.unlocked_at
        }));
      }
    } catch (dbErr) {
      console.warn('[DB Error] Failed to read gamification tables, falling back to fully simulated mock dataset.', dbErr);
    }

    // 4. Check if daily quiz has already been completed today
    const todayStr = new Date().toISOString().split('T')[0];

    try {
      const { data: todayAttempt } = await supabaseAdmin
        .from('quiz_attempts')
        .select('*')
        .eq('user_id', userId)
        .gte('created_at', `${todayStr}T00:00:00.000Z`)
        .order('created_at', { ascending: false })
        .limit(1);

      if (todayAttempt && todayAttempt.length > 0) {
        dailyQuizCompleted = true;
        const attempt = todayAttempt[0];
        dailyQuizResult = {
          score: attempt.score,
          totalQuestions: attempt.total_questions,
          isPerfect: attempt.score === attempt.total_questions,
          xpEarned: attempt.xp_earned,
          coinsEarned: attempt.score * 5 + (attempt.score === attempt.total_questions ? 25 : 0),
          gradedAnswers: attempt.answers
        };
      }
    } catch (e) {
      console.warn('[DB Check] quiz_attempts daily lookup skipped.', e);
    }

    return NextResponse.json({
      success: true,
      data: {
        userId,
        simulated: !hasRealDbRecords,
        dailyQuizCompleted,
        dailyQuizResult,
        profile: {
          xp,
          level,
          coins,
          xpRequiredForNextLevel: Math.round(100 * Math.pow(level, 1.8)),
          xpRequiredProgress: Math.round(100 * Math.pow(level - 1, 1.8))
        },
        streak: {
          currentStreak,
          longestStreak,
          lastActiveDate,
          streakFreezes
        },
        badges
      }
    });

  } catch (error: any) {
    console.error('Streaks API error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
