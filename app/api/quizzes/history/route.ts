import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: attempts, error } = await supabaseAdmin
      .from('quiz_attempts')
      .select(`
        id,
        score,
        percentage,
        time_taken_seconds,
        completed_at,
        status,
        blog_id
      `)
      .eq('user_id', user.id)
      .order('started_at', { ascending: false });

    if (error) {
      throw error;
    }

    // Fetch blog titles manually
    const blogIds = [...new Set((attempts || []).map(a => a.blog_id))];
    const blogsMap: Record<string, string> = {};
    
    if (blogIds.length > 0) {
      const { data: blogs } = await supabaseAdmin
        .from('blogs')
        .select('id, title')
        .in('id', blogIds);
        
      blogs?.forEach(b => {
        blogsMap[b.id] = b.title;
      });
    }

    const history = (attempts || []).map((attempt: any) => ({
      ...attempt,
      blog_title: blogsMap[attempt.blog_id] || 'Unknown Blog'
    }));

    return NextResponse.json({ success: true, history });

  } catch (error: any) {
    console.error('History fetch error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
