import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { BLOG_RULES } from '@/lib/blog-roulette/types';

export const runtime = 'nodejs';

const ADMIN_EMAIL = 'priya.dhanani@creolestudios.com';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  
  // 1. Authenticate the caller using standard client
  const clientSupabase = await createClient();
  const {
    data: { user },
  } = await clientSupabase.auth.getUser();
  
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const isAdmin = user.email?.toLowerCase().trim() === ADMIN_EMAIL;
  
  // Use supabaseAdmin to fetch/update if the user is an admin (to bypass RLS),
  // otherwise use standard client (so RLS is enforced).
  const supabase = isAdmin ? supabaseAdmin : clientSupabase;

  // Fetch the blog
  let query = supabase
    .from('roulette_blogs')
    .select('*')
    .eq('id', id);

  if (!isAdmin) {
    query = query.eq('author_id', user.id);
  }

  const { data: blog } = await query.single();
  if (!blog) {
    return NextResponse.json({ error: 'Blog not found' }, { status: 404 });
  }

  if (blog.status !== 'REJECTED') {
    return NextResponse.json(
      { error: 'Blog is not locked/rejected.' },
      { status: 400 }
    );
  }

  // If not admin, check lockout cooldown
  if (!isAdmin) {
    // Get the latest completed reject attempt
    const { data: latestAttempt } = await supabase
      .from('roulette_quiz_attempts')
      .select('*')
      .eq('blog_id', id)
      .eq('result', 'REJECT')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const rejectionTime = latestAttempt?.completed_at
      ? new Date(latestAttempt.completed_at).getTime()
      : new Date(blog.updated_at).getTime();

    const cooldownMs = BLOG_RULES.QUIZ_LOCKOUT_COOLDOWN_HOURS * 60 * 60 * 1000;
    const timePassed = Date.now() - rejectionTime;

    if (timePassed < cooldownMs) {
      const remainingMs = cooldownMs - timePassed;
      const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));
      return NextResponse.json(
        {
          error: `Blog is locked. You can unlock it in ${remainingHours} hours.`,
          remaining_ms: remainingMs,
        },
        { status: 403 }
      );
    }
  }

  // Reset blog status to DRAFT
  const { error: updateError } = await supabase
    .from('roulette_blogs')
    .update({ status: 'DRAFT' })
    .eq('id', id);

  if (updateError) {
    console.error('[blog-roulette/unlock] failed to reset blog:', updateError);
    return NextResponse.json({ error: 'Failed to reset blog status' }, { status: 500 });
  }

  // Delete all quiz attempts for this blog to start fresh
  const { error: deleteError } = await supabase
    .from('roulette_quiz_attempts')
    .delete()
    .eq('blog_id', id);

  if (deleteError) {
    console.error('[blog-roulette/unlock] failed to clear attempts:', deleteError);
  }

  return NextResponse.json({ ok: true });
}
