import { GoogleGenAI } from '@google/genai';

export interface BlogChunk {
  partNumber: number;
  title: string;
  content: string;
}

/**
 * Scrapes a URL, using Jina Reader first, with a fallback to direct fetch.
 */
export async function scrapeUrlContent(url: string): Promise<string> {
  try {
    const jinaUrl = `https://r.jina.ai/${encodeURIComponent(url)}`;
    console.log(`[BlogCompiler] Attempting to scrape via Jina Reader: ${jinaUrl}`);
    const jinaRes = await fetch(jinaUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/markdown',
      },
      signal: AbortSignal.timeout(10000), // 10s timeout
    });
    if (jinaRes.ok) {
      const text = await jinaRes.text();
      if (text && text.trim().length > 100) {
        console.log(`[BlogCompiler] Successfully scraped via Jina Reader (${text.length} chars)`);
        return text;
      }
    }
    console.warn(`[BlogCompiler] Jina Reader returned empty or failed. Status: ${jinaRes.status}`);
  } catch (e) {
    console.warn(`[BlogCompiler] Jina Reader failed for ${url}. Falling back to direct fetch.`, e);
  }

  // Direct fetch fallback
  console.log(`[BlogCompiler] Attempting direct fetch: ${url}`);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(8000), // 8s timeout
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.statusText}`);
  }
  return await res.text();
}

/**
 * Extracts and cleans the core article content from raw scraped HTML or markdown.
 */
export async function extractCleanArticle(
  url: string,
  rawHtmlOrText: string
): Promise<{ title: string; author: string; bodyMarkdown: string; tags: string[] }> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const truncatedHtml = rawHtmlOrText.substring(0, 250000); // Guard rails

  console.log(`[BlogCompiler] Extracting clean article from content (${truncatedHtml.length} chars)`);

  const prompt = `
    You are an expert technical content extractor.
    Analyze the raw HTML or text scraped from the URL: "${url}".
    Extract the main article content and metadata, filtering out navigation links, advertisements, sidebars, header/footer elements, and site boilerplate.
    
    Return a JSON object matching this schema exactly:
    {
      "title": "Clean article title",
      "author": "Author name or 'Unknown'",
      "bodyMarkdown": "Complete article body in clean, readable GitHub Markdown format, preserving code blocks, bullet points, headers",
      "tags": ["array", "of", "relevant", "tech", "tags"]
    }

    Source Scraped HTML/Text:
    ${truncatedHtml}
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
    }
  });

  const data = JSON.parse(response.text!.trim());
  return {
    title: data.title || 'Untitled Article',
    author: data.author || 'Unknown',
    bodyMarkdown: data.bodyMarkdown || '',
    tags: Array.isArray(data.tags) ? data.tags : [],
  };
}

/**
 * Reranks candidate articles based on user profile, selecting the single best candidate.
 */
export async function rerankArticles(userProfile: any, articles: any[]): Promise<any> {
  if (articles.length === 0) return null;
  if (articles.length === 1) return articles[0];

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const userStackInfo = `
    - Role: ${userProfile.current_role || userProfile.role || 'Developer'}
    - Primary Stack: ${(userProfile.primary_tech_stack || []).join(', ') || 'N/A'}
    - Secondary Stack: ${(userProfile.secondary_tech_stack || []).join(', ') || 'N/A'}
    - Interests: ${userProfile.future_interests || userProfile.future_learning_goals || 'All tech trends'}
  `.trim();

  const candidateSummary = articles.map((art, idx) => `
    [Candidate #${idx}]
    Title: ${art.title}
    Source: ${art.source}
    Tags: ${(art.tags || []).join(', ')}
    Summary: ${art.summary?.substring(0, 300)}...
  `).join('\n');

  console.log(`[BlogCompiler] Reranking ${articles.length} candidates for user profile...`);

  const prompt = `
    You are an expert developer content curator.
    Your task is to rank the candidate articles based on their relevance and value to the developer's profile.
    Select the single absolute best article that matches their primary tech stack, current role, or future learning goals.
    
    Developer Profile:
    ${userStackInfo}

    Candidate Articles:
    ${candidateSummary}

    Respond with a JSON object containing the index of the selected candidate:
    {
      "selectedIndex": 0,
      "reasoning": "Brief explanation of why this article is the best match"
    }
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
    }
  });

  const result = JSON.parse(response.text!.trim());
  const selectedIdx = typeof result.selectedIndex === 'number' ? result.selectedIndex : 0;
  console.log(`[BlogCompiler] Selected candidate #${selectedIdx}: "${articles[selectedIdx]?.title}"`);
  return articles[selectedIdx] || articles[0];
}

