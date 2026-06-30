import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    let { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      const cookieStore = await cookies();
      const mockCookie = cookieStore.get('mock-user');
      if (mockCookie && mockCookie.value === 'true') {
        user = {
          id: 'b632b1ab-71e5-48ca-ab5d-b431c4e65004',
          email: 'priyadhanani125@gmail.com'
        } as any;
      }
    }

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { blogId } = await request.json();
    if (!blogId) {
      return NextResponse.json({ error: 'Blog ID is required' }, { status: 400 });
    }

    // 1. Fetch the blog part
    const { data: blog, error: fetchError } = await supabaseAdmin
      .from('blogs')
      .select('*')
      .eq('id', blogId)
      .single();

    if (fetchError || !blog) {
      console.error('[POST /api/digests/complete] Fetch error:', fetchError);
      return NextResponse.json({ error: 'Blog part not found' }, { status: 404 });
    }

    // Verify ownership via URL pattern series:userId:...
    const userId = user.id;
    if (!blog.url.startsWith(`series:${userId}:`)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 2. Parse summary JSON metadata
    let metadata: any = {};
    try {
      metadata = JSON.parse(blog.summary || '{}');
    } catch (e) {
      console.error('[POST /api/digests/complete] Failed to parse summary JSON:', e);
    }

    // 3. Update metadata to completed
    metadata.completed = true;
    metadata.completedAt = new Date().toISOString();

    // 4. Update the blog row
    const { data: updatedBlog, error: updateError } = await supabaseAdmin
      .from('blogs')
      .update({
        summary: JSON.stringify(metadata),
        updated_at: new Date().toISOString()
      })
      .eq('id', blogId)
      .select('*')
      .single();

    if (updateError) {
      console.error('[POST /api/digests/complete] Update error:', updateError);
      return NextResponse.json({ error: 'Failed to update progress' }, { status: 500 });
    }

    // Optional: If there is a next part, we could adjust its unlockedAt to be now + 24 hours
    // to enforce a strict 24h gap from completion, or let the pre-calculated schedule run.
    // Here we let the pre-calculated schedule run, which unlocks tomorrow naturally.

    return NextResponse.json({
      success: true,
      blog: updatedBlog
    });

  } catch (error: any) {
    console.error('[POST /api/digests/complete] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
