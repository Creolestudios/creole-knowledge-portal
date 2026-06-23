import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { runPublishPipeline } from '@/lib/blog-roulette/publisher';

export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Get the blog to publish
  const { data: blog } = await supabase
    .from('roulette_blogs')
    .select('*')
    .eq('id', id)
    .single();

  if (!blog) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Authorization check: must be the author OR the admin Priya
  const isAuthor = blog.author_id === user.id;
  const isAdmin = user.email?.toLowerCase().trim() === 'priya.dhanani@creolestudios.com';

  if (!isAuthor && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Check state machine: allow retry if status is PASSED, PUBLISHING (re-run), or PUBLISH_FAILED
  if (
    blog.status !== 'PASSED' &&
    blog.status !== 'PUBLISH_FAILED' &&
    blog.status !== 'PUBLISHING'
  ) {
    return NextResponse.json(
      { error: `Cannot publish blog in status: ${blog.status}` },
      { status: 409 }
    );
  }

  try {
    const result = await runPublishPipeline(id, supabase, user.email || '');
    return NextResponse.json({ ok: true, ...result });
  } catch (err: any) {
    console.error('[publish/route] Publish pipeline error:', err);
    return NextResponse.json(
      { error: err.message || 'Publishing failed.' },
      { status: 500 }
    );
  }
}
