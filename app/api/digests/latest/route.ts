import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import { mockUserFromCookie } from '@/lib/dev/mock-user';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    let { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      const cookieStore = await cookies();
      const mockUser = mockUserFromCookie(cookieStore.get('mock-user')?.value);
      if (mockUser) {
        user = mockUser as any;
      }
    }

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = user.id;

    // 1. Fetch all series blog parts for the user
    const { data: blogs, error } = await supabaseAdmin
      .from('blogs')
      .select('*')
      .ilike('url', `series:${userId}:%`);

    if (error) {
      console.error('Error fetching series blogs:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (blogs && blogs.length > 0) {
      // 2. Parse and group parts by seriesId
      const seriesMap: Record<string, { parts: any[]; maxPublishedAt: string }> = {};

      for (const blog of blogs) {
        let meta: any = null;
        try {
          meta = JSON.parse(blog.summary || '{}');
        } catch (e) {
          // Not a JSON summary, ignore
        }

        if (meta && meta.seriesId) {
          const sId = meta.seriesId;
          if (!seriesMap[sId]) {
            seriesMap[sId] = { parts: [], maxPublishedAt: blog.published_at };
          }
          seriesMap[sId].parts.push({
            ...blog,
            meta
          });
          if (new Date(blog.published_at) > new Date(seriesMap[sId].maxPublishedAt)) {
            seriesMap[sId].maxPublishedAt = blog.published_at;
          }
        }
      }

      // 3. Find the most recent series (based on maxPublishedAt)
      const seriesList = Object.values(seriesMap).sort(
        (a, b) => new Date(b.maxPublishedAt).getTime() - new Date(a.maxPublishedAt).getTime()
      );

      if (seriesList.length > 0) {
        const activeSeries = seriesList[0];
        // Sort parts by partNumber ascending
        activeSeries.parts.sort((a, b) => a.meta.partNumber - b.meta.partNumber);

        // Find the first uncompleted part
        const currentPart = activeSeries.parts.find(p => !p.meta.completed);

        if (currentPart) {
          const now = new Date();
          const unlockTime = new Date(currentPart.meta.unlockedAt);
          const isUnlocked = now >= unlockTime;

          return NextResponse.json({
            success: true,
            blog: currentPart,
            meta: {
              seriesId: currentPart.meta.seriesId,
              seriesTitle: currentPart.meta.seriesTitle,
              partNumber: currentPart.meta.partNumber,
              totalParts: currentPart.meta.totalParts,
              readingTime: currentPart.meta.readingTime,
              completed: false,
              unlocked: isUnlocked,
              unlockedAt: currentPart.meta.unlockedAt
            }
          });
        } else {
          // All parts of the latest series are completed!
          return NextResponse.json({
            success: true,
            blog: null,
            seriesCompleted: true
          });
        }
      }
    }

    // 4. Fallback to legacy daily briefing
    const { data: legacyBrief, error: legacyError } = await supabaseAdmin
      .from('blogs')
      .select('*')
      .ilike('url', `briefing:${userId}:%`)
      .order('published_at', { ascending: false })
      .limit(1);

    if (legacyError) {
      console.error('Error fetching legacy brief:', legacyError);
      return NextResponse.json({ error: legacyError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      blog: legacyBrief && legacyBrief.length > 0 ? legacyBrief[0] : null,
      meta: null
    });

  } catch (error: any) {
    console.error('Error in digests/latest route:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
