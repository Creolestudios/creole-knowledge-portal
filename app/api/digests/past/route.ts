import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { blogServiceHeaders, blogServiceUrl } from '@/lib/blog-service';
import { requireUser } from '@/lib/api/require-user';

function dateKey(blog: { digest_date?: string; published_at?: string; url?: string } | null): string {
  if (!blog) return '';
  const fromFields = String(blog.digest_date || blog.published_at || '');
  const fieldMatch = fromFields.match(/^(\d{4}-\d{2}-\d{2})/);
  if (fieldMatch) return fieldMatch[1];
  const urlMatch = String(blog.url || '').match(/:(\d{4}-\d{2}-\d{2})/);
  return urlMatch ? urlMatch[1] : '';
}

async function fromBlogService(userId: string, date: string | null) {
  const query = date ? `?date=${encodeURIComponent(date)}` : '';
  const res = await fetch(blogServiceUrl(`/digests/${userId}/past${query}`), {
    headers: blogServiceHeaders(),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`blog service past digests failed: ${res.status}`);
  }
  return res.json();
}

async function fromSupabase(userId: string, date: string | null) {
  let query = supabaseAdmin
    .from('blogs')
    .select('*')
    .ilike('url', `briefing:${userId}:%`)
    .order('published_at', { ascending: false });

  if (date) {
    query = query.ilike('url', `briefing:${userId}:${date}%`);
  }

  const { data: blogs, error } = await query;
  if (error) {
    throw error;
  }
  if (date) {
    return { success: true, blog: blogs && blogs.length > 0 ? blogs[0] : null };
  }
  return { success: true, blogs: blogs || [] };
}

function mergePastLists(mongoBlogs: any[], supabaseBlogs: any[]) {
  const byDate = new Map<string, any>();
  const undated: any[] = [];

  const ingest = (item: any, prefer: boolean) => {
    const key = dateKey(item);
    if (!key) {
      undated.push(item);
      return;
    }
    if (prefer || !byDate.has(key)) {
      byDate.set(key, { ...item, digest_date: item.digest_date || key });
    }
  };

  for (const item of supabaseBlogs) ingest(item, false);
  for (const item of mongoBlogs) ingest(item, true);

  return [...[...byDate.values()].sort((a, b) => dateKey(b).localeCompare(dateKey(a))), ...undated];
}

export async function GET(request: Request) {
  try {
    const { user, errorResponse } = await requireUser();
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');

    let mongo: { success?: boolean; blogs?: any[]; blog?: any } | null = null;
    try {
      mongo = await fromBlogService(user.id, date);
    } catch (err) {
      console.warn('Blog service past digests unavailable, falling back to Supabase:', err);
    }

    let supabasePayload: { success?: boolean; blogs?: any[]; blog?: any } | null = null;
    try {
      supabasePayload = await fromSupabase(user.id, date);
    } catch (err) {
      if (!mongo) {
        throw err;
      }
      console.warn('Supabase past digests unavailable:', err);
    }

    if (date) {
      return NextResponse.json({
        success: true,
        blog: mongo?.blog || supabasePayload?.blog || null,
      });
    }

    return NextResponse.json({
      success: true,
      blogs: mergePastLists(mongo?.blogs || [], supabasePayload?.blogs || []),
    });
  } catch (error: any) {
    console.error('Error in digests/past route:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
