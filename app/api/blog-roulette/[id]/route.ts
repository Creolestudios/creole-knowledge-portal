import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { updateBlogSchema } from '@/lib/blog-roulette/validators';

export const runtime = 'nodejs';

async function authBlog(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized' as const, status: 401, supabase: null, user: null };

  const { data: blog } = await supabase
    .from('roulette_blogs')
    .select('*')
    .eq('id', id)
    .eq('author_id', user.id)
    .single();
  if (!blog) return { error: 'Not found' as const, status: 404, supabase: null, user: null };

  return { error: null, status: 200, supabase, user, blog };
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const a = await authBlog(id);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });

  const [tags, keywords] = await Promise.all([
    a.supabase!.from('roulette_blog_tags').select('tag').eq('blog_id', id),
    a.supabase!.from('roulette_seo_keywords').select('*').eq('blog_id', id),
  ]);

  return NextResponse.json({
    blog: a.blog,
    tags: tags.data?.map((t) => t.tag) ?? [],
    keywords: keywords.data ?? [],
  });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const a = await authBlog(id);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });

  if (a.blog.status !== 'DRAFT') {
    return NextResponse.json(
      { error: 'Blog locked — cannot edit after submission' },
      { status: 409 },
    );
  }

  const body = await req.json();
  const parsed = updateBlogSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const { error } = await a
    .supabase!.from('roulette_blogs')
    .update(parsed.data)
    .eq('id', id);

  if (error) {
    console.error('[blog-roulette/update]', error);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  // Replace tags atomically if provided
  if (Array.isArray(body.tags)) {
    await a.supabase!.from('roulette_blog_tags').delete().eq('blog_id', id);
    if (body.tags.length > 0) {
      const tagRows = body.tags.map((tag: string) => ({ blog_id: id, tag }));
      await a.supabase!.from('roulette_blog_tags').insert(tagRows);
    }
  }

  return NextResponse.json({ ok: true });
}
