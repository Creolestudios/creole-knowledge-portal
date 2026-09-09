import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { blogServiceHeaders, blogServiceUrl } from '@/lib/blog-service';
import { computeStreak, istDateKey } from '@/lib/data/streak';
import { summarizeAttemptRow } from '@/lib/quizzes/scoring';
import { toValidUUID } from '@/lib/quizzes/review';

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

function digestDateFromBlog(blog: {
  id?: string;
  digest_date?: string;
  published_at?: string;
  url?: string;
} | null): string {
  if (!blog) return '';
  const fromFields = String(blog.digest_date || blog.published_at || '');
  const fieldMatch = fromFields.match(/^(\d{4}-\d{2}-\d{2})/);
  if (fieldMatch) return fieldMatch[1];
  const urlMatch = String(blog.url || '').match(/:(\d{4}-\d{2}-\d{2})/);
  return urlMatch ? urlMatch[1] : '';
}

/** Map quiz blog_id (UUID) → briefing calendar day (IST digest date). */
async function loadBlogDigestDateById(userId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const res = await fetch(blogServiceUrl(`/digests/${userId}/past`), {
      headers: blogServiceHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) return map;
    const payload = await res.json();
    for (const blog of payload?.blogs || []) {
      const key = digestDateFromBlog(blog);
      const id = blog?.id != null ? String(blog.id) : '';
      if (!key || !id) continue;
      map.set(toValidUUID(id), key);
      map.set(id, key);
    }
  } catch {
    // Past Blog unlock still works from attempt timestamps if digests are unavailable.
  }
  return map;
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

    const blogDigestById = await loadBlogDigestDateById(user.id);

    // 3. Aggregate by Date (IST — same calendar as Daily Blog / Past Briefings)
    const dailyMap: Record<string, any> = {};

    // Process read logs
    if (readLogs) {
      for (const log of readLogs) {
        const dateObj = new Date(log.created_at);
        const dateStr = istDateKey(dateObj);
        if (!dailyMap[dateStr]) dailyMap[dateStr] = { date: dateStr, read_seconds: 0, quiz_taken: false, quiz_started: false, quiz_score: 0, quiz_total: 0, attempts: [] };
        
        const readSeconds = log.metadata?.read_seconds || 0;
        dailyMap[dateStr].read_seconds += readSeconds;
      }
    }

    // Process quiz attempts — attribute to the briefing day of that blog, not
    // "the calendar day you happened to finish" (that wrongly unlocked Today).
    if (quizAttempts) {
      for (const attempt of quizAttempts) {
        const stamp = attempt.completed_at || attempt.started_at;
        if (!stamp) continue;
        const blogKey = attempt.blog_id != null ? String(attempt.blog_id) : '';
        const digestDay =
          (blogKey && (blogDigestById.get(toValidUUID(blogKey)) || blogDigestById.get(blogKey))) ||
          istDateKey(new Date(stamp));
        const dateStr = digestDay;
        if (!dailyMap[dateStr]) dailyMap[dateStr] = { date: dateStr, read_seconds: 0, quiz_taken: false, quiz_started: false, quiz_score: 0, quiz_total: 0, attempts: [] };

        dailyMap[dateStr].quiz_started = true;

        // Each attempt is listed on its own rather than merged into one total,
        // so the activity log can show attempt 1/2/3 separately.
        for (const summary of summarizeAttemptRow(attempt)) {
          dailyMap[dateStr].attempts.push({
            attempt_number: summary.attemptNumber,
            correct_answers: summary.correctAnswers,
            total_questions: summary.totalQuestions,
            passed: summary.passed,
            in_progress: summary.inProgress,
            completed_at: summary.completedAt,
          });
        }

        if (!attempt.completed_at) continue;

        dailyMap[dateStr].quiz_taken = true;
        // Keep the highest score of the day
        if (attempt.score > dailyMap[dateStr].quiz_score) {
          dailyMap[dateStr].quiz_score = attempt.score;
          dailyMap[dateStr].quiz_total = attempt.total_questions || 5;
        } else if (dailyMap[dateStr].quiz_score === 0) {
           // Default fallback
           dailyMap[dateStr].quiz_score = attempt.score;
           dailyMap[dateStr].quiz_total = attempt.total_questions || 5;
        }
      }

      // Stable order: attempt 1 first within each day.
      for (const day of Object.values(dailyMap)) {
        day.attempts.sort((a: any, b: any) => a.attempt_number - b.attempt_number);
      }
    }

    const records = Object.values(dailyMap).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Streak rules live in lib/data/streak.ts so the API and the UI agree:
    // weekends never break it (no briefing is generated), and a weekday counts
    // when there is reading time or a quiz the user started.
    const streak = computeStreak(
      (records as any[]).map((r) => ({
        date: r.date,
        readSeconds: r.read_seconds || 0,
        quizTaken: !!r.quiz_taken,
        quizStarted: !!r.quiz_started,
        quizScore: r.quiz_score || 0,
        quizTotal: r.quiz_total || 0,
      })),
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
