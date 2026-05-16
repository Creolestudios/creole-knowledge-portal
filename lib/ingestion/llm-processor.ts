import { GoogleGenAI } from '@google/genai';

// Initialize Gemini Client
// Requires GEMINI_API_KEY environment variable
const ai = new GoogleGenAI({});

export interface ProcessedBlog {
  isRelevant: boolean;
  summary: string | null;
  tags: string[];
}

/**
 * Processes scraped blog content using Gemini to filter noise, generate summaries, and assign tags.
 *
 * @param content The raw text content of the blog post
 * @param title The title of the blog post
 * @returns ProcessedBlog object containing relevancy flag, summary, and tags.
 */
export async function processWithLLM(title: string, content: string): Promise<ProcessedBlog> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  const prompt = `
    You are a senior technical editor curating content for a team of software engineers.
    Review the following blog post title and content.

    Title: ${title}
    Content Snippet (may be truncated): ${content.substring(0, 3000)}

    Perform the following tasks:
    1. Determine if this article is highly relevant to senior software engineers (isRelevant). Filter out promotional content, low-level tutorials, or non-technical company news.
    2. If relevant, write a concise 2-3 sentence summary (summary). If not relevant, set to null.
    3. If relevant, provide up to 5 technical tags (e.g., "microservices", "react", "system-design"). If not relevant, return an empty array.

    Output ONLY a valid JSON object matching this schema, without markdown formatting or code blocks:
    {
      "isRelevant": boolean,
      "summary": string | null,
      "tags": string[]
    }
    `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const responseText = response.text || '{}';

    // Parse JSON
    const parsed = JSON.parse(responseText);

    return {
      isRelevant: !!parsed.isRelevant,
      summary: parsed.summary || null,
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    };
  } catch (error) {
    console.error('Error processing content with LLM:', error);
    // Fail-safe: assume not relevant if LLM fails
    return { isRelevant: false, summary: null, tags: [] };
  }
}