/**
 * Enriches a source article to create a fully descriptive technical blog/tutorial.
 */
export async function generateDescriptiveBlog(sourceArticle: any, userProfile: any): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const userStackInfo = `
    - Role: ${userProfile.current_role || userProfile.role || 'Developer'}
    - Experience Level: ${userProfile.years_of_experience || 'N/A'} years
    - Primary Stack: ${(userProfile.primary_tech_stack || []).join(', ') || 'N/A'}
  `.trim();

  console.log(`[BlogCompiler] Synthesizing descriptive masterclass blog for "${sourceArticle.title}"`);

  const prompt = `
    You are a principal engineer and senior technical content writer.
    Your task is to rewrite the source article into a highly detailed, comprehensive "masterclass" tech tutorial blog post.
    Make it fully descriptive and educational for a developer with this profile:
    ${userStackInfo}

    Instructions:
    1. Elaborate on every core concept. Do not summarize or gloss over complex details. Add background context, architectural patterns, and design patterns.
    2. Provide full-length, production-ready code examples rather than short snippets. Use clean comments in the code.
    3. Include sections for architecture, best practices, debugging strategies, and common pitfalls.
    4. Ensure the content flows beautifully, using clear subheadings (## and ###).
    5. Maintain a professional, highly premium, and engaging tone.

    Source Article Title: ${sourceArticle.title}
    Source Article Content:
    ${sourceArticle.bodyMarkdown || sourceArticle.summary}
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash', // Using Flash to remain within free tier quota limits
    contents: prompt,
  });

  return response.text!;
}

/**
 * Calculates reading time of markdown content, accounting for prose vs code speed differences.
 */
export function calculateReadingTime(markdown: string): number {
  const codeBlockRegex = /```[\s\S]*?```/g;
  let codeBlocks: string[] = [];
  let match;
  
  while ((match = codeBlockRegex.exec(markdown)) !== null) {
    codeBlocks.push(match[0]);
  }

  const proseOnly = markdown.replace(codeBlockRegex, '');

  const countWords = (str: string) => str.trim().split(/\s+/).filter(w => w.length > 0).length;

  const wordCountProse = countWords(proseOnly);
  const wordCountCode = codeBlocks.reduce((acc, code) => acc + countWords(code), 0);

  const proseMinutes = wordCountProse / 200;
  const codeMinutes = wordCountCode / 100;
  const totalMinutes = Math.ceil(proseMinutes + codeMinutes);

  return totalMinutes;
}

/**
 * Semantically splits a full blog post into target 20-minute daily parts.
 */
export async function chunkBlogSemantically(
  fullBlogMarkdown: string,
  targetReadTimeMin: number = 20
): Promise<BlogChunk[]> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  console.log(`[BlogCompiler] Chunking blog post of length ${fullBlogMarkdown.length} into parts of ~${targetReadTimeMin} mins`);

  const prompt = `
    You are an expert technical curriculum designer.
    Analyze the full technical blog post provided below.
    Divide the content into multiple sequential parts such that each part takes approximately ${targetReadTimeMin} minutes to read.
    Assume reading speeds: prose is 200 words per minute (WPM), code blocks are 100 words per minute (WPM).
    
    CRITICAL RULES:
    1. Do NOT break the semantic structure. Never split inside code blocks, blockquotes, lists, or paragraphs.
    2. Split only at logical boundaries, preferably at main section headings (e.g., ## or ###).
    3. Each part must have a cohesive theme and feel like a standalone daily chapter.
    4. For each part (starting from Part 2), prepend a brief 1-2 sentence Recap of the previous day, and append a brief 1-sentence teaser/transition to the next day.
    5. Maintain all markdown styling and code blocks intact.

    Full Blog Post:
    ${fullBlogMarkdown}

    Return a JSON array of parts matching this schema exactly:
    [
      {
        "partNumber": 1,
        "title": "Title of Part 1",
        "content": "Markdown body content of Part 1"
      },
      ...
    ]
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
    }
  });

  const chunks = JSON.parse(response.text!.trim()) as BlogChunk[];
  console.log(`[BlogCompiler] Split blog into ${chunks.length} parts`);
  return chunks;
}
