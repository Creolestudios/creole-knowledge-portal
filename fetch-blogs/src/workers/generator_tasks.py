"""Celery stage 4: synthesize a DailyDigest from ranked article IDs."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import structlog
from beanie import PydanticObjectId

from src.generator.synthesizer import synthesize_digest
from src.models.article import Article
from src.models.digest import DailyDigest
from src.models.profile import UserProfile
from src.publisher.mongo_publisher import upsert_digest
from src.workers.celery_app import celery_app
from src.workers.runtime import ensure_db, run_async

log = structlog.get_logger(__name__)


def _today_ist() -> date:
    return datetime.now(ZoneInfo("Asia/Kolkata")).date()


async def _hydrate_previous_briefing(profile: UserProfile) -> None:
    """Load the prior digest into learning_path when summary fields are empty."""
    path = profile.learning_path
    if path.last_digest_headline and path.last_digest_tldr:
        return

    today = _today_ist()
    yesterday = today - timedelta(days=1)
    previous = (
        await DailyDigest.find(
            DailyDigest.user_id == profile.user_id,
            DailyDigest.digest_date == yesterday,
        )
        .sort(-DailyDigest.generated_at)
        .first_or_none()
    )
    if previous is None:
        previous = (
            await DailyDigest.find(
                DailyDigest.user_id == profile.user_id,
                DailyDigest.digest_date < today,
            )
            .sort(-DailyDigest.digest_date, -DailyDigest.generated_at)
            .first_or_none()
        )
    if previous is None:
        return

    content = previous.content
    if not path.last_digest_headline:
        path.last_digest_headline = str(content.headline or "").strip()
    if not path.last_digest_tldr:
        path.last_digest_tldr = [
            str(item).strip() for item in (content.tldr or []) if str(item).strip()
        ][:6]
    if not path.last_digest_takeaways:
        path.last_digest_takeaways = [
            str(item).strip() for item in (content.key_takeaways or []) if str(item).strip()
        ][:8]
    if path.last_digest_date is None:
        path.last_digest_date = previous.digest_date
    if not path.last_topics:
        titles = [
            str(source.title).strip()
            for source in (content.sources or [])
            if str(source.title).strip()
        ]
        path.last_topics = titles[:8]
    log.info(
        "generate: hydrated previous briefing",
        user_id=profile.user_id,
        headline=(path.last_digest_headline or "")[:80],
        digest_date=str(path.last_digest_date),
    )


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

    await _hydrate_previous_briefing(profile)

    digest = synthesize_digest(profile, articles)
    digest_id = await upsert_digest(digest)
    log.info(
        "generate: digest stored",
        digest_id=digest_id,
        user_id=user_id,
        words=digest.word_count,
        minutes=digest.reading_time_minutes,
    )
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
