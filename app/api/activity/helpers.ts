import { blogServiceHeaders, blogServiceUrl } from '@/lib/blog-service';
import { toValidUUID } from '@/lib/quizzes/review';

/**
 * True when a Supabase error means "this table does not exist".
 *
 * Two distinct codes can surface, depending on how far the query got:
 *  - `PGRST205` - PostgREST resolved the request against its cached schema and
 *    never reached Postgres ("Could not find the table ... in the schema cache").
 *    This is what supabase-js actually returns for an unmigrated table.
 *  - `42P01`    - Postgres' own `undefined_table`, raised when a statement does
 *    reach the database (e.g. via RPC or after a stale cache reload).
 *
 * The activity tables are optional gamification extras, so a missing table is
 * degraded to an empty result rather than a 500 that breaks the whole sidebar.
 */
export function isMissingTableError(error: { code?: string } | null): boolean {
  return error?.code === 'PGRST205' || error?.code === '42P01';
}

export function digestDateFromBlog(blog: {
  id?: string;
  digest_date?: string;
  published_at?: string;
  url?: string;
} | null): string {
  if (!blog) return '';
  const fromFields = String(blog.digest_date || blog.published_at || '');
  const fieldMatch = fromFields.match(/^(\d{4}-\d{2}-\d{2})/);
  if (fieldMatch) return fieldMatch[1];
  const urlMatch = String(blog.url || '').match(/:(\d{4}-\d{2}-\d{2})/);
  return urlMatch ? urlMatch[1] : '';
}

/** Map quiz blog_id (UUID) → briefing calendar day (IST digest date). */
export async function loadBlogDigestDateById(userId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const res = await fetch(blogServiceUrl(`/digests/${userId}/past`), {
      headers: blogServiceHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) return map;
    const payload = await res.json();
    for (const blog of payload?.blogs || []) {
      const key = digestDateFromBlog(blog);
      const id = blog?.id != null ? String(blog.id) : '';
      if (!key || !id) continue;
      map.set(toValidUUID(id), key);
      map.set(id, key);
    }
  } catch {
    // Past Blog unlock still works from attempt timestamps if digests are unavailable.
  }
  return map;
}

export async function recordQuizOnBlogService(userId: string, quizScore?: number, quizTotal?: number) {
  if (quizScore === undefined || quizTotal === undefined) {
    return;
  }
  try {
    await fetch(blogServiceUrl(`/profiles/${userId}/quiz`), {
      method: 'POST',
      headers: blogServiceHeaders(),
      body: JSON.stringify({ score: quizScore, total: quizTotal }),
    });
  } catch (err) {
    console.warn('Quiz result was not synced to the blog service:', err);
  }
}
