"""Self-hosted vector similarity ranking.

Keep vector search isolated in this module so a future MongoDB Atlas
``$vectorSearch`` migration can replace this implementation without changing
worker or generator code.
"""

from __future__ import annotations

import math

import numpy as np
from pydantic import BaseModel, Field

from src.models.article import Article
from src.models.profile import UserProfile
from src.ranker.scorer import clamp_score


class VectorRankedArticle(BaseModel):
    """Article with profile/article embedding similarity."""

    article: Article
    similarity: float = Field(ge=0.0, le=1.0)


def cosine_similarity(query_embedding: list[float], article_embedding: list[float]) -> float:
    """Return normalized cosine similarity for two vectors.

    Invalid, empty, or dimension-mismatched embeddings receive 0.0 instead of
    raising, because extracted embeddings are optional during early ingestion.
    """
    if not query_embedding or not article_embedding:
        return 0.0
    if len(query_embedding) != len(article_embedding):
        return 0.0

    query = np.array(query_embedding, dtype=np.float64)
    article = np.array(article_embedding, dtype=np.float64)
    query_norm = float(np.linalg.norm(query))
    article_norm = float(np.linalg.norm(article))
    if query_norm == 0.0 or article_norm == 0.0:
        return 0.0

    raw_similarity = float(np.dot(query, article) / (query_norm * article_norm))
    if not math.isfinite(raw_similarity):
        return 0.0

    normalized = (raw_similarity + 1.0) / 2.0
    return clamp_score(normalized)


def rank_by_vector_similarity(
    profile: UserProfile, articles: list[Article], limit: int | None = None
) -> list[VectorRankedArticle]:
    """Rank articles by cosine similarity against the user's profile embedding."""
    ranked = [
        VectorRankedArticle(
            article=article,
            similarity=cosine_similarity(profile.profile_embedding, article.embedding),
        )
        for article in articles
    ]
    ranked.sort(key=lambda item: item.similarity, reverse=True)
    if limit is None:
        return ranked
    return ranked[:limit]
