"""Celery stage 2: fill thin Article documents with body, topics, and embeddings."""

from __future__ import annotations

from datetime import UTC, datetime

import structlog
from beanie import PydanticObjectId

from src.core.config import get_scraping_settings
from src.extractors.article_body import extract_body
from src.extractors.embedding import embed_text
from src.extractors.topic_filter import infer_complexity, infer_tech_stack, infer_topics
from src.models.article import Article
from src.workers.celery_app import celery_app
from src.workers.runtime import ensure_db, run_async

log = structlog.get_logger(__name__)

_EXTRACT_LIMIT = 24
_LONG_ENOUGH = 400


async def _extract_articles(article_ids: list[str]) -> list[str]:
    await ensure_db()
    target = get_scraping_settings().DIGEST_WORD_TARGET
    kept: list[str] = []
    total_words = 0
    for article_id in article_ids[:_EXTRACT_LIMIT]:
        article = await Article.get(PydanticObjectId(article_id))
        if article is None:
            continue
        existing_words = len((article.body_text or "").split())
        if existing_words < _LONG_ENOUGH:
            extracted = extract_body(str(article.url))
            body = str(extracted.get("body_text") or "")
            if body:
                article.body_text = body
                article.summary = str(extracted.get("summary") or body[:400])
                extracted_title = str(extracted.get("title") or "").strip()
                if extracted_title:
                    article.title = extracted_title[:500]
                author = extracted.get("author")
                if author:
                    article.author = str(author)
                tags = extracted.get("tags") if isinstance(extracted.get("tags"), list) else []
                article.topics = infer_topics(body, [str(tag) for tag in tags])
                article.tech_stack = infer_tech_stack(body, article.topics)
                article.complexity_level = infer_complexity(body)
                if not article.embedding:
                    article.embedding = embed_text(f"{article.title}\n{body[:2000]}")
                article.updated_at = datetime.now(UTC)
                await article.save()
        kept.append(article_id)
        total_words += len((article.body_text or "").split())
        if total_words >= target:
            break
    log.info("extract: enriched articles", count=len(kept), words=total_words)
    return kept


@celery_app.task(
    name="src.workers.extractor_tasks.extract_articles",
    queue="extract_queue",
    acks_late=True,
    max_retries=3,
    default_retry_delay=60,
)
def extract_articles(article_ids: list[str]) -> list[str]:
    """Load article IDs, extract bodies, and return the same IDs."""
    return run_async(_extract_articles(article_ids or []))
