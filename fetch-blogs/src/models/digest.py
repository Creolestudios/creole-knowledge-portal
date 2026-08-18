"""Daily digest document produced after ranking and AI synthesis."""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Literal

from beanie import Document, Indexed
from pydantic import BaseModel, Field, HttpUrl
from pymongo import ASCENDING, IndexModel


class DigestSource(BaseModel):
    """A source article cited inside a generated digest."""

    id: int
    title: str
    url: HttpUrl
    author: str = ""
    source_domain: str = ""
    published_at: datetime | None = None


class DigestSection(BaseModel):
    """One markdown section of the generated briefing."""

    title: str
    content: str
    sources_cited: list[int] = Field(default_factory=list)
    estimated_read_minutes: float = Field(default=0.0, ge=0.0)


class DigestContent(BaseModel):
    """User-facing body of a daily digest."""

    headline: str
    tldr: list[str] = Field(default_factory=list)
    sections: list[DigestSection] = Field(default_factory=list)
    key_takeaways: list[str] = Field(default_factory=list)
    sources: list[DigestSource] = Field(default_factory=list)
    further_reading: list[dict[str, str]] = Field(default_factory=list)


class DigestMetrics(BaseModel):
    """Generation telemetry persisted with the digest."""

    articles_evaluated: int = 0
    articles_used: int = 0
    llm_tokens_used: int = 0
    generation_latency_seconds: float = 0.0


class DailyDigest(Document):
    """One synthesized briefing per user per calendar day."""

    user_id: Indexed(str)
    digest_date: date
    article_ids: list[str] = Field(default_factory=list)
    strategy_used: Literal["A", "B", "C"] = "C"
    reading_time_minutes: float = Field(default=0.0, ge=0.0)
    word_count: int = Field(default=0, ge=0)
    content: DigestContent
    metrics: DigestMetrics = Field(default_factory=DigestMetrics)
    generated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    class Settings:
        """Beanie collection settings."""

        name = "daily_digests"
        indexes = [
            IndexModel(
                [("user_id", ASCENDING), ("digest_date", ASCENDING)],
                unique=True,
            ),
        ]
