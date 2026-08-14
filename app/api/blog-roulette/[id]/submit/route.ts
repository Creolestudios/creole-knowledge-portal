import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { runCheckpoints } from '@/lib/blog-roulette/validators';
import { requireUserAndBlog } from '@/lib/blog-roulette/route-helpers';

export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();

  const auth = await requireUserAndBlog(supabase, id, { restrictToAuthor: true });
  if ('error' in auth) return auth.error;
  const { blog } = auth;

  if (blog.status !== 'DRAFT') {
    return NextResponse.json(
      { error: 'Blog already submitted' },
      { status: 409 },
    );
  }

  const { data: tagRows } = await supabase
    .from('roulette_blog_tags')
    .select('tag')
    .eq('blog_id', id);
  const tags = tagRows?.map((r) => r.tag) ?? [];

  const html = blog.body_html ?? '';
  const codeBlockCount = (html.match(/<pre[\s>]/gi) ?? []).length;
  const diagramCount =
    (html.match(/<img[\s>]|class="(?:mermaid|citation)"|<figure/gi) ?? [])
      .length;

  const result = runCheckpoints({
    body_html: blog.body_html,
    word_count: blog.word_count,
    seo_title: blog.seo_title,
    meta_description: blog.meta_description,
    tldr: blog.tldr,
    cover_image_url: blog.cover_image_url,
    ai_score: blog.ai_score ?? 30,
    tags,
    code_block_count: codeBlockCount,
    diagram_count: diagramCount,
  });

  if (!result.passed) {
    return NextResponse.json(
      { error: 'Checkpoint failed', result },
      { status: 422 },
    );
  }

  await supabase
    .from('roulette_blogs')
    .update({ status: 'SUBMITTED', submitted_at: new Date().toISOString() })
    .eq('id', id);

  return NextResponse.json({ ok: true });
}
