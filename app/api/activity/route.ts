import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { blogServiceHeaders, blogServiceUrl } from '@/lib/blog-service';

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

    // 2. Fetch quiz attempts
    const { data: quizAttempts, error: quizError } = await supabaseAdmin
      .from('quiz_attempts')
      .select('completed_at, score, total_questions')
      .eq('user_id', user.id)
      .eq('status', 'completed');

    if (quizError && !isMissingTableError(quizError)) {
      throw quizError;
    }

    // 3. Aggregate by Date
    const dailyMap: Record<string, any> = {};

    // Process read logs
    if (readLogs) {
      for (const log of readLogs) {
        const dateObj = new Date(log.created_at);
        const dateStr = dateObj.toISOString().split('T')[0];
        if (!dailyMap[dateStr]) dailyMap[dateStr] = { date: dateStr, read_seconds: 0, quiz_taken: false, quiz_score: 0, quiz_total: 0 };
        
        const readSeconds = log.metadata?.read_seconds || 0;
        dailyMap[dateStr].read_seconds += readSeconds;
      }
    }

    // Process quiz attempts
    if (quizAttempts) {
      for (const attempt of quizAttempts) {
        if (!attempt.completed_at) continue;
        const dateObj = new Date(attempt.completed_at);
        const dateStr = dateObj.toISOString().split('T')[0];
        if (!dailyMap[dateStr]) dailyMap[dateStr] = { date: dateStr, read_seconds: 0, quiz_taken: false, quiz_score: 0, quiz_total: 0 };
        
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
    }

    const records = Object.values(dailyMap).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Calculate basic streak
    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let currentDate = new Date(today);

    for (const r of records) {
      const rDate = new Date((r as any).date);
      rDate.setHours(0, 0, 0, 0);

      // If it's today or yesterday and read_seconds > 0 or quiz taken, we can start counting
      if (rDate.getTime() === currentDate.getTime() || rDate.getTime() === currentDate.getTime() - 86400000) {
        if ((r as any).read_seconds > 0 || (r as any).quiz_taken) {
          streak++;
          currentDate = rDate;
          currentDate.setDate(currentDate.getDate() - 1);
        } else {
          break;
        }
      } else {
        break;
      }
    }

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
