"""Persist generated digests and update the user learning path."""

from __future__ import annotations

import re
from datetime import UTC, datetime

import structlog

from src.models.digest import DailyDigest
from src.models.profile import UserProfile, record_stack_run_progress, topic_tokens_from_text
from src.ranker.next_day import embed_and_store_digest

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
    """Append cited URLs, persist yesterday summary + digest embedding for next day."""
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
    headline = str(digest.content.headline or "").strip()
    if headline and not re.search(r"\.(pdf|zip|exe|dmg|tar|gz)\b", headline.lower()):
        tokens.extend(topic_tokens_from_text(headline))
    combined = list(dict.fromkeys(t for t in tokens if t))[:8]
    if combined:
        profile.learning_path.last_topics = combined

    # Never persist PDF/binary dump names as tomorrow's continuity headline
    if headline and not re.search(r"\.(pdf|zip|exe|dmg|tar|gz)\b", headline.lower()):
        if not headline.lower().startswith("next steps after:"):
            profile.learning_path.last_digest_headline = headline
        else:
            rest = headline.split(":", 1)[-1].strip()
            if not re.search(r"\.(pdf|zip|exe|dmg)\b", rest.lower()):
                profile.learning_path.last_digest_headline = rest or headline
    tldr = [
        str(item).strip() for item in (digest.content.tldr or []) if str(item).strip()
    ][:6]
    takeaways = [
        str(item).strip()
        for item in (digest.content.key_takeaways or [])
        if str(item).strip()
    ][:8]
    profile.learning_path.last_digest_tldr = tldr
    profile.learning_path.last_digest_takeaways = takeaways
    profile.learning_path.last_digest_date = digest.digest_date

    snippets = [
        str(section.content or "")[:800]
        for section in (digest.content.sections or [])[:4]
        if str(getattr(section, "content", "") or "").strip()
    ]
    vector = embed_and_store_digest(
        profile,
        headline=headline,
        tldr=tldr,
        takeaways=takeaways,
        section_snippets=snippets,
    )
    log.info(
        "publisher: last_digest_embedding stored",
        dims=len(vector),
        user_id=profile.user_id,
    )

    record_stack_run_progress(profile, combined)

    profile.updated_at = datetime.now(UTC)
    await profile.save()
