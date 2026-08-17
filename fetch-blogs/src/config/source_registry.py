"""Declarative list of scrape sources used by the Celery scrape worker."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, HttpUrl


class SourceConfig(BaseModel):
    """One allowed article source."""

    name: str
    kind: Literal["devto", "hn", "rss"]
    authority: float = Field(default=0.5, ge=0.0, le=1.0)
    base_url: HttpUrl | None = None
    feed_url: HttpUrl | None = None


SOURCE_REGISTRY: list[SourceConfig] = [
    SourceConfig(
        name="devto",
        kind="devto",
        authority=0.7,
        base_url="https://dev.to",
    ),
    SourceConfig(
        name="hackernews",
        kind="hn",
        authority=0.75,
        base_url="https://news.ycombinator.com",
    ),
    SourceConfig(
        name="devto-feed",
        kind="rss",
        authority=0.65,
        feed_url="https://dev.to/feed",
    ),
]


def sources_by_kind(kind: str) -> list[SourceConfig]:
    """Return registry entries matching a scraper kind."""
    return [source for source in SOURCE_REGISTRY if source.kind == kind]
