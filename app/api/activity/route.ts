import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { blogServiceHeaders, blogServiceUrl } from '@/lib/blog-service';
import { computeStreak, istDateKey } from '@/lib/data/streak';
import {
  hasPassedQuiz,
  QUIZ_QUESTIONS_PER_ATTEMPT,
  summarizeAttemptRow,
} from '@/lib/quizzes/scoring';

function emptyDay(dateStr: string) {
  return {
    date: dateStr,
    read_seconds: 0,
    quiz_taken: false,
    quiz_started: false,
    quiz_passed: false,
    quiz_score: 0,
    quiz_total: QUIZ_QUESTIONS_PER_ATTEMPT,
    attempts: [] as Array<{
      attempt_number: number;
      correct_answers: number;
      total_questions: number;
      passed: boolean;
      in_progress: boolean;
      completed_at: string | null;
    }>,
  };
}

/** Prefer client-supplied local date; otherwise bucket the stamp in IST. */
function dayKeyFromStamp(stamp: string, metadataDate?: string | null): string {
  const fromMeta = String(metadataDate || '').match(/^(\d{4}-\d{2}-\d{2})/);
  if (fromMeta) return fromMeta[1];
  return istDateKey(new Date(stamp));
}

/**
 * True when a Supabase error means "this table does not exist".
 *
 * Two distinct codes can surface, depending on how far the query got:
 *  - `PGRST205` - PostgREST resolved the request against its cached schema and
 *    never reached Postgres ("Could not find the table ... in the schema cache").
 *    This is what supabase-js actually returns for an unmigrated table.
 *  - `42P01`    - Postgres' own `undefined_table`, raised when a statement does
 *    reach the database (e.g. via RPC or after a stale cache reload).
 *
 * The activity tables are optional gamification extras, so a missing table is
 * degraded to an empty result rather than a 500 that breaks the whole sidebar.
 */
function isMissingTableError(error: { code?: string } | null): boolean {
  return error?.code === 'PGRST205' || error?.code === '42P01';
}

