import { NextResponse } from 'next/server';
import type { SupabaseClient, User } from '@supabase/supabase-js';

/**
 * Shared auth + blog-lookup boilerplate for the `/api/blog-roulette/[id]/*`
 * route handlers: resolves the current user, 401s if missing, fetches the
 * roulette blog by id (optionally scoped to the requesting author), and
 * 404s if it doesn't exist.
 */
export async function requireUserAndBlog(
  supabase: SupabaseClient,
  id: string,
  options: { restrictToAuthor?: boolean; select?: string } = {},
): Promise<{ error: NextResponse } | { user: User; blog: any }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  let query = supabase
    .from('roulette_blogs')
    .select(options.select ?? '*')
    .eq('id', id);

  if (options.restrictToAuthor) {
    query = query.eq('author_id', user.id);
  }

  const { data: blog } = await query.single();
  if (!blog) {
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }

  return { user, blog };
}
