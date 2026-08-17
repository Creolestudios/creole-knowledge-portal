"""Map scraper payloads into canonical Article field data."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse


def _as_str_list(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [part.strip() for part in value.split(",") if part.strip()]
    if isinstance(value, (list, tuple, set)):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


def _parse_datetime(value: object) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value), tz=UTC)
    raw = str(value).strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def _domain_from_url(url: str, explicit: object) -> str:
    if explicit:
        return str(explicit).replace("www.", "").strip()
    parsed = urlparse(url)
    return parsed.netloc.replace("www.", "")


def to_article_fields(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Convert a scraper dict into Article constructor kwargs."""
    url = str(payload.get("url") or "").strip()
    if not url:
        raise ValueError("url is required")

    title = str(payload.get("title") or url).strip()[:500]
    body = str(payload.get("body_text") or payload.get("body_markdown") or "")
    summary = str(payload.get("summary") or payload.get("description") or "")
    if not summary and body:
        summary = body[:400]

    topics = _as_str_list(payload.get("topics")) or _as_str_list(payload.get("tags"))
    engagement = payload.get("engagement_score")
    authority = payload.get("authority_score")

    return {
        "url": url,
        "title": title or url,
        "source_domain": _domain_from_url(url, payload.get("source_domain")),
        "author": str(payload.get("author") or ""),
        "published_at": _parse_datetime(payload.get("published_at")),
        "summary": summary,
        "body_text": "",
        "topics": topics,
        "engagement_score": float(engagement) if engagement is not None else 0.0,
        "authority_score": float(authority) if authority is not None else 0.5,
        "robots_allowed": bool(payload.get("robots_allowed", True)),
    }


def legacy_schema_to_payload(article: Any) -> dict[str, Any]:
    """Convert legacy ``models.schemas.Article`` instances into adapter input."""
    return {
        "url": article.url,
        "title": article.title,
        "author": article.author,
        "source_domain": article.source_domain,
        "published_at": article.published_at,
        "body_text": "",
        "description": getattr(article, "body_text", "") or "",
        "tags": getattr(article, "tags", []) or [],
    }
