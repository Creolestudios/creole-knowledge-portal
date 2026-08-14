import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { GoogleGenAI } from '@google/genai';
import { resolveUserOrMock } from '@/lib/dev/mock-user';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const user = await resolveUserOrMock(supabase);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = user.id;

    // 1. Fetch existing trending blogs for this user
    const { data: existingTrending, error } = await supabaseAdmin
      .from('blogs')
      .select('*')
      .ilike('url', `trending:${userId}:%`);

    if (error) {
      console.error('Error fetching trending blogs:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // If we have trending blogs and they are relatively fresh (created in the last 24h), return them
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const freshBlogs = existingTrending?.filter(
      (b) => new Date(b.created_at) > oneDayAgo
    );

    if (freshBlogs && freshBlogs.length >= 2) {
      return NextResponse.json({
        success: true,
        blogs: freshBlogs
      });
    }

    // 2. Otherwise, fetch user profile to research and generate new trending topics
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (profileError || !profile) {
      console.error('Profile not found for trending research:', profileError);
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    console.log(`[TrendingResearch] Researching trending topics for profile ${profile.email}...`);

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const userStackInfo = `
      - Role: ${profile.current_role || 'Developer'}
      - Primary Stack: ${(profile.primary_tech_stack || []).join(', ') || 'WordPress, PHP'}
      - Secondary Stack: ${(profile.secondary_tech_stack || []).join(', ') || 'N/A'}
      - Interests: ${profile.future_interests || 'IT news, AI updates'}
    `.trim();

    const prompt = `
      You are a senior developer advocate and technology trend researcher.
      Analyze this developer profile and identify 2 highly trending, active topics or releases currently making waves in their specific field right now (Year 2026).
      For example:
      - If they work on WordPress/PHP, focus on Gutenberg blocks development, React-based headless WordPress, PHP 8.x modern structures, or AI integration in CMS.
      - If they are interested in AI, focus on LangChain, Vercel AI SDK, local LLM execution, or agents development.
      
      For each of the 2 identified topics, generate a complete, premium, engaging technical blog post in Markdown format (including code blocks and explanation).
      
      Return a JSON array containing these 2 trending blogs matching this schema exactly:
      [
        {
          "topic": "Brief Tech Category (e.g. Next.js 15 Server Actions)",
          "title": "A highly engaging, click-worthy blog title",
          "slug": "url-friendly-slug",
          "content": "Complete Markdown content of the blog post. Discuss why it is trending, what problems it solves, and provide a short code sample.",
          "tags": ["array", "of", "relevant", "tags"],
          "readingTime": 5
        },
        ...
      ]

      Developer Profile:
      ${userStackInfo}
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      }
    });

    const parsedBlogs = JSON.parse(response.text!.trim());

    // Clean up old trending blogs for this user
    await supabaseAdmin
      .from('blogs')
      .delete()
      .ilike('url', `trending:${userId}:%`);

    const insertedBlogs = [];

    for (const item of parsedBlogs) {
      const urlKey = `trending:${userId}:${item.slug}`;
      const summaryMeta = {
        type: 'trending',
        topic: item.topic,
        readingTime: item.readingTime || 5
      };

      const { data: newBlog, error: insertError } = await supabaseAdmin
        .from('blogs')
        .insert({
          title: item.title,
          url: urlKey,
          content: item.content,
          source: 'AI Research Engine',
          author: 'AI Factory Curation',
          summary: JSON.stringify(summaryMeta),
          tags: item.tags || [],
          published_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select('*')
        .single();

      if (insertError) {
        console.error('Error inserting trending blog:', insertError);
        continue;
      }
      insertedBlogs.push(newBlog);
    }

    return NextResponse.json({
      success: true,
      blogs: insertedBlogs
    });

  } catch (error: any) {
    console.error('Error in trending route:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
