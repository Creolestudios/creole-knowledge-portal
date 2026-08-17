import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { resolveUserOrMock } from '@/lib/dev/mock-user';
import { blogServiceHeaders, blogServiceUrl } from '@/lib/blog-service';

export async function GET() {
  try {
    const supabase = await createClient();
    const user = await resolveUserOrMock(supabase);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = user.id;

    try {
      const res = await fetch(blogServiceUrl(`/digests/${userId}/latest`), {
        headers: blogServiceHeaders(),
        cache: 'no-store',
      });
      if (res.ok) {
        const payload = await res.json();
        if (payload?.blog) {
          return NextResponse.json(payload);
        }
      }
    } catch (err) {
      console.warn('Blog service latest digest unavailable, falling back to Supabase:', err);
    }

    const { data: blogs, error } = await supabaseAdmin
      .from('blogs')
      .select('*')
      .ilike('url', `series:${userId}:%`);

    if (error) {
      console.error('Error fetching series blogs:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (blogs && blogs.length > 0) {
      const seriesMap: Record<string, { parts: any[]; maxPublishedAt: string }> = {};

      for (const blog of blogs) {
        let meta: any = null;
        try {
          meta = JSON.parse(blog.summary || '{}');
        } catch {
          // Not a JSON summary
        }

        if (meta && meta.seriesId) {
          const sId = meta.seriesId;
          if (!seriesMap[sId]) {
            seriesMap[sId] = { parts: [], maxPublishedAt: blog.published_at };
          }
          seriesMap[sId].parts.push({
            ...blog,
            meta,
          });
          if (new Date(blog.published_at) > new Date(seriesMap[sId].maxPublishedAt)) {
            seriesMap[sId].maxPublishedAt = blog.published_at;
          }
        }
      }

      const seriesList = Object.values(seriesMap).sort(
        (a, b) => new Date(b.maxPublishedAt).getTime() - new Date(a.maxPublishedAt).getTime()
      );

      if (seriesList.length > 0) {
        const activeSeries = seriesList[0];
        activeSeries.parts.sort((a, b) => a.meta.partNumber - b.meta.partNumber);
        const currentPart = activeSeries.parts.find((p) => !p.meta.completed);

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
              unlockedAt: currentPart.meta.unlockedAt,
            },
          });
        }

        return NextResponse.json({
          success: true,
          blog: null,
          seriesCompleted: true,
        });
      }
    }

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
      meta: null,
    });
  } catch (error: any) {
    console.error('Error in digests/latest route:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
