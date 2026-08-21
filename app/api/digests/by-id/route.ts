import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { blogServiceHeaders, blogServiceUrl } from '@/lib/blog-service';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const blogId = searchParams.get('id');

    if (!blogId) {
      return NextResponse.json({ error: 'Blog ID is required' }, { status: 400 });
    }

    // 1. Try fetching from Supabase by UUID or ID
    const { data: supabaseBlog } = await supabaseAdmin
      .from('blogs')
      .select('*')
      .eq('id', blogId)
      .single();

    if (supabaseBlog) {
      return NextResponse.json({
        success: true,
        blog: supabaseBlog
      });
    }

    // 2. Try fetching from FastAPI blog service if ID is MongoDB hex
    try {
      const res = await fetch(blogServiceUrl(`/digests/${user.id}/latest`), {
        headers: blogServiceHeaders(),
        cache: 'no-store',
      });
      if (res.ok) {
        const payload = await res.json();
        if (payload?.blog && (payload.blog.id === blogId || String(payload.blog.id).includes(blogId))) {
          return NextResponse.json(payload);
        }
      }
    } catch (err) {
      console.warn('[DigestById] FastAPI lookup failed:', err);
    }

    // 3. Fallback search by ID or URL prefix in Supabase
    const { data: fallbackBlogs } = await supabaseAdmin
      .from('blogs')
      .select('*')
      .or(`id.eq.${blogId},url.ilike.%${blogId}%`)
      .limit(1);

    if (fallbackBlogs && fallbackBlogs.length > 0) {
      return NextResponse.json({
        success: true,
        blog: fallbackBlogs[0]
      });
    }

    return NextResponse.json({ error: 'Blog not found' }, { status: 404 });
  } catch (error: any) {
    console.error('Error in digests/by-id route:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
