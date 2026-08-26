"""Persist generated digests and update the user learning path."""

from __future__ import annotations

from datetime import UTC, datetime

import structlog

from src.models.digest import DailyDigest
from src.models.profile import UserProfile, topic_tokens_from_text

log = structlog.get_logger(__name__)

_SERVED_URL_CAP = 100


async def upsert_digest(digest: DailyDigest) -> str:
    """Insert or replace the digest for (user_id, digest_date)."""
    existing = await DailyDigest.find_one(
        DailyDigest.user_id == digest.user_id,
        DailyDigest.digest_date == digest.digest_date,
    )
    if existing is None:
        await digest.insert()
        digest_id = str(digest.id)
        log.info("publisher: digest inserted", digest_id=digest_id)
        return digest_id

    existing.article_ids = digest.article_ids
    existing.content = digest.content
    existing.metrics = digest.metrics
    existing.word_count = digest.word_count
    existing.reading_time_minutes = digest.reading_time_minutes
    existing.strategy_used = digest.strategy_used
    existing.generated_at = digest.generated_at
    existing.updated_at = datetime.now(UTC)
    await existing.save()
    digest_id = str(existing.id)
    log.info("publisher: digest replaced", digest_id=digest_id)
    return digest_id


async def record_served_urls(digest: DailyDigest, profile: UserProfile) -> None:
    """Append cited source URLs and yesterday's briefing summary for next-day continuation."""
    served = [str(url) for url in profile.learning_path.served_urls]
    for source in digest.content.sources:
        url = str(source.url)
        if url not in served:
            served.append(url)
    profile.learning_path.served_urls = served[-_SERVED_URL_CAP:]

    titles = [
        str(source.title).strip()
        for source in digest.content.sources
        if str(getattr(source, "title", "") or "").strip()
    ]
    tokens: list[str] = []
    for title in titles:
        tokens.extend(topic_tokens_from_text(title))
    # Always persist themes for next-day scrape (tokens + raw titles as fallback)
    combined = list(dict.fromkeys([*tokens, *titles]))[:8]
    if combined:
        profile.learning_path.last_topics = combined

    # Persist briefing summary so tomorrow continues this series
    headline = str(digest.content.headline or "").strip()
    if headline:
        profile.learning_path.last_digest_headline = headline
    profile.learning_path.last_digest_tldr = [
        str(item).strip() for item in (digest.content.tldr or []) if str(item).strip()
    ][:6]
    profile.learning_path.last_digest_takeaways = [
        str(item).strip() for item in (digest.content.key_takeaways or []) if str(item).strip()
    ][:8]
    profile.learning_path.last_digest_date = digest.digest_date

    profile.updated_at = datetime.now(UTC)
    await profile.save()
