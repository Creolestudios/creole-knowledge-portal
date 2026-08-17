"""Shared scraper payload type."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, HttpUrl


class ScrapedItem(BaseModel):
    """Thin article metadata produced by a source scraper."""

    url: HttpUrl
    title: str
    source_domain: str
    author: str = ""
    published_at: datetime | None = None
    summary: str = ""
    topics: list[str] = Field(default_factory=list)
    engagement_score: float = 0.0
    authority_score: float = 0.5
    robots_allowed: bool = True

    def as_payload(self) -> dict[str, object]:
        """Return a dict the article adapter can consume."""
        return self.model_dump(mode="json")
