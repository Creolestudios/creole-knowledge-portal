"""Celery stage 3: score and re-rank article IDs for a user profile."""

from __future__ import annotations

from datetime import UTC, datetime

import structlog
from beanie import PydanticObjectId

from src.models.article import Article, RankingBreakdown
from src.models.profile import UserProfile
from src.ranker.llm_reranker import RerankCandidate, rerank_with_gemini
from src.ranker.scorer import score_articles_for_profile
from src.ranker.vector_search import rank_by_vector_similarity
from src.workers.celery_app import celery_app
from src.workers.runtime import ensure_db, run_async

log = structlog.get_logger(__name__)


def _article_id(article: Article) -> str:
    """Return the persisted Beanie ID as a string."""
    if article.id is None:
        return ""
    return str(article.id)


async def _load_articles(article_ids: list[str]) -> list[Article]:
    """Load Article documents while preserving input order."""
    articles: list[Article] = []
    for article_id in article_ids:
        article = await Article.get(PydanticObjectId(article_id))
        if article is not None:
            articles.append(article)
    return articles


async def _rank_articles_for_user(article_ids: list[str], user_id: str, limit: int) -> list[str]:
    """Run deterministic, vector, and Gemini ranking for a user."""
    await ensure_db()
    profile = await UserProfile.find_one(UserProfile.user_id == user_id)
    if profile is None:
        log.warning("ranker: profile not found", user_id=user_id)
        return article_ids

    articles = await _load_articles(article_ids)
    if not articles:
        return []

    scored = score_articles_for_profile(articles, profile)
    scored_by_id = {_article_id(item.article): item for item in scored if _article_id(item.article)}
    vector_ranked = rank_by_vector_similarity(profile, [item.article for item in scored], limit=50)
    vector_by_id = {_article_id(item.article): item.similarity for item in vector_ranked if _article_id(item.article)}

    candidates = [
        RerankCandidate.from_article(
            article=item.article,
            composite_score=item.breakdown.composite_score,
            vector_similarity=vector_by_id.get(_article_id(item.article), 0.0),
        )
        for item in scored[:15]
        if _article_id(item.article)
    ]
    reranked = rerank_with_gemini(profile, candidates, limit=limit)

    final_ids = [result.article_id for result in reranked]
    score_by_id = {result.article_id: result for result in reranked}
    now = datetime.now(UTC)

    for position, article_id in enumerate(final_ids):
        scored_article = scored_by_id.get(article_id)
        if scored_article is None:
            continue
        result = score_by_id[article_id]
        breakdown = scored_article.breakdown.model_copy(
            update={
                "vector_similarity": vector_by_id.get(article_id, 0.0),
                "final_score": result.score,
            }
        )
        article = scored_article.article
        article.quality_score = result.score
        article.ranking_breakdown = RankingBreakdown.model_validate(breakdown.model_dump())
        article.llm_rerank_reason = f"#{position + 1}: {result.reason}"
        article.ranked_at = now
        await article.save()

    return final_ids


@celery_app.task(
    name="src.workers.ranker_tasks.rank_articles",
    queue="rank_queue",
    acks_late=True,
    max_retries=3,
    default_retry_delay=60,
)
def rank_articles(article_ids: list[str], user_id: str, limit: int = 10) -> list[str]:
    """Celery entry point for rank_queue.

    The task accepts and returns document IDs only; article bodies remain in MongoDB.
    """
    return run_async(_rank_articles_for_user(article_ids, user_id, limit))
