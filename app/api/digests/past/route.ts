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

    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');

    let query = supabaseAdmin
      .from('blogs')
      .select('*')
      .ilike('url', `briefing:${user.id}:%`)
      .order('published_at', { ascending: false });

    if (date) {
      // Assuming published_at contains the date or we can filter by the url string
      // URL format is likely briefing:userId:YYYY-MM-DD
      query = query.ilike('url', `briefing:${user.id}:${date}%`);
    } else {
      query = query.limit(10); // get last 10 if no date specified
    }

    const { data: blogs, error } = await query;

    if (error) {
      console.error('Error fetching past brief:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // If date is passed, return a single blog, else return array
    if (date) {
      return NextResponse.json({
        success: true,
        blog: blogs && blogs.length > 0 ? blogs[0] : null
      });
    }

    return NextResponse.json({
      success: true,
      blogs: blogs || []
    });

  } catch (error: any) {
    console.error('Error in digests/past route:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
