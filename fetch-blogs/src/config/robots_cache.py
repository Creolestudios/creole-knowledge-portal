"""robots.txt cache used before every outbound scrape."""

from __future__ import annotations

import time
from urllib.parse import urlparse
from urllib.robotparser import RobotFileParser

import httpx
import structlog

from src.core.config import get_scraping_settings

log = structlog.get_logger(__name__)

_USER_AGENT = "CreoleKnowledgePortal/1.0"
_cache: dict[str, tuple[float, RobotFileParser | None]] = {}


def _robots_url(page_url: str) -> str:
    parsed = urlparse(page_url)
    return f"{parsed.scheme or 'https'}://{parsed.netloc}/robots.txt"


def _load_parser(robots_url: str) -> RobotFileParser | None:
    parser = RobotFileParser()
    parser.set_url(robots_url)
    try:
        with httpx.Client(timeout=8.0, follow_redirects=True) as client:
            response = client.get(robots_url, headers={"User-Agent": _USER_AGENT})
        if response.status_code >= 400:
            return None
        parser.parse(response.text.splitlines())
        return parser
    except httpx.HTTPError as exc:
        log.warning("robots: fetch failed, allowing", url=robots_url, error=str(exc))
        return None


def is_url_allowed(url: str, user_agent: str = _USER_AGENT) -> bool:
    """Return True when robots.txt allows the URL, or when robots cannot be read."""
    parsed = urlparse(url)
    if not parsed.netloc:
        return False

    cfg = get_scraping_settings()
    robots_url = _robots_url(url)
    now = time.monotonic()
    cached = _cache.get(robots_url)
    if cached is None or now - cached[0] > cfg.ROBOTS_CACHE_TTL_SECONDS:
        parser = _load_parser(robots_url)
        _cache[robots_url] = (now, parser)
    else:
        parser = cached[1]

    if parser is None:
        return True
    try:
        return bool(parser.can_fetch(user_agent, url))
    except Exception:
        return True
