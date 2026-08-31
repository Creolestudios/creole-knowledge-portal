import catalog from '../shared/tech-keywords.json';

/** Shared engineering allowlist — single source of truth in shared/tech-keywords.json */
export const TECH_KEYWORDS: readonly string[] = catalog.keywords;

export const TECH_SHORT_TOKENS: readonly string[] = catalog.shortTokens;

export const SOURCE_JUNK_MARKERS: readonly string[] =
  (catalog as { sourceJunkMarkers?: string[] }).sourceJunkMarkers ?? [];

const SHORT_TOKEN_RE = new RegExp(
  `(?<![a-z0-9])(${TECH_SHORT_TOKENS.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![a-z0-9])`,
  'i',
);

/** True when text contains a shared engineering keyword (allowlist). */
export function textHasTechSignal(text: string): boolean {
  const withoutUrls = String(text || '')
    .replace(/https?:\/\/[^\s)\]]+/gi, ' ')
    .toLowerCase();
  if (TECH_KEYWORDS.some((k) => withoutUrls.includes(k.toLowerCase()))) return true;
  return SHORT_TOKEN_RE.test(withoutUrls);
}

/** Obvious non-tech source titles (small blocklist — not the engineering allowlist). */
export function isSourceTitleJunk(title: string): boolean {
  const hay = String(title || '').toLowerCase();
  return SOURCE_JUNK_MARKERS.some((m) => hay.includes(m.toLowerCase()));
}
