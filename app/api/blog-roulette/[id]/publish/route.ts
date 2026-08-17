import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireAdminUser } from '@/lib/supabase/admin';
import { runPublishPipeline } from '@/lib/blog-roulette/publisher';
import { requireUserAndBlog } from '@/lib/blog-roulette/route-helpers';

export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();

  const auth = await requireUserAndBlog(supabase, id);
  if ('error' in auth) return auth.error;
  const { user, blog } = auth;

  // Authorization check: must be the author OR the admin
  const isAuthor = blog.author_id === user.id;
  const admin = await requireAdminUser();
  const isAdmin = !!admin;

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
