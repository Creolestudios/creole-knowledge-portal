import type { KeywordSuggestion, TrendDirection } from './types';

const AUTOCOMPLETE_URL = 'https://suggestqueries.google.com/complete/search';

async function fetchAutocomplete(query: string): Promise<string[]> {
  const url = `${AUTOCOMPLETE_URL}?client=firefox&q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; CreoleKnowledgePortal/1.0)',
        Accept: 'application/json',
      },
      // Don't cache between requests; results should reflect current trends
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (Array.isArray(data) && Array.isArray(data[1])) {
      return data[1] as string[];
    }
    return [];
  } catch {
    return [];
  }
}

async function fetchTrendDirection(keyword: string): Promise<TrendDirection> {
  // Lazy-require to keep this importable from edge/client-safe contexts.
  // google-trends-api is server-only.
  try {
    const mod = await import('google-trends-api');
    const trends = (mod as unknown as { default?: typeof mod }).default ?? mod;
    const raw = await trends.interestOverTime({
      keyword,
      startTime: new Date(Date.now() - 1000 * 60 * 60 * 24 * 90), // last 90 days
    });
    const parsed = JSON.parse(raw);
    const timeline = parsed?.default?.timelineData ?? [];
    if (timeline.length < 4) return 'stable';
    const halfway = Math.floor(timeline.length / 2);
    const firstHalf = timeline.slice(0, halfway);
    const secondHalf = timeline.slice(halfway);
    const avg = (arr: { value?: number[] }[]) =>
      arr.reduce((a, b) => a + (b.value?.[0] ?? 0), 0) / arr.length;
    const diff = avg(secondHalf) - avg(firstHalf);
    if (diff > 5) return 'rising';
    if (diff < -5) return 'falling';
    return 'stable';
  } catch {
    return 'stable';
  }
}

export async function suggestKeywords(
  title: string,
): Promise<KeywordSuggestion[]> {
  const baseTerms = await fetchAutocomplete(title);

  // First 3 from Autocomplete = primary picks. Rest = long-tail.
  const primary = baseTerms.slice(0, 3);
  const longTail = baseTerms.slice(3, 10);

  const enriched: KeywordSuggestion[] = [];

  for (const kw of primary) {
    const dir = await fetchTrendDirection(kw);
    enriched.push({ keyword: kw, type: 'primary', trend_direction: dir });
  }
  for (const kw of longTail) {
    enriched.push({
      keyword: kw,
      type: 'long_tail',
      trend_direction: 'stable',
    });
  }

  return enriched;
}
