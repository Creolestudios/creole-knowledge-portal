import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { blogServiceHeaders, blogServiceUrl } from '@/lib/blog-service';
import { isInventedFallback } from '@/lib/digests/invented-fallback';

export const maxDuration = 600;

function localDateKey(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
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
    if (
      payload?.success &&
      payload?.blog &&
      blogDateKey(payload.blog) === localDateKey() &&
      !isInventedFallback(payload.blog)
    ) {
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
        signal: AbortSignal.timeout(540_000),
      });

      const payload = await res.json().catch(() => ({}));
      if (res.ok && payload.success && payload.blog && !isInventedFallback(payload.blog)) {
        return NextResponse.json(payload);
      }
      if (res.status === 404) {
        const detail = payload.detail || payload.error || 'Supabase profile not found';
        return NextResponse.json({ error: detail }, { status: 404 });
      }
      if (res.ok && isInventedFallback(payload.blog)) {
        pipelineFailureReason = "Today's briefing was not generated. Try Synthesize again.";
      } else {
        pipelineFailureReason = String(
          payload.detail || payload.error || `Blog service returned HTTP ${res.status}`,
        );
      }
      const quotaHit = res.status === 429 || /429|quota/i.test(pipelineFailureReason);
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
        '[DigestGenerate] FastAPI generate failed; not inventing a Next.js filler briefing:',
        pipelineFailureReason,
      );
    } catch (e: unknown) {
      pipelineFailureReason =
        e instanceof Error ? e.message : 'Blog service unreachable or timed out';
      console.error('[DigestGenerate] FastAPI service not available:', pipelineFailureReason);
    }

    const timedOut =
      !!pipelineFailureReason && /timeout|aborted|timed out/i.test(pipelineFailureReason);
    if (timedOut) {
      const late = await fetchTodaysDigestIfAny(userId);
      if (late) {
        return NextResponse.json({ ...late, cached: true });
      }
    }
    return NextResponse.json(
      {
        error: timedOut
          ? "Today's briefing is still being written. Wait a minute, then try Synthesize again."
          : pipelineFailureReason
            ? `Today's briefing was not generated: ${pipelineFailureReason}`
            : "Today's briefing was not generated. Try Synthesize again.",
      },
      { status: timedOut ? 503 : 502 },
    );
  } catch (error: unknown) {
    console.error('Digest synthesis error:', error);
    const message = error instanceof Error ? error.message : 'Digest generation failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
