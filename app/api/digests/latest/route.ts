import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { blogServiceHeaders, blogServiceUrl } from '@/lib/blog-service';

/**
 * "Today" in IST (Asia/Kolkata) — must match the blog-service's own definition
 * of "today" (see `_todays_digest` in fetch-blogs/src/api/routes/digests.py).
 * Using the Node process's local timezone here (often UTC in production) would
 * disagree with IST for part of the day and cause an already-generated
 * digest to be wrongly treated as stale.
 */
function localDateKey(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function blogDateKey(blog: {
  digest_date?: string | null;
  published_at?: string | null;
  generated_at?: string | null;
  url?: string | null;
} | null): string {
  if (!blog) return '';
  const raw = blog.digest_date || blog.published_at || blog.generated_at || '';
  const match = String(raw).match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  // Idempotent Gemini fallback slug: briefing:{userId}:YYYY-MM-DD
  const slug = String(blog.url || '').match(/:(\d{4}-\d{2}-\d{2})$/);
  return slug ? slug[1] : '';
}

function isTodayBlog(blog: Parameters<typeof blogDateKey>[0]): boolean {
  const key = blogDateKey(blog);
  return Boolean(key) && key === localDateKey();
}

/**
 * Daily Blog "latest" = today's digest only.
 * Missing today → `{ blog: null }` so the UI shows Synthesize (never yesterday).
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = user.id;
    const today = localDateKey();

    try {
      const res = await fetch(
        blogServiceUrl(`/digests/${userId}/latest?today_only=true`),
        {
          headers: blogServiceHeaders(),
          cache: 'no-store',
        },
      );
      if (res.ok) {
        const payload = await res.json();
        // Trust FastAPI even when blog is null — that means "synthesize today".
        if (payload?.success) {
          const blog = payload.blog;
          if (!blog) {
            return NextResponse.json({ success: true, blog: null, meta: null });
          }
          if (isTodayBlog(blog)) {
            return NextResponse.json(payload);
          }
          // Stale / mis-dated payload — treat as missing today
          return NextResponse.json({ success: true, blog: null, meta: null });
        }
      }
    } catch (err) {
      console.warn('Blog service latest digest unavailable, falling back to Supabase:', err);
    }

    // FastAPI unreachable: only surface a same-day Supabase briefing (never older days).
    const { data: legacyBrief, error: legacyError } = await supabaseAdmin
      .from('blogs')
      .select('*')
      .eq('url', `briefing:${userId}:${today}`)
      .maybeSingle();

    if (legacyError) {
      console.error('Error fetching today briefing:', legacyError);
      return NextResponse.json({ error: legacyError.message }, { status: 500 });
    }

    if (legacyBrief && isTodayBlog(legacyBrief)) {
      return NextResponse.json({
        success: true,
        blog: { ...legacyBrief, digest_date: today },
        meta: null,
      });
    }

    // Last resort: newest briefing:* row, but only if dated today
    const { data: recentBriefs, error: recentError } = await supabaseAdmin
      .from('blogs')
      .select('*')
      .ilike('url', `briefing:${userId}:%`)
      .order('published_at', { ascending: false })
      .limit(1);

    if (recentError) {
      console.error('Error fetching legacy brief:', recentError);
      return NextResponse.json({ error: recentError.message }, { status: 500 });
    }

    const candidate = recentBriefs?.[0] ?? null;
    if (candidate && isTodayBlog(candidate)) {
      return NextResponse.json({
        success: true,
        blog: { ...candidate, digest_date: today },
        meta: null,
      });
    }

    return NextResponse.json({
      success: true,
      blog: null,
      meta: null,
    });
  } catch (error: unknown) {
    console.error('Error in digests/latest route:', error);
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
