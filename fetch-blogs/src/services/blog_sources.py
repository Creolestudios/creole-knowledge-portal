"""Admin-registered blog / RSS URLs from Supabase ``blog_sources``."""

from __future__ import annotations

import httpx
import structlog

from src.core.config import get_supabase_settings
from src.scrapers import parse_rss_feed

log = structlog.get_logger(__name__)

_MAX_ADMIN_FEEDS = 10
_FEED_PATH_SUFFIXES = ("/feed", "/rss", "/rss.xml", "/atom.xml", "/index.xml")


async def fetch_admin_blog_source_urls() -> list[str]:
    """Return unique URLs from Admin → Sources (``blog_sources``), max 10."""
    cfg = get_supabase_settings()
    url = f"{cfg.URL}/rest/v1/blog_sources"
    key = cfg.SERVICE_ROLE_KEY.get_secret_value()
    headers = {
        "apikey": cfg.ANON_KEY.get_secret_value() if cfg.ANON_KEY else key,
        "Authorization": f"Bearer {key}",
    }
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(url, headers=headers, params={"select": "url"})
        if response.status_code != 200:
            log.warning("supabase: blog_sources fetch failed", status=response.status_code)
            return []
        rows = response.json()
    except Exception as exc:
        log.warning("supabase: blog_sources unreachable", error=str(exc))
        return []

    seen: set[str] = set()
    out: list[str] = []
    for row in rows:
        raw = str((row or {}).get("url") or "").strip()
        if not raw:
            continue
        scheme, sep, rest = raw.partition("://")
        if not sep or not rest:
            continue
        if scheme.lower() == "http":
            raw = f"https://{rest}"
        elif scheme.lower() != "https":
            continue
        normalized = raw.rstrip("/")
        if normalized in seen:
            continue
        seen.add(normalized)
        out.append(raw)
        if len(out) >= _MAX_ADMIN_FEEDS:
            break
    return out


def _feed_candidates(source_url: str) -> list[str]:
    """Try the URL as-is, then common RSS/Atom paths under the same origin."""
    base = source_url.strip().rstrip("/")
    if not base:
        return []
    candidates = [source_url.strip(), base]
    lower = base.lower()
    if any(lower.endswith(sfx) for sfx in (".xml", "/feed", "/rss", "/atom")):
        return list(dict.fromkeys(candidates))
    for suffix in _FEED_PATH_SUFFIXES:
        candidates.append(base + suffix)
    return list(dict.fromkeys(candidates))


def scrape_admin_source_articles(
    source_urls: list[str],
    *,
    limit_per_feed: int = 3,
) -> list[object]:
    """Parse admin URLs as RSS/Atom feeds (with path fallbacks).

    Returns legacy ``Article`` objects from ``parse_rss_feed``.
    """
    articles: list[object] = []
    for source_url in source_urls[:_MAX_ADMIN_FEEDS]:
        found = False
        for candidate in _feed_candidates(source_url):
            try:
                items = parse_rss_feed(feed_url=candidate, limit=limit_per_feed)
            except Exception as exc:
                log.debug("admin feed parse failed", url=candidate, error=str(exc))
                continue
            if items:
                articles.extend(items)
                found = True
                log.info("admin feed scraped", source=source_url, feed=candidate, count=len(items))
                break
        if not found:
            log.warning("admin feed empty or not RSS", source=source_url)
    return articles
