import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { blogServiceHeaders, blogServiceUrl } from '@/lib/blog-service';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { GoogleGenAI } from '@google/genai';

export const maxDuration = 300;

function localDateKey(d = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function blogDateKey(
  blog: { digest_date?: string; published_at?: string; generated_at?: string } | null,
): string {
  if (!blog) return '';
  const raw = blog.digest_date || blog.published_at || blog.generated_at || '';
  const match = String(raw).match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

/** Prefer today's existing digest — never create a second one for the same day. */
async function fetchTodaysDigestIfAny(userId: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(blogServiceUrl(`/digests/${userId}/latest?today_only=true`), {
      headers: blogServiceHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const payload = await res.json().catch(() => ({}));
    if (payload?.success && payload?.blog && blogDateKey(payload.blog) === localDateKey()) {
      return payload;
    }
  } catch (err) {
    console.warn('[DigestGenerate] Could not check for existing today digest:', err);
  }
  return null;
}

export async function POST(request: Request) {
  try {
    let userId: string | null = null;

    if (request) {
      try {
        const body = await request.json();
        userId = body.userId || null;
        // `force` is intentionally ignored — same-day digests are always idempotent.
      } catch {
        // empty body
      }
    }

    if (!userId) {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        userId = user.id;
      }
    }

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const existing = await fetchTodaysDigestIfAny(userId);
    if (existing) {
      return NextResponse.json({ ...existing, cached: true });
    }

    let pipelineFailureReason: string | null = null;

    try {
      const res = await fetch(blogServiceUrl('/digests/generate'), {
        method: 'POST',
        headers: blogServiceHeaders(),
        body: JSON.stringify({ userId }),
        signal: AbortSignal.timeout(280_000),
      });

      const payload = await res.json().catch(() => ({}));
      if (res.ok && payload.success && payload.blog) {
        return NextResponse.json(payload);
      }
      if (res.status === 404) {
        const detail = payload.detail || payload.error || 'Supabase profile not found';
        return NextResponse.json({ error: detail }, { status: 404 });
      }
      pipelineFailureReason = String(
        payload.detail || payload.error || `Blog service returned HTTP ${res.status}`,
      );
      const quotaHit =
        res.status === 429 ||
        /429|quota/i.test(pipelineFailureReason);
      if (quotaHit) {
        console.error('[DigestGenerate] Gemini quota exceeded (429):', pipelineFailureReason);
        return NextResponse.json(
          {
            error:
              'Gemini API quota exceeded (429). Daily free-tier limit reached — wait for reset or upgrade the API plan, then retry synthesize.',
          },
          { status: 429 },
        );
      }
      console.warn(
        '[DigestGenerate] FastAPI generate failed, using Next.js fallback:',
        pipelineFailureReason,
      );
    } catch (e: unknown) {
      pipelineFailureReason =
        e instanceof Error ? e.message : 'Blog service unreachable or timed out';
      console.error('[DigestGenerate] FastAPI service not available:', pipelineFailureReason);
    }

    // Local Gemini / static fallback when FastAPI could not produce today's digest
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    const userStack =
      profile?.primary_tech_stack?.join(', ') ||
      'Next.js 15, React 19, TypeScript, MongoDB, Supabase';
    const role = profile?.current_role || 'Senior Full Stack Developer';

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const prompt = `
      You are an expert tech educator and lead architect.
      Generate a fresh LEARNING briefing (tutorials, architecture, code, debugging) tailored for a ${role} working with ${userStack}.
      Cover only educational topics: patterns, code examples, best practices, and performance tips.
      Do NOT include news, company acquisitions, funding, earnings, layoffs, or market rumors.

      Return JSON with schema:
      {
        "title": "A compelling technical learning headline",
        "content": "Detailed Markdown using EXACTLY these H2 headings in order: ## Daily Overview (TL;DR), ## Brief, ## Code Snippet, ## Overview / Summary, ## Key Actionable Takeaways, ## Sources & Citations. Put real code only inside ## Code Snippet fences.",
        "tags": ["tech", "architecture", "nextjs", "performance"],
        "estimated_read_minutes": 15
      }
    `;

    const modelsToTry = ['gemini-3.6-flash'];
    let parsed: {
      title?: string;
      content?: string;
      tags?: string[] | string;
      estimated_read_minutes?: number;
    } | null = null;
    let geminiFailureReason: string | null = null;
    let sawQuota = false;

    for (const modelName of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: { responseMimeType: 'application/json' },
        });
        if (response?.text) {
          let rawText = response.text.trim();
          if (rawText.startsWith('```')) {
            rawText = rawText.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '');
          }
          parsed = JSON.parse(rawText.trim());

          if (!parsed?.title || !parsed?.content) {
            throw new Error('AI output missing title or content');
          }

          if (parsed.tags && !Array.isArray(parsed.tags)) {
            if (typeof parsed.tags === 'string') {
              parsed.tags = parsed.tags.split(',').map((t: string) => t.trim());
            } else {
              parsed.tags = ['tech'];
            }
          }
          break;
        }
        geminiFailureReason = `${modelName} returned empty text`;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        geminiFailureReason = message;
        const isQuota =
          message.includes('429') ||
          /quota/i.test(message) ||
          /RESOURCE_EXHAUSTED/i.test(message);
        if (isQuota) {
          sawQuota = true;
          console.error(`[DigestGenerate] Gemini quota exceeded (429) on ${modelName}:`, message);
          break;
        }
        console.warn(`[DigestGenerate] Model ${modelName} error:`, message);
      }
    }

    if (sawQuota) {
      const error =
        'Gemini API quota exceeded (429). Daily free-tier limit reached — wait for reset or upgrade the API plan, then retry synthesize.';
      console.error('[DigestGenerate]', error);
      return NextResponse.json({ error }, { status: 429 });
    }

    let fallbackKind: 'gemini_local' | 'static' = 'gemini_local';
    if (!parsed) {
      const timedOut =
        !!pipelineFailureReason &&
        (/timeout|aborted|timed out/i.test(pipelineFailureReason));
      if (timedOut) {
        const error = [
          'Blog service timed out waiting for the scrape→publish pipeline.',
          geminiFailureReason
            ? `Gemini fallback also failed: ${geminiFailureReason.slice(0, 240)}`
            : null,
        ]
          .filter(Boolean)
          .join(' ');
        console.error('[DigestGenerate]', error);
        return NextResponse.json({ error }, { status: 503 });
      }
      console.warn(
        '[DigestGenerate] All Gemini AI models hit error. Using static resilient synthesis generator.',
        geminiFailureReason,
      );
      fallbackKind = 'static';
      parsed = {
        title: `Architectural Deep-Dive: Building High-Performance Systems with ${userStack.split(',')[0]}`,
        content: `## Daily Overview (TL;DR)
- Mastering asynchronous data pipelines, optimistic rendering, and edge computing.
- Optimizing database queries across SQL (Supabase) and NoSQL (MongoDB) data stores.
- Implementing resilient fallback patterns for external third-party API dependencies.

## Brief
In modern production applications, separation of concerns between state storage, authentication, and background task queues is critical. When scaling web applications, microservices should delegate compute-intensive LLM and scraping tasks to specialized async workers (e.g. Celery / FastAPI) while Next.js handles user interaction.

## Code Snippet
\`\`\`typescript
export async function executeWithResilientFallback<T>(
  providers: (() => Promise<T>)[]
): Promise<T> {
  let lastError: Error | null = null;
  for (const provider of providers) {
    try {
      return await provider();
    } catch (err: any) {
      console.warn('Provider failed, attempting next fallback:', err.message);
      lastError = err;
    }
  }
  throw lastError || new Error('All providers failed');
}
\`\`\`

## Overview / Summary
Use a provider chain so one failed Gemini/model call does not fail the whole digest request. Keep HTTP handlers thin and push scrape/rank/synthesize work to async workers.

## Key Actionable Takeaways
- Always decouple heavy background processing from HTTP request handlers.
- Use explicit 20-minute idle check counters for long-running user assessments to maximize engagement.
- Store structured user data in relational databases while archiving unstructured documents in Mongo or Object Storage.

## Sources & Citations
- Internal architecture notes (static fallback)`,
        tags: ['architecture', 'performance', 'nextjs', 'resilience'],
        estimated_read_minutes: 12,
      };
    }

    const fallbackReasonParts = [
      pipelineFailureReason
        ? `Pipeline: ${pipelineFailureReason}`
        : 'Pipeline: primary FastAPI synthesis did not return a digest',
    ];
    if (fallbackKind === 'static' && geminiFailureReason) {
      fallbackReasonParts.push(`Local Gemini: ${geminiFailureReason}`);
    }
    const fallbackReason = fallbackReasonParts.join(' | ');

    const today = localDateKey();
    const slugKey = `briefing:${userId}:${today}`;
    const summaryPayload = {
      readingTime: parsed.estimated_read_minutes || 15,
      fallback: true,
      fallbackReason,
      fallbackKind,
    };

    const withFallbackFields = (blog: Record<string, unknown>) => ({
      ...blog,
      is_fallback: true,
      fallback_reason: fallbackReason,
      fallback_kind: fallbackKind,
    });

    const { data: existingBlog } = await supabaseAdmin
      .from('blogs')
      .select('*')
      .eq('url', slugKey)
      .maybeSingle();

    if (existingBlog) {
      return NextResponse.json({
        success: true,
        cached: true,
        fallback: true,
        fallback_reason: fallbackReason,
        fallback_kind: fallbackKind,
        blog: withFallbackFields({
          id: existingBlog.id,
          title: existingBlog.title,
          content: existingBlog.content,
          published_at: existingBlog.published_at,
          digest_date: today,
          tags: existingBlog.tags,
          word_count: String(existingBlog.content || '').split(/\s+/).length,
          estimated_read_minutes: parsed.estimated_read_minutes || 15,
          summary: existingBlog.summary || JSON.stringify(summaryPayload),
        }),
      });
    }

    const { data: newBlog, error: insertError } = await supabaseAdmin
      .from('blogs')
      .insert({
        title: parsed.title,
        url: slugKey,
        content: parsed.content,
        source: 'AI Resilient Synthesis Engine',
        author: 'AI Curation Agent',
        summary: JSON.stringify(summaryPayload),
        tags: parsed.tags || ['synthesis', 'tech'],
        published_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (insertError || !newBlog) {
      console.error('[DigestGenerate] Error saving generated blog:', insertError);
      return NextResponse.json(
        {
          error: `Failed to persist fresh blog digest: ${insertError?.message || 'Unknown error'}`,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      fallback: true,
      fallback_reason: fallbackReason,
      fallback_kind: fallbackKind,
      blog: withFallbackFields({
        id: newBlog.id,
        title: newBlog.title,
        content: newBlog.content,
        published_at: newBlog.published_at,
        digest_date: today,
        tags: newBlog.tags,
        word_count: newBlog.content.split(/\s+/).length,
        estimated_read_minutes: parsed.estimated_read_minutes || 15,
        summary: newBlog.summary,
      }),
    });
  } catch (error: unknown) {
    console.error('Digest synthesis error:', error);
    const message = error instanceof Error ? error.message : 'Digest generation failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
