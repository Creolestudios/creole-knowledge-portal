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

    const userId = user.id;

    // Fetch the latest daily briefing blog for the logged-in user
    const { data: brief, error } = await supabaseAdmin
      .from('blogs')
      .select('*')
      .ilike('url', `briefing:${userId}:%`)
      .order('published_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error('Error fetching latest brief:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      blog: brief && brief.length > 0 ? brief[0] : null
    });

  } catch (error: any) {
    console.error('Error in digests/latest route:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
