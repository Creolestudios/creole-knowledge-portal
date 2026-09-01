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
from src.extractors.topic_filter import is_non_learning, matches_any_term

from src.ranker.llm_reranker import RerankCandidate, rerank_with_gemini
from src.ranker.next_day import (
    discovery_match_terms,
    hay_is_off_yesterday_family,
    refresh_profile_embedding,
)
from src.ranker.scorer import score_articles_for_profile
from src.ranker.vector_search import rank_by_vector_similarity
from src.workers.celery_app import celery_app
from src.workers.runtime import ensure_db, run_async

log = structlog.get_logger(__name__)

_CORPUS_POOL = 80
_TRENDING_HOSTS = frozenset(
    {
        "dev.to",
        "www.dev.to",
        "news.ycombinator.com",
        "hacker-news.firebaseio.com",
    }
)


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

    # Prefer TODAY's scrape pool only. Continuity embeddings otherwise re-pick
    # yesterday's Mongo articles. Corpus is a last resort when the live pool is thin.
    merged: list[Article] = []
    seen: set[str] = set()
    recent_titles = {
        str(t).strip().lower()
        for t in [
            getattr(profile.learning_path, "last_digest_headline", None),
            *(getattr(profile.learning_path, "last_digest_tldr", None) or []),
        ]
        if str(t or "").strip()
    }

    match_terms = discovery_match_terms(profile)
    preferred_hosts = {
        *(_TRENDING_HOSTS),
        *(
            (str(u).split("/")[2].lower() if "://" in str(u) else "")
            for u in (profile.preferred_sources or [])
        ),
    }
    preferred_hosts.discard("")

    def _title_blocked(title: str) -> bool:
        t = title.strip().lower()
        if not t:
            return False
        if t.endswith((".pdf", ".zip", ".exe", ".dmg")):
            return True
        if t in recent_titles:
            return True
        # Fuzzy: yesterday headline contained in title or vice versa
        for recent in recent_titles:
            if len(recent) < 12:
                continue
            if recent in t or t in recent:
                return True
        return False

    def _matches_user_interests(article: Article) -> bool:
        """Interests if set; else tech-stack match; else configured-site learning only."""
        from src.extractors.topic_filter import has_tech_learning_signal

        hay = (
            f"{getattr(article, 'title', '')} "
            f"{getattr(article, 'summary', '')} "
            f"{' '.join(getattr(article, 'topics', None) or [])} "
            f"{str(getattr(article, 'body_text', '') or '')[:800]}"
        )
        title = str(getattr(article, "title", "") or "")
        if match_terms:
            return matches_any_term(hay, match_terms)
        if not has_tech_learning_signal(title, hay[:1500]):
            return False
        url = str(getattr(article, "url", "") or "")
        domain = str(getattr(article, "source_domain", "") or "").lower()
        host = ""
        if "://" in url:
            host = url.split("/")[2].lower()
        return (
            host in preferred_hosts
            or domain in preferred_hosts
            or host.endswith(".dev.to")
            or "dev.to" in host
            or "ycombinator" in host
        )

    def _accept(article: Article) -> bool:
        aid = _article_id(article)
        if not aid or aid in seen:
            return False
        if _title_blocked(str(getattr(article, "title", None) or "")):
            return False
        if not _matches_user_interests(article):
            return False
        hay = (
            f"{getattr(article, 'title', '')} "
            f"{getattr(article, 'summary', '')} "
            f"{' '.join(getattr(article, 'topics', None) or [])} "
            f"{str(getattr(article, 'body_text', '') or '')[:800]}"
        )
        if hay_is_off_yesterday_family(hay, profile):
            return False
        if is_non_learning(
            str(getattr(article, "title", None) or ""),
            str(getattr(article, "summary", None) or getattr(article, "body_text", None) or "")[:1500],
            list(getattr(article, "topics", None) or []),
            source_domain=str(getattr(article, "source_domain", None) or ""),
            url=str(getattr(article, "url", None) or ""),
        ):
            return False
        return True

    for article in pipeline_articles:
        if not _accept(article):
            continue
        seen.add(_article_id(article))
        merged.append(article)

    used_corpus = False
    # Only top up from corpus with the same hard rules (interest or site-tech)
    if len(merged) < max(4, limit):
        used_corpus = True
        corpus = await _corpus_candidates(profile, known_ids | seen)
        for article in corpus:
            if len(merged) >= max(limit * 2, 16):
                break
            if not _accept(article):
                continue
            seen.add(_article_id(article))
            merged.append(article)

    if not merged:
        return []

    pipeline_set = known_ids
    log.info(
        "ranker: pool",
        user_id=user_id,
        pipeline=len(pipeline_articles),
        accepted=len(merged),
        used_corpus=used_corpus,
    )

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

    # Keep today's scrape dominant — drop corpus hits when pipeline is rich enough
    if pipeline_set and not used_corpus:
        final_ids = [aid for aid in final_ids if aid in pipeline_set] or final_ids
    if pipeline_set:
        fresh = [aid for aid in final_ids if aid in pipeline_set]
        rest = [aid for aid in final_ids if aid not in pipeline_set]
        need_fresh = limit if not used_corpus else min(limit, max(3, (limit * 2 + 2) // 3))
        if len(fresh) < need_fresh:
            for article in ordered_articles:
                aid = _article_id(article)
                if aid in pipeline_set and aid not in fresh:
                    fresh.append(aid)
                if len(fresh) >= need_fresh:
                    break
        final_ids = (fresh + ([] if not used_corpus else rest))[:limit]

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
        if not isinstance(base, RankingBreakdown):
            base = RankingBreakdown()
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