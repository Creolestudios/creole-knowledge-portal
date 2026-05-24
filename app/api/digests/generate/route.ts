import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { GoogleGenAI } from '@google/genai';

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
      const { data: { user } } = await supabase.auth.getUser();
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

    // 3. Fetch Trending Articles
    const articles: SourceArticle[] = [];

    // Fetch from Dev.to API (extremely high quality and robust developer articles)
    try {
      console.log('Fetching articles from Dev.to API...');
      const devToRes = await fetch('https://dev.to/api/articles?per_page=15', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        next: { revalidate: 3600 }
      });
      if (devToRes.ok) {
        const devToData = await devToRes.json();
        for (const item of devToData) {
          articles.push({
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

    // Fetch from Hacker News API (top stories)
    try {
      console.log('Fetching top stories from Hacker News API...');
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
                articles.push({
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
      console.log('Fetching admin-entered blog sources...');
      const { data: blogSources, error: sourcesError } = await supabaseAdmin
        .from('blog_sources')
        .select('url');
      
      if (!sourcesError && blogSources) {
        for (const source of blogSources) {
          try {
            // Scrape the homepage metadata
            const scrapeRes = await fetch(source.url, {
              headers: { 'User-Agent': 'Mozilla/5.0' },
              signal: AbortSignal.timeout(5000)
            });
            if (scrapeRes.ok) {
              const html = await scrapeRes.text();
              const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
              const siteTitle = titleMatch ? titleMatch[1].trim() : source.url;
              articles.push({
                title: `Highlights from ${siteTitle}`,
                url: source.url,
                source: 'Admin Curation',
                summary: `Curated news and network updates directly from the team's dashboard: ${source.url}`,
                tags: ['curation', 'admin']
              });
            }
          } catch (e) {
            // Scraper failed or timed out, add placeholder
            articles.push({
              title: `Latest from ${source.url}`,
              url: source.url,
              source: 'Admin Curation',
              summary: `Featured updates from administrative registered network source: ${source.url}`,
              tags: ['curation', 'network']
            });
          }
        }
      }
    } catch (err) {
      console.error('Error fetching admin blog sources:', err);
    }

    // 4. Relevance Matching & Ranking
    // Combine primary stack, secondary stack, role, domains, and future learning goals/interests
    const userKeywords = [
      ...(profile.primary_tech_stack || []),
      ...(profile.secondary_tech_stack || []),
      ...(profile.current_tech_stack || []),
      profile.current_role,
      profile.role,
      profile.primary_domain,
      profile.future_interests,
      profile.future_learning_goals
    ]
      .filter(Boolean)
      .map(k => String(k).toLowerCase());

    const scoredArticles = articles.map(article => {
      let score = 0;
      const textToMatch = `${article.title} ${article.summary} ${(article.tags || []).join(' ')}`.toLowerCase();
      
      userKeywords.forEach(kw => {
        // Direct exact match
        if (textToMatch.includes(kw)) {
          score += 10;
        }
        // Match split words (e.g. "wordpress developer" matches "wordpress")
        kw.split(/\s+/).forEach(w => {
          if (w.length > 2 && textToMatch.includes(w)) {
            score += 3;
          }
        });
      });

      return { article, score };
    });

    // Sort by relevance score descending
    scoredArticles.sort((a, b) => b.score - a.score);
    const topArticles = scoredArticles.slice(0, 10).map(sa => sa.article);

    console.log(`Matched ${topArticles.length} highly relevant articles for ${profile.email}`);

    // 5. Initialize Gemini and Synthesize Morning Briefing
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    const userStackInfo = `
- Current Role: ${profile.current_role || profile.role || 'Developer'}
- Primary Stack: ${(profile.primary_tech_stack || []).join(', ') || 'N/A'}
- Secondary Stack: ${(profile.secondary_tech_stack || []).join(', ') || 'N/A'}
- Custom Interests: ${profile.future_interests || profile.future_learning_goals || 'All tech and IT trends'}
    `.trim();

    const articlesContent = topArticles.map((art, idx) => `
[Source #${idx + 1}]
Title: ${art.title}
Source: ${art.source}
Author: ${art.author || 'N/A'}
URL: ${art.url}
Overview: ${art.summary}
Tags: ${(art.tags || []).join(', ')}
    `).join('\n');

    const prompt = `
You are the AI Factory Synthesizer, a state-of-the-art technical analyst.
Your task is to write a highly premium, customized "Morning Briefing" daily blog article for a developer profile.

Developer Profile:
${userStackInfo}

Trending Source Articles evaluated for today:
${articlesContent}

Output format requirements:
You MUST respond with a structured daily briefing matching these guidelines:
1. **Headline / Title**: An extremely catchy, sophisticated title tailored to their stack and interests.
2. **TLDR**: A clean bulleted list of the 3 most crucial high-level takeaways.
3. **Structured Sections**: Write 3 to 4 comprehensive, detailed sections that synthesize the concepts from the source articles. Use rich Markdown formatting, bold headings, and professional developer code blocks or examples where appropriate to represent best practices. Ensure the tone is wowed, premium, and extremely insightful.
4. **Key Takeaways**: A summary actionable section containing 2-3 clear next steps for their career/learning.
5. **Cited Sources**: A beautifully formatted section highlighting which source URLs they should read next. Use clickable markdown links.

Target reading length: ~1500 to 2500 words of rich content.

Generate the output article in beautiful GitHub Markdown.
    `.trim();

    // Retry and Fallback loop for Gemini models to ensure absolute resilience
    const modelsToTry = [
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-pro',
      'gemini-2.5-pro'
    ];
    
    let response = null;
    let lastError: any = null;

    for (const modelName of modelsToTry) {
      let attempts = 0;
      const maxAttempts = 3;
      let success = false;
      
      while (attempts < maxAttempts) {
        try {
          console.log(`[AI Factory] Invoking model ${modelName} (Attempt ${attempts + 1}/${maxAttempts})...`);
          response = await ai.models.generateContent({
            model: modelName,
            contents: prompt,
          });
          
          if (response && response.text) {
            console.log(`[AI Factory] Successfully synthesized content with model: ${modelName}`);
            success = true;
            break;
          }
        } catch (err: any) {
          attempts++;
          lastError = err;
          
          // Parse status or text for transient demand/rate limits
          const errMsg = String(err.message || err);
          const isUnavailable = errMsg.includes('503') || errMsg.includes('UNAVAILABLE') || errMsg.includes('high demand');
          const isRateLimit = errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('RESOURCE_EXHAUSTED');
          const isTransient = isUnavailable || isRateLimit;
          
          console.warn(`[AI Factory] Error with ${modelName} on attempt ${attempts}/${maxAttempts}: ${errMsg}`);
          
          if (isTransient && attempts < maxAttempts) {
            const delayMs = attempts * 2000; // 2s, 4s delay
            console.log(`[AI Factory] Transient demand spike detected. Backing off for ${delayMs}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
          } else {
            // Move to next model if non-transient or exhausted retries
            break;
          }
        }
      }
      
      if (success && response && response.text) {
        break;
      }
    }

    if (!response || !response.text) {
      const displayMsg = lastError?.message || JSON.stringify(lastError) || 'High demand on Gemini services';
      console.error('[AI Factory] All Gemini models exhausted. Final error:', lastError);
      throw new Error(`All available Gemini models are currently experiencing high demand. Please try again in a few moments. Detail: ${displayMsg}`);
    }

    const synthesizedContent = response.text;

    // 6. Save Synthesized Briefing to Blogs Table
    const todayStr = new Date().toISOString().split('T')[0];
    const briefUrl = `briefing:${userId}:${todayStr}`;

    const briefTitle = `Morning Briefing — ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
    const briefSummary = `AI Synthesized Daily Curation matching role ${profile.current_role || profile.role || 'Developer'}`;
    const briefTags = [
      'morning-briefing',
      'synthesis',
      ...(profile.primary_tech_stack || []),
      ...(profile.secondary_tech_stack || [])
    ].slice(0, 10);

    // Delete any briefing for this user for today to allow overwrite/regenerate
    await supabaseAdmin
      .from('blogs')
      .delete()
      .eq('url', briefUrl);

    // Insert the new daily brief article
    const { data: newBlog, error: insertError } = await supabaseAdmin
      .from('blogs')
      .insert({
        title: briefTitle,
        url: briefUrl,
        content: synthesizedContent,
        source: 'AI Factory',
        author: 'AI Factory',
        summary: briefSummary,
        tags: briefTags,
        published_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select('*')
      .single();

    if (insertError) {
      console.error('Error inserting daily brief:', insertError);
      throw insertError;
    }

    // Link in daily_30_curation table
    // Delete any curation for today with this blog_id or display_order 0
    await supabaseAdmin
      .from('daily_30_curation')
      .delete()
      .eq('curated_date', todayStr)
      .eq('display_order', 0); // Using 0 for the personalized brief

    await supabaseAdmin
      .from('daily_30_curation')
      .insert({
        blog_id: newBlog.id,
        curated_date: todayStr,
        display_order: 0,
        curation_notes: `Personalized brief for user ${userId}`
      });

    return NextResponse.json({
      success: true,
      blog: newBlog
    });

  } catch (error: any) {
    console.error('Digest synthesis error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
