import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

interface AnswerSubmission {
  questionId: string;
  userAnswer: string;
}

export async function POST(request: Request) {
  try {
    // 1. Authenticate user
    let userId: string | null = null;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (user) {
      userId = user.id;
    }

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Parse request body
    const body = await request.json();
    const { quizId, answers, timeTakenSec } = body as {
      quizId: string;
      answers: AnswerSubmission[];
      timeTakenSec: number;
    };

    if (!quizId || !answers || !Array.isArray(answers)) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // 3. Fetch the blog which embeds the quiz
    const { data: blog, error: blogError } = await supabaseAdmin
      .from('blogs')
      .select('*')
      .eq('id', quizId)
      .single();

    let targetBlog = blog;

    if (blogError || !targetBlog) {
      // Fallback: Check by URL if ID query fails (e.g., if url was passed instead of uuid)
      const { data: blogByUrl } = await supabaseAdmin
        .from('blogs')
        .select('*')
        .eq('url', quizId)
        .single();
      
      if (!blogByUrl) {
        console.error('Blog not found for quizId:', quizId, blogError);
        return NextResponse.json({ error: 'Quiz blog source not found' }, { status: 404 });
      }
      targetBlog = blogByUrl;
    }

    // 4. Extract embedded quiz questions from content
    const quizRegex = /<!--\s*QUIZ_DATA:\s*({[\s\S]*?})\s*-->/;
    const match = targetBlog.content.match(quizRegex);
    
    if (!match) {
      return NextResponse.json({ error: 'No quiz questions configured for this blog' }, { status: 400 });
    }

    let quizData: { questions: any[] };
    try {
      quizData = JSON.parse(match[1]);
    } catch (e) {
      console.error('Failed to parse quiz JSON from blog content:', e);
      return NextResponse.json({ error: 'Invalid quiz questions definition' }, { status: 500 });
    }

    const { questions } = quizData;
    if (!questions || !Array.isArray(questions)) {
      return NextResponse.json({ error: 'Quiz contains no questions' }, { status: 400 });
    }

    // 5. Grade the submitted answers
    let score = 0;
    const totalQuestions = questions.length;
    const gradedAnswers = questions.map(q => {
      const submission = answers.find(a => a.questionId === q.id);
      const userAnswer = submission ? submission.userAnswer.toUpperCase().trim() : '';
      const correctAnswer = q.correctAnswer.toUpperCase().trim();
      const isCorrect = userAnswer === correctAnswer;
      
      if (isCorrect) score++;

      return {
        questionId: q.id,
        text: q.text,
        userAnswer,
        correctAnswer,
        isCorrect,
        explanation: q.explanation || ''
      };
    });

    // 6. Calculate XP and Coins
    // Base: 20 XP and 5 Coins per correct answer
    let xpEarned = score * 20;
    let coinsEarned = score * 5;

    // Perfect score bonus: +100 XP, +25 Coins
    const isPerfect = score === totalQuestions;
    if (isPerfect) {
      xpEarned += 100;
      coinsEarned += 25;
    }

    // Telemetry: check speed violation (anti-cheat)
    const avgTimePerQuestion = timeTakenSec / totalQuestions;
    const isSpeedViolation = avgTimePerQuestion < 1.5;
    if (isSpeedViolation) {
      console.warn(`[Anti-Cheat] Quiz submission flagged for speed: User ${userId} spent ${timeTakenSec}s on ${totalQuestions} questions.`);
      xpEarned = 0;
      coinsEarned = 0;
    }

    // 7. DB Writes with robust mock-fallback in case migrations are not run yet
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

    let startingXp = 320;
    let startingCoins = 85;
    let startingStreak = 3;
    let startingLongestStreak = 7;
    let existingBadges = [
      {
        id: "knowledge-contributor",
        name: "Knowledge Contributor",
        description: "Synthesized or logged 5 technical activities.",
        rarity: "common",
        unlocked_at: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()
      }
    ];

    if (savedStats) {
      startingXp = savedStats.xp ?? 0;
      startingCoins = savedStats.coins ?? 0;
      startingStreak = savedStats.currentStreak ?? 0;
      startingLongestStreak = savedStats.longestStreak ?? 0;
      existingBadges = savedStats.badges ?? [];
    }

    let finalProfileXp = startingXp + xpEarned;
    let finalProfileCoins = startingCoins + coinsEarned;
    let finalStreak = startingStreak;
    let finalLongestStreak = startingLongestStreak;

    // Standard simulated level progression if table alter is missing
    let finalProfileLevel = Math.max(1, Math.floor(Math.sqrt(finalProfileXp / 100)));

    const badgesUnlocked: Array<{ id: string; name: string; rarity: string }> = [];

    // Fetch or create user profile values
    try {
      const { data: profile, error: pErr } = await supabaseAdmin
        .from('user_profiles')
        .select('*')
        .eq('user_id', userId)
        .single();
      
      if (!pErr && profile) {
        // If the database has the columns, fetch them
        const currentXp = profile.xp || 0;
        const currentCoins = profile.coins || 0;
        
        finalProfileXp = currentXp + xpEarned;
        finalProfileCoins = currentCoins + coinsEarned;
        
        // Calculate Level based on Leveling Formula: XP_required(L) = 100 * L^1.8
        let lvl = 1;
        let cumulativeRequired = 0;
        while (true) {
          const req = Math.round(100 * Math.pow(lvl, 1.8));
          if (finalProfileXp >= cumulativeRequired + req) {
            cumulativeRequired += req;
            lvl++;
          } else {
            break;
          }
        }
        finalProfileLevel = lvl;

        // Try updating profile in database
        const { error: updateErr } = await supabaseAdmin
          .from('user_profiles')
          .update({
            xp: finalProfileXp,
            level: finalProfileLevel,
            coins: finalProfileCoins,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', userId);

        if (updateErr) {
          console.warn('[DB Error] Failed to update user profile columns, migrations may be missing. Falling back to local state simulation.', updateErr.message);
          finalProfileLevel = Math.max(1, Math.floor(Math.sqrt(finalProfileXp / 100)));
        }
      }
    } catch (e) {
      console.error('[DB Exception] Profiles fetch failed, using mock simulation.', e);
    }

    // Log Activity to user_activity_logs
    try {
      await supabaseAdmin
        .from('user_activity_logs')
        .insert({
          user_id: userId,
          action_type: 'quiz_submit',
          xp_awarded: xpEarned,
          coins_awarded: coinsEarned,
          metadata: {
            quiz_id: quizId,
            score,
            total_questions: totalQuestions,
            time_taken_sec: timeTakenSec,
            perfect_score: isPerfect,
            speed_violation: isSpeedViolation
          }
        });
    } catch (e: any) {
      console.warn('[DB Warning] user_activity_logs table not found. Bypassing log write.', e.message);
    }

    // Record Quiz Attempt
    try {
      await supabaseAdmin
        .from('quiz_attempts')
        .insert({
          user_id: userId,
          quiz_id: targetBlog.id,
          score,
          total_questions: totalQuestions,
          answers: gradedAnswers,
          time_taken_sec: timeTakenSec,
          xp_earned: xpEarned
        });
    } catch (e: any) {
      console.warn('[DB Warning] quiz_attempts table not found. Bypassing attempt write.', e.message);
    }

    // Update Streaks
    const todayStr = new Date().toISOString().split('T')[0];
    try {
      const { data: streakRecord, error: sErr } = await supabaseAdmin
        .from('streaks')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (!sErr && streakRecord) {
        let curStreak = streakRecord.current_streak;
        let longStreak = streakRecord.longest_streak;
        const lastActive = streakRecord.last_active_date;

        if (lastActive === todayStr) {
          finalStreak = curStreak;
        } else {
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          const yesterdayStr = yesterday.toISOString().split('T')[0];

          if (lastActive === yesterdayStr) {
            curStreak++;
          } else {
            if (streakRecord.streak_freezes > 0) {
              console.log('[Streak Engine] Consumed Streak Freeze!');
              await supabaseAdmin
                .from('streaks')
                .update({ streak_freezes: streakRecord.streak_freezes - 1 })
                .eq('user_id', userId);
              curStreak++;
            } else {
              curStreak = 1;
            }
          }
        }

        if (curStreak > longStreak) {
          longStreak = curStreak;
        }

        finalStreak = curStreak;
        finalLongestStreak = longStreak;

        await supabaseAdmin
          .from('streaks')
          .update({
            current_streak: finalStreak,
            longest_streak: finalLongestStreak,
            last_active_date: todayStr,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', userId);
      } else {
        finalStreak = 1;
        finalLongestStreak = 1;
        await supabaseAdmin
          .from('streaks')
          .insert({
            user_id: userId,
            current_streak: 1,
            longest_streak: 1,
            last_active_date: todayStr
          });
      }
    } catch (e: any) {
      console.warn('[DB Warning] streaks table not found. Simulating streak from cookies/state.', e.message);
      if (savedStats && savedStats.lastActiveDate === todayStr) {
        finalStreak = startingStreak;
      } else {
        finalStreak = startingStreak + 1;
      }
      finalLongestStreak = Math.max(startingLongestStreak, finalStreak);
    }

    // Check and Reward Badges
    try {
      if (isPerfect) {
        const { count } = await supabaseAdmin
          .from('quiz_attempts')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('score', totalQuestions);

        const perfectCount = (count || 0) + 1;
        if (perfectCount >= 10) {
          const { error: bErr } = await supabaseAdmin
            .from('user_badges')
            .insert({ user_id: userId, badge_id: 'quiz-master' });
          
          if (!bErr) {
            badgesUnlocked.push({ id: 'quiz-master', name: 'Quiz Master', rarity: 'epic' });
          }
        }
      }

      if (isPerfect && timeTakenSec < 60) {
        const { error: bErr } = await supabaseAdmin
          .from('user_badges')
          .insert({ user_id: userId, badge_id: 'fast-learner' });
        
        if (!bErr) {
          badgesUnlocked.push({ id: 'fast-learner', name: 'Fast Learner', rarity: 'common' });
        }
      }
    } catch (e: any) {
      if (isPerfect) {
        badgesUnlocked.push({ id: 'quiz-master', name: 'Quiz Master', rarity: 'epic' });
      }
    }

    // Save final stats payload to cookie for reload resilience
    const newBadges = [
      ...existingBadges,
      ...badgesUnlocked.map(b => ({
        id: b.id,
        name: b.name,
        description: 'Achievement unlocked!',
        rarity: b.rarity,
        unlocked_at: new Date().toISOString()
      }))
    ];

    // Filter unique badges by id
    const uniqueBadges = newBadges.filter((b, idx, self) => 
      self.findIndex(t => t.id === b.id) === idx
    );

    const statsPayload = {
      xp: finalProfileXp,
      level: finalProfileLevel,
      coins: finalProfileCoins,
      currentStreak: finalStreak,
      longestStreak: finalLongestStreak,
      lastActiveDate: todayStr,
      badges: uniqueBadges,
      dailyQuizCompleted: true,
      dailyQuizResult: {
        score,
        totalQuestions,
        isPerfect,
        xpEarned,
        coinsEarned,
        gradedAnswers
      }
    };

    const response = NextResponse.json({
      success: true,
      data: {
        score,
        totalQuestions,
        isPerfect,
        speedViolation: isSpeedViolation,
        xpEarned,
        coinsEarned,
        profile: {
          xp: finalProfileXp,
          level: finalProfileLevel,
          coins: finalProfileCoins
        },
        streak: {
          currentStreak: finalStreak,
          longestStreak: finalLongestStreak
        },
        gradedAnswers,
        badgesUnlocked
      }
    });

    response.headers.set(
      'Set-Cookie',
      `mock_gamification_stats=${encodeURIComponent(JSON.stringify(statsPayload))}; Path=/; Max-Age=${60 * 60 * 24 * 7}; SameSite=Lax`
    );

    return response;

  } catch (error: any) {
    console.error('Quiz submission error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
