"""Celery stage 3: score and re-rank article IDs for a user profile.

Next-day selection is driven by:
  1) article embeddings
  2) user interests/stack via user_id profile
  3) quiz score / attempt / result (pace in the query embedding)
"""

from __future__ import annotations

from datetime import UTC, datetime

import structlog
from beanie import PydanticObjectId

from src.models.article import Article, RankingBreakdown
from src.models.profile import UserProfile
from src.ranker.llm_reranker import RerankCandidate, rerank_with_gemini
from src.ranker.next_day import refresh_profile_embedding
from src.ranker.scorer import score_articles_for_profile
from src.ranker.vector_search import rank_by_vector_similarity
from src.workers.celery_app import celery_app
from src.workers.runtime import ensure_db, run_async

log = structlog.get_logger(__name__)

_CORPUS_POOL = 80


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


async def _corpus_candidates(profile: UserProfile, exclude_ids: set[str]) -> list[Article]:
    """Pull previously embedded articles not yet served — ranked later by vector similarity."""
    served = {str(url).rstrip("/") for url in profile.learning_path.served_urls}
    pool: list[Article] = []
    cursor = Article.find_all().sort(-Article.created_at).limit(_CORPUS_POOL * 3)
    async for article in cursor:
        aid = _article_id(article)
        if not aid or aid in exclude_ids:
            continue
        url = str(article.url or "").rstrip("/")
        if url and url in served:
            continue
        if not article.embedding:
            continue
        pool.append(article)
        if len(pool) >= _CORPUS_POOL:
            break
    return pool


async def _rank_articles_for_user(article_ids: list[str], user_id: str, limit: int) -> list[str]:
    """Run embedding + interests + quiz-score ranking, then Gemini re-rank."""
    await ensure_db()
    profile = await UserProfile.find_one(UserProfile.user_id == user_id)
    if profile is None:
        log.warning("ranker: profile not found", user_id=user_id)
        return article_ids

    query_embedding = refresh_profile_embedding(profile)
    profile.updated_at = datetime.now(UTC)
    await profile.save()
    log.info(
        "ranker: profile embedding refreshed",
        user_id=user_id,
        dims=len(query_embedding),
    )

    pipeline_articles = await _load_articles(article_ids)
    known_ids = {_article_id(a) for a in pipeline_articles if _article_id(a)}
    corpus = await _corpus_candidates(profile, known_ids)

    merged: list[Article] = []
    seen: set[str] = set()
    for article in [*pipeline_articles, *corpus]:
        aid = _article_id(article)
        if not aid or aid in seen:
            continue
        seen.add(aid)
        merged.append(article)

    if not merged:
        return []

    if query_embedding:
        vector_ranked = rank_by_vector_similarity(
            profile,
            merged,
            limit=min(50, len(merged)),
            query_embedding=query_embedding,
        )
        ordered_articles = [item.article for item in vector_ranked]
        vector_by_id = {
            _article_id(item.article): item.similarity
            for item in vector_ranked
            if _article_id(item.article)
        }
    else:
        ordered_articles = merged
        vector_by_id = {}

    scored = score_articles_for_profile(ordered_articles, profile)
    scored_by_id = {_article_id(item.article): item for item in scored if _article_id(item.article)}

    top_for_llm = ordered_articles[:20]
    candidates = [
        RerankCandidate.from_article(
            article=article,
            composite_score=(
                scored_by_id[_article_id(article)].breakdown.composite_score
                if _article_id(article) in scored_by_id
                else 0.0
            ),
            vector_similarity=vector_by_id.get(_article_id(article), 0.0),
        )
        for article in top_for_llm
        if _article_id(article)
    ]
    candidates.sort(key=lambda c: (c.vector_similarity, c.composite_score), reverse=True)
    reranked = rerank_with_gemini(profile, candidates[:15], limit=limit)

    final_ids = [result.article_id for result in reranked]
    if not final_ids:
        final_ids = [_article_id(a) for a in ordered_articles[:limit] if _article_id(a)]

    score_by_id = {result.article_id: result for result in reranked}
    now = datetime.now(UTC)

    for position, article_id in enumerate(final_ids):
        scored_article = scored_by_id.get(article_id)
        article = scored_article.article if scored_article else None
        if article is None:
            article = next((a for a in merged if _article_id(a) == article_id), None)
        if article is None:
            continue
        result = score_by_id.get(article_id)
        base = scored_article.breakdown if scored_article is not None else RankingBreakdown()
        breakdown = base.model_copy(
            update={
                "vector_similarity": vector_by_id.get(article_id, 0.0),
                "final_score": result.score if result else vector_by_id.get(article_id, 0.0),
            }
        )
        article.quality_score = result.score if result else float(breakdown.final_score or 0.0)
        article.ranking_breakdown = RankingBreakdown.model_validate(breakdown.model_dump())
        article.llm_rerank_reason = (
            f"#{position + 1}: {result.reason}" if result else f"#{position + 1}: vector similarity"
        )
        article.ranked_at = now
        await article.save()

    log.info("ranker: selected articles", user_id=user_id, count=len(final_ids))
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