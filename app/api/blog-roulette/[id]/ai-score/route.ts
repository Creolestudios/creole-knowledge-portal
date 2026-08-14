import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { detectAiScore } from '@/lib/blog-roulette/ai-detection';
import { requireUserAndBlog } from '@/lib/blog-roulette/route-helpers';

export const runtime = 'nodejs';

/**
 * POST /api/blog-roulette/:id/ai-score
 *
 * Runs AI detection on the blog body. Accepts the current HTML in the
 * request body so it scores the editor's *live* content, not the (stale)
 * database row. Persists the result back to the DB.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();

  const auth = await requireUserAndBlog(supabase, id, { select: 'author_id' });
  if ('error' in auth) return auth.error;

  // Use body_html from the request so we score what the editor currently
  // holds, not whatever was last saved to the DB (autosave lags behind).
  const { body_html } = await req.json().catch(() => ({ body_html: '' }));
  const html = body_html ?? '';
  if (html.length < 150) {
    return NextResponse.json({
      score: 0,
      signals: ['Add more content for AI detection'],
    });
  }

  const result = await detectAiScore(html);

  // Persist the score on the blog row for the submit checkpoint
  await supabase
    .from('roulette_blogs')
    .update({ ai_score: result.score })
    .eq('id', id);

  return NextResponse.json(result);
}
