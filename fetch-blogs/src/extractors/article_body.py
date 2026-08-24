"""Article body extraction: Dev.to API, newspaper3k, BeautifulSoup, then Jina Reader."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

import structlog

from src.ai_pipeline.jina_crawler import fetch_via_jina
from src.scrapers.extractor import extract_article_content

log = structlog.get_logger(__name__)

_SKIP_DEVTO_PATHS = {"t", "search", "videos", "podcasts", "tags", "api"}


def _word_count(text: str) -> int:
    return len(text.split())


def _devto_full_article(url: str) -> dict[str, Any] | None:
    """Fetch full markdown from the Dev.to article API when the URL matches."""
    parsed = urlparse(url)
    host = (parsed.netloc or "").lower().removeprefix("www.")
    if host != "dev.to":
        return None
    parts = [item for item in parsed.path.split("/") if item]
    if len(parts) < 2 or parts[0] in _SKIP_DEVTO_PATHS:
        return None

    api_url = f"https://dev.to/api/articles/{parts[0]}/{parts[1]}"
    try:
        import httpx

        with httpx.Client(timeout=15.0) as client:
            response = client.get(api_url, headers={"User-Agent": "CreoleKnowledgePortal/1.0"})
        if response.status_code != 200:
            return None
        data = response.json()
    except Exception as exc:
        log.warning("extract: dev.to api failed", url=url, error=str(exc))
        return None

    body = str(data.get("body_markdown") or "").strip()
    if not body:
        return None
    tags = data.get("tag_list") or []
    if isinstance(tags, str):
        tags = [tags]
    user = data.get("user") if isinstance(data.get("user"), dict) else {}
    return {
        "title": str(data.get("title") or ""),
        "body_text": body,
        "body_markdown": body,
        "author": str(user.get("name") or ""),
        "tags": [str(tag) for tag in tags],
        "word_count": _word_count(body),
        "reading_time_min": max(0.5, round(_word_count(body) / 225.0, 1)),
    }


def extract_body(url: str) -> dict[str, Any]:
    """Return extracted title/body/tags for a public article URL.

    Prefer the Dev.to API for full markdown, then newspaper, then Jina.
    """
    candidates: list[dict[str, Any]] = []
    devto = _devto_full_article(url)
    if devto and _word_count(str(devto.get("body_text") or "")) >= 200:
        return devto
    if devto and devto.get("body_text"):
        candidates.append(devto)

    extracted = extract_article_content(url)
    if extracted.get("body_text"):
        candidates.append(extracted)

    if not extracted.get("body_text"):
        jina = fetch_via_jina(url)
        if jina and jina.get("body_text"):
            candidates.append(jina)

    if candidates:
        return max(candidates, key=lambda item: _word_count(str(item.get("body_text") or "")))

    log.warning("extract: no body", url=url)
    return extracted
