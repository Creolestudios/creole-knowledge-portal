import { NextResponse } from 'next/server';
import { suggestKeywords } from '@/lib/blog-roulette/seo';
import { seoSuggestSchema } from '@/lib/blog-roulette/validators';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = seoSuggestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid title' }, { status: 400 });
    }
    const suggestions = await suggestKeywords(parsed.data.title);
    return NextResponse.json({ suggestions });
  } catch (err) {
    console.error('[seo-suggest] error', err);
    return NextResponse.json(
      { error: 'Suggestion failed' },
      { status: 500 },
    );
  }
}
