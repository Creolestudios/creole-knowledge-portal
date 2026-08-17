"""Celery stage 4: synthesize a DailyDigest from ranked article IDs."""

from __future__ import annotations

import structlog
from beanie import PydanticObjectId

from src.generator.synthesizer import synthesize_digest
from src.models.article import Article
from src.models.profile import UserProfile
from src.publisher.mongo_publisher import upsert_digest
from src.workers.celery_app import celery_app
from src.workers.runtime import ensure_db, run_async

log = structlog.get_logger(__name__)


async def _generate_digest(article_ids: list[str], user_id: str) -> str:
    await ensure_db()
    profile = await UserProfile.find_one(UserProfile.user_id == user_id)
    if profile is None:
        log.warning("generate: profile missing", user_id=user_id)
        return ""

    articles: list[Article] = []
    for article_id in article_ids:
        article = await Article.get(PydanticObjectId(article_id))
        if article is not None:
            articles.append(article)
    if not articles:
        return ""

    digest = synthesize_digest(profile, articles)
    digest_id = await upsert_digest(digest)
    log.info("generate: digest stored", digest_id=digest_id, user_id=user_id)
    return digest_id


@celery_app.task(
    name="src.workers.generator_tasks.generate_digest",
    queue="generate_queue",
    acks_late=True,
    max_retries=3,
    default_retry_delay=60,
)
def generate_digest(article_ids: list[str], user_id: str) -> str:
    """Create a DailyDigest for the user from ranked article IDs."""
    return run_async(_generate_digest(article_ids or [], user_id))