async function recordQuizOnBlogService(userId: string, quizScore?: number, quizTotal?: number) {
  if (quizScore === undefined || quizTotal === undefined) {
    return;
  }
  try {
    await fetch(blogServiceUrl(`/profiles/${userId}/quiz`), {
      method: 'POST',
      headers: blogServiceHeaders(),
      body: JSON.stringify({ score: quizScore, total: quizTotal }),
    });
  } catch (err) {
    console.warn('Quiz result was not synced to the blog service:', err);
  }
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Fetch reading logs from user_activity_logs
    const { data: readLogs, error: readError } = await supabaseAdmin
      .from('user_activity_logs')
      .select('created_at, metadata')
      .eq('user_id', user.id)
      .eq('action_type', 'article_read');

    if (readError && !isMissingTableError(readError)) {
      throw readError;
    }

    // 2. Fetch quiz attempts. Started attempts count towards the streak too, so
    // this is not filtered to `status = 'completed'`.
    const { data: quizAttempts, error: quizError } = await supabaseAdmin
      .from('quiz_attempts')
      .select('*, quiz_answers(is_correct, created_at)')
      .eq('user_id', user.id);

    if (quizError && !isMissingTableError(quizError)) {
      throw quizError;
    }

    // 3. Aggregate by Date (IST — same calendar as digests / Past Briefings)
    const dailyMap: Record<string, ReturnType<typeof emptyDay>> = {};

    // Process read logs
    if (readLogs) {
      for (const log of readLogs) {
        const dateStr = dayKeyFromStamp(
          log.created_at,
          log.metadata?.date ?? null,
        );
        if (!dailyMap[dateStr]) dailyMap[dateStr] = emptyDay(dateStr);

        const readSeconds = log.metadata?.read_seconds || 0;
        dailyMap[dateStr].read_seconds += readSeconds;
      }
    }

    // Process quiz attempts
    if (quizAttempts) {
      for (const attempt of quizAttempts) {
        // An attempt the user started but has not finished still marks the day
        // as engaged, so bucket on started_at when there is no completion.
        const stamp = attempt.completed_at || attempt.started_at;
        if (!stamp) continue;
        const dateStr = dayKeyFromStamp(stamp);
        if (!dailyMap[dateStr]) dailyMap[dateStr] = emptyDay(dateStr);

        dailyMap[dateStr].quiz_started = true;

        // Prefer per-attempt answer chunks so retries don't inflate day score.
        const summaries = summarizeAttemptRow(attempt);
        for (const summary of summaries) {
          dailyMap[dateStr].attempts.push({
            attempt_number: summary.attemptNumber,
            correct_answers: summary.correctAnswers,
            total_questions: summary.totalQuestions,
            passed: summary.passed,
            in_progress: summary.inProgress,
            completed_at: summary.completedAt,
          });
        }

        const finished = summaries.filter((s) => !s.inProgress);
        if (finished.length > 0) {
          dailyMap[dateStr].quiz_taken = true;
          for (const summary of finished) {
            if (summary.correctAnswers > dailyMap[dateStr].quiz_score) {
              dailyMap[dateStr].quiz_score = summary.correctAnswers;
              dailyMap[dateStr].quiz_total =
                summary.totalQuestions || QUIZ_QUESTIONS_PER_ATTEMPT;
            }
            if (summary.passed) dailyMap[dateStr].quiz_passed = true;
          }
        } else if (attempt.completed_at) {
          // Legacy rows without quiz_answers — keep a single-attempt score only.
          dailyMap[dateStr].quiz_taken = true;
          const rawScore = Number(attempt.score) || 0;
          const rawTotal = Number(attempt.total_questions) || QUIZ_QUESTIONS_PER_ATTEMPT;
          const isCumulative =
            rawTotal > QUIZ_QUESTIONS_PER_ATTEMPT &&
            rawTotal % QUIZ_QUESTIONS_PER_ATTEMPT === 0;
          const total = isCumulative ? QUIZ_QUESTIONS_PER_ATTEMPT : rawTotal;
          const score = isCumulative
            ? Math.round((rawScore / rawTotal) * QUIZ_QUESTIONS_PER_ATTEMPT)
            : rawScore;
          if (score > dailyMap[dateStr].quiz_score) {
            dailyMap[dateStr].quiz_score = score;
            dailyMap[dateStr].quiz_total = total;
          } else if (dailyMap[dateStr].quiz_score === 0) {
            dailyMap[dateStr].quiz_score = score;
            dailyMap[dateStr].quiz_total = total;
          }
          if (hasPassedQuiz(score)) dailyMap[dateStr].quiz_passed = true;
        }

        if (!dailyMap[dateStr].quiz_passed) {
          dailyMap[dateStr].quiz_passed = hasPassedQuiz(dailyMap[dateStr].quiz_score);
        }
      }

      // Stable order: attempt 1 first within each day.
      for (const day of Object.values(dailyMap)) {
        day.attempts.sort((a, b) => a.attempt_number - b.attempt_number);
      }
    }

    const records = Object.values(dailyMap).sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

    // Anchor streak to IST "today" so it matches digest dates and Past Briefings.
    const istToday = istDateKey(new Date());
    const [y, m, d] = istToday.split('-').map(Number);
    const streakAnchor = new Date(y, m - 1, d);
    const streak = computeStreak(
      records.map((r) => ({
        date: r.date,
        readSeconds: r.read_seconds || 0,
        quizTaken: !!r.quiz_taken,
        quizStarted: !!r.quiz_started,
        quizScore: r.quiz_score || 0,
        quizTotal: r.quiz_total || 0,
      })),
      streakAnchor,
    );

    return NextResponse.json({
      success: true,
      records: records,
      streak
    });
  } catch (error: any) {
    console.error('Error in activity route:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { date, readSeconds, quizScore, quizTotal } = body;

    if (!date) {
      return NextResponse.json({ error: 'Date is required' }, { status: 400 });
    }

    let isSimulated = false;

    // Insert into user_activity_logs directly (since it is known to exist via migrations)
    if (readSeconds !== undefined && readSeconds > 0) {
      const { error } = await supabaseAdmin
        .from('user_activity_logs')
        .insert({
          user_id: user.id,
          action_type: 'article_read',
          metadata: { read_seconds: readSeconds, date: date }
        });
        
      if (error) {
        if (isMissingTableError(error)) isSimulated = true;
        else throw error;
      }
    }

    // Note: Quiz score is now automatically captured by fetching from `quiz_attempts` in GET /api/activity.
    // However, if we receive an explicit payload from an old client flow, we can also record a log.
    if (quizScore !== undefined) {
      const { error } = await supabaseAdmin
        .from('user_activity_logs')
        .insert({
          user_id: user.id,
          action_type: 'quiz_submit',
          metadata: { score: quizScore, total: quizTotal, date: date }
        });
        
      if (error) {
        if (isMissingTableError(error)) isSimulated = true;
        else throw error;
      }
      await recordQuizOnBlogService(user.id, quizScore, quizTotal);
    }

    return NextResponse.json({ success: true, message: isSimulated ? 'Simulated activity log' : 'Activity logged successfully' });
  } catch (error: any) {
    console.error('Error in activity POST:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
