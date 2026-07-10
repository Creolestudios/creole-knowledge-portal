"""Article document used by scraping, extraction, and ranking stages."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Literal

from beanie import Document, Indexed
from pydantic import BaseModel, Field, HttpUrl


class ComplexityLevel(StrEnum):
    """Supported content complexity levels."""

    BEGINNER = "beginner"
    INTERMEDIATE = "intermediate"
    ADVANCED = "advanced"


class RankingBreakdown(BaseModel):
    """Persisted scoring details for rank explainability."""

    strategy: Literal["A", "B", "C"] = "C"
    tfidf_relevance: float = Field(default=0.0, ge=0.0, le=1.0)
    authority: float = Field(default=0.0, ge=0.0, le=1.0)
    recency: float = Field(default=0.0, ge=0.0, le=1.0)
    engagement: float = Field(default=0.0, ge=0.0, le=1.0)
    complexity_fit: float = Field(default=0.0, ge=0.0, le=1.0)
    vector_similarity: float = Field(default=0.0, ge=0.0, le=1.0)
    composite_score: float = Field(default=0.0, ge=0.0, le=1.0)
    final_score: float = Field(default=0.0, ge=0.0, le=1.0)


class Article(Document):
    """Public article metadata, extracted content, and ranking state."""

    url: Indexed(HttpUrl, unique=True)
    title: str = Field(min_length=1, max_length=500)
    source_domain: Indexed(str)
    author: str = ""
    published_at: datetime | None = None

    summary: str = ""
    body_text: str = ""
    topics: list[str] = Field(default_factory=list)
    tech_stack: list[str] = Field(default_factory=list)
    complexity_level: ComplexityLevel = ComplexityLevel.INTERMEDIATE
    embedding: list[float] = Field(default_factory=list)

    engagement_score: float = Field(default=0.0, ge=0.0)
    authority_score: float = Field(default=0.5, ge=0.0, le=1.0)
    paywalled: bool = False
    robots_allowed: bool = True

    quality_score: float = Field(default=0.0, ge=0.0, le=1.0)
    ranking_breakdown: RankingBreakdown | None = None
    llm_rerank_reason: str = ""
    ranked_at: datetime | None = None

    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    class Settings:
        """Beanie collection settings."""

        name = "articles"
        indexes = [
            "source_domain",
            "published_at",
            "quality_score",
            "topics",
            "tech_stack",
        ]
