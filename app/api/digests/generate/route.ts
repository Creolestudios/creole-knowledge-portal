import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { cookies } from 'next/headers';
import crypto from 'crypto';
import {
  scrapeUrlContent,
  extractCleanArticle,
  rerankArticles,
  generateDescriptiveBlog,
  calculateReadingTime,
  chunkBlogSemantically
} from '@/lib/synthesis/blog-compiler';

interface SourceArticle {
  title: string;
  url: string;
  source: string;
  summary: string;
  author?: string;
  tags?: string[];
}

export async function POST(request: Request) {
  try {
    // 1. Get request body and identify target user
    let userId: string | null = null;
    try {
      const body = await request.json();
      userId = body.userId || null;
    } catch (e) {
      // Body might be empty, ignore
    }

    // If userId not specified in body, try to get logged-in user
    if (!userId) {
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
      if (user) {
        userId = user.id;
      }
    }

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    // 2. Fetch User Profile
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (profileError || !profile) {
      console.error('Error fetching user profile:', profileError);
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    // 3. Fetch Trending Articles (Candidates Pool)
    const candidates: SourceArticle[] = [];

    // Fetch from Dev.to API
    try {
      console.log('[GenerateDigest] Fetching articles from Dev.to API...');
      const devToRes = await fetch('https://dev.to/api/articles?per_page=15', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        next: { revalidate: 3600 }
      });
      if (devToRes.ok) {
        const devToData = await devToRes.json();
        for (const item of devToData) {
          candidates.push({
            title: item.title,
            url: item.url,
            source: 'dev.to',
            summary: item.description || '',
            author: item.user?.name || 'Unknown',
            tags: item.tag_list || []
          });
        }
      }
    } catch (err) {
      console.error('Error fetching Dev.to feeds:', err);
    }

    // Fetch from Hacker News API
    try {
      console.log('[GenerateDigest] Fetching top stories from Hacker News API...');
      const hnRes = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json', {
        next: { revalidate: 3600 }
      });
      if (hnRes.ok) {
        const topIds: number[] = await hnRes.json();
        const top10 = topIds.slice(0, 8);
        await Promise.all(top10.map(async (id) => {
          try {
            const itemRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
            if (itemRes.ok) {
              const item = await itemRes.json();
              if (item && item.url) {
                candidates.push({
                  title: item.title,
                  url: item.url,
                  source: 'Hacker News',
                  summary: `Hacker News top story with score ${item.score} by ${item.by}`,
                  author: item.by || 'HN User',
                  tags: ['tech', 'news']
                });
              }
            }
          } catch (e) {
            // Ignore single HN story fetch error
          }
        }));
      }
    } catch (err) {
      console.error('Error fetching HN stories:', err);
    }

    // Fetch from admin-entered blog sources
    try {
      console.log('[GenerateDigest] Fetching admin-entered blog sources...');
      const { data: blogSources, error: sourcesError } = await supabaseAdmin
        .from('blog_sources')
        .select('url');
      
      if (!sourcesError && blogSources) {
        for (const source of blogSources) {
          try {
            // Scrape metadata to add as candidates
            const scrapeRes = await fetch(source.url, {
              headers: { 'User-Agent': 'Mozilla/5.0' },
              signal: AbortSignal.timeout(5000)
            });
            if (scrapeRes.ok) {
              const html = await scrapeRes.text();
              const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
              const siteTitle = titleMatch ? titleMatch[1].trim() : source.url;
              candidates.push({
                title: `Highlights from ${siteTitle}`,
                url: source.url,
                source: 'Admin Curation',
                summary: `Curated news and updates directly from team source: ${source.url}`,
                tags: ['curation', 'admin']
              });
            }
          } catch (e) {
            candidates.push({
              title: `Latest from ${source.url}`,
              url: source.url,
              source: 'Admin Curation',
              summary: `Curated updates from registered network source: ${source.url}`,
              tags: ['curation', 'network']
            });
          }
        }
      }
    } catch (err) {
      console.error('Error fetching admin blog sources:', err);
    }

    if (candidates.length === 0) {
      throw new Error('No articles found to curate from sources.');
    }

    // 4. Rerank Candidates to select the single best article
    console.log('[GenerateDigest] Reranking candidate articles...');
    const bestArticleCandidate = await rerankArticles(profile, candidates);
    console.log(`[GenerateDigest] Best article selected: "${bestArticleCandidate.title}" (${bestArticleCandidate.url})`);

    // 5. Scrape Full Content & Extract Clean Text/Markdown via LLM
    console.log('[GenerateDigest] Scraping full content...');
    let rawScrapedContent = '';
    try {
      rawScrapedContent = await scrapeUrlContent(bestArticleCandidate.url);
    } catch (e) {
      console.warn(`[GenerateDigest] Failed to scrape full article, using summary as fallback:`, e);
      rawScrapedContent = bestArticleCandidate.summary;
    }

    console.log('[GenerateDigest] Extracting clean article...');
    const cleanedArticle = await extractCleanArticle(bestArticleCandidate.url, rawScrapedContent);

    // 6. Synthesize "Fully Descriptive" masterclass blog
    console.log('[GenerateDigest] Synthesizing fully descriptive blog...');
    const descriptiveBlogContent = await generateDescriptiveBlog(cleanedArticle, profile);

    // 7. Calculate total reading time
    const totalReadingTime = calculateReadingTime(descriptiveBlogContent);
    console.log(`[GenerateDigest] Fully descriptive blog word count details. Reading time: ${totalReadingTime} mins.`);

    // 8. Chunk into target 20-min daily segments
    console.log('[GenerateDigest] Chunking blog semantically into 20-min parts...');
    // If it's a short blog, chunking might return 1 part.
    // Ensure each part is ~20 mins. We pass 20 min read time goal.
    const parts = await chunkBlogSemantically(descriptiveBlogContent, 20);
    const totalParts = parts.length;
    console.log(`[GenerateDigest] Generated ${totalParts} daily parts.`);

    // 9. Store the Series parts in blogs table
    const seriesId = crypto.randomUUID();
    const today = new Date();

    // Clean up previous series parts for this user to avoid cluttering
    await supabaseAdmin
      .from('blogs')
      .delete()
      .ilike('url', `series:${userId}:%`);

    const insertedBlogs = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const partNumber = part.partNumber || (i + 1);
      const partUrl = `series:${userId}:${seriesId}:part:${partNumber}`;
      
      // Calculate unlock date: Part 1 unlocks today, Part 2 tomorrow, Part 3 day after, etc.
      const unlockDate = new Date(today);
      unlockDate.setDate(today.getDate() + i);
      // Set unlock time to 12:00 AM (midnight) of that day to feel natural, or keep exact time.
      // Setting to midnight makes it unlock at start of the day.
      if (i > 0) {
        unlockDate.setHours(0, 0, 0, 0);
      }

      const partReadingTime = calculateReadingTime(part.content);

      const partSummaryMeta = {
        seriesId,
        seriesTitle: cleanedArticle.title,
        partNumber,
        totalParts,
        readingTime: partReadingTime,
        completed: false,
        completedAt: null,
        unlockedAt: unlockDate.toISOString()
      };

      const partTitle = `[Day ${partNumber}/${totalParts}] ${part.title}`;

      const { data: newBlogPart, error: insertError } = await supabaseAdmin
        .from('blogs')
        .insert({
          title: partTitle,
          url: partUrl,
          content: part.content,
          source: bestArticleCandidate.source,
          author: cleanedArticle.author || bestArticleCandidate.author || 'AI Factory',
          summary: JSON.stringify(partSummaryMeta),
          tags: cleanedArticle.tags.length > 0 ? cleanedArticle.tags : (bestArticleCandidate.tags || []),
          published_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select('*')
        .single();

      if (insertError) {
        console.error(`Error inserting daily brief part ${partNumber}:`, insertError);
        throw insertError;
      }
      insertedBlogs.push(newBlogPart);
    }

    // Link in daily_30_curation table for today's active part (Part 1)
    const todayStr = today.toISOString().split('T')[0];
    await supabaseAdmin
      .from('daily_30_curation')
      .delete()
      .eq('curated_date', todayStr)
      .eq('display_order', 0); // Delete existing daily curation

    await supabaseAdmin
      .from('daily_30_curation')
      .insert({
        blog_id: insertedBlogs[0].id,
        curated_date: todayStr,
        display_order: 0,
        curation_notes: `Personalized brief Part 1 for user ${userId}`
      });

    return NextResponse.json({
      success: true,
      blog: insertedBlogs[0],
      meta: {
        seriesId,
        seriesTitle: cleanedArticle.title,
        partNumber: 1,
        totalParts,
        readingTime: calculateReadingTime(insertedBlogs[0].content),
        completed: false,
        unlocked: true,
        unlockedAt: today.toISOString()
      }
    });

  } catch (error: any) {
    console.error('Digest synthesis error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
