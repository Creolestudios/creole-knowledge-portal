/**
 * Next.js used to invent a same-day filler briefing when FastAPI failed.
 * Those posts are not a real digest and must never replace the Synthesize CTA.
 */
export function isInventedFallback(blog: unknown): boolean {
  if (!blog || typeof blog !== 'object') return false;
  const record = blog as Record<string, unknown>;
  if (record.is_fallback === true || record.fallback === true) return true;
  if (record.source === 'AI Resilient Synthesis Engine') return true;
  if (record.fallback_kind === 'next_js') return true;

  let meta: { fallback?: boolean } = {};
  const rawSummary = record.summary;
  if (typeof rawSummary === 'string' && rawSummary.trim()) {
    try {
      meta = JSON.parse(rawSummary) as { fallback?: boolean };
    } catch {
      meta = {};
    }
  } else if (rawSummary && typeof rawSummary === 'object') {
    meta = rawSummary as { fallback?: boolean };
  }
  return Boolean(meta.fallback);
}
