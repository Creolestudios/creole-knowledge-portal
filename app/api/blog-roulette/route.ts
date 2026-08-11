import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createBlogSchema } from '@/lib/blog-roulette/validators';
import type { KeywordSuggestion } from '@/lib/blog-roulette/types';

export const runtime = 'nodejs';

function slugify(s: string) {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 70);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const parsed = createBlogSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid title' }, { status: 400 });
  }

  const { data: blog, error } = await supabase
    .from('roulette_blogs')
    .insert({
      author_id: user.id,
      title: parsed.data.title,
      slug: slugify(parsed.data.title),
      status: 'DRAFT',
    })
    .select('*')
    .single();

  if (error || !blog) {
    console.error('[blog-roulette/create]', error);
    return NextResponse.json({ error: 'Create failed' }, { status: 500 });
  }

  // Persist suggestions + selections from new-blog flow.
  const suggestions: KeywordSuggestion[] = body.suggestions ?? [];
  const selected: string[] = body.keywords ?? [];

  if (suggestions.length > 0) {
    const rows = suggestions.map((s) => ({
      blog_id: blog.id,
      keyword: s.keyword,
      type: s.type,
      trend_direction: s.trend_direction,
      selected: selected.includes(s.keyword),
    }));
    await supabase.from('roulette_seo_keywords').insert(rows);
  }

  return NextResponse.json({ id: blog.id });
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabase
    .from('roulette_blogs')
    .select('*')
    .eq('author_id', user.id)
    .order('updated_at', { ascending: false });

  return NextResponse.json({ blogs: data ?? [] });
}
