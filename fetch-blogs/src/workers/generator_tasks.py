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


async def _fallback_articles(profile: UserProfile, limit: int = 10) -> list[Article]:
    """Corpus fallback: interest match, else stack match, else configured-site learning."""
    from src.extractors.topic_filter import (
        has_tech_learning_signal,
        is_non_learning,
        matches_any_term,
    )
    from src.ranker.next_day import discovery_match_terms

    served = {str(url).rstrip("/") for url in profile.learning_path.served_urls}
    match_terms = discovery_match_terms(profile)
    site_hosts = {
        "dev.to",
        "www.dev.to",
        "news.ycombinator.com",
        "hacker-news.firebaseio.com",
    }
    out: list[Article] = []
    cursor = Article.find_all().sort(-Article.created_at).limit(80)
    async for article in cursor:
        url = str(article.url or "").rstrip("/")
        if url and url in served:
            continue
        if not (article.body_text or "").strip():
            continue
        title = str(article.title or "")
        body = str(article.body_text or "")[:1500]
        if is_non_learning(
            title,
            body,
            list(article.topics or []),
            source_domain=str(article.source_domain or ""),
            url=url,
        ):
            continue
        hay = f"{title} {body} {' '.join(article.topics or [])}"
        if match_terms:
            if not matches_any_term(hay, match_terms):
                continue
        else:
            host = url.split("/")[2].lower() if "://" in url else ""
            domain = str(article.source_domain or "").lower()
            site_ok = host in site_hosts or domain in site_hosts
            if not site_ok:
                continue
            if not has_tech_learning_signal(title, body):
                continue
        out.append(article)
        if len(out) >= limit:
            break
    return out


async def _generate_digest(article_ids: list[str], user_id: str) -> str:
    await ensure_db()
    profile = await UserProfile.find_one(UserProfile.user_id == user_id)
    if profile is None:
        log.warning("generate: profile missing", user_id=user_id)
        raise RuntimeError(f"Cannot synthesize: profile missing for {user_id}")

    articles: list[Article] = []
    for article_id in article_ids:
        article = await Article.get(PydanticObjectId(article_id))
        if article is not None:
            articles.append(article)
    if not articles:
        articles = await _fallback_articles(profile)
        log.warning(
            "generate: empty ranked pool, using corpus fallback",
            user_id=user_id,
            count=len(articles),
        )
    if not articles:
        raise RuntimeError(
            "Cannot synthesize: no articles available after scrape/rank "
            "(and no unserved corpus articles)."
        )

    await _hydrate_previous_briefing(profile)

    digest = synthesize_digest(profile, articles)
    digest_id = await upsert_digest(digest)
    if not digest_id:
        raise RuntimeError("Cannot synthesize: digest upsert returned empty id.")
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
    max_retries=2,
    default_retry_delay=60,
    soft_time_limit=540,
    time_limit=600,
)
def generate_digest(article_ids: list[str], user_id: str) -> str:
    """Create a DailyDigest for the user from ranked article IDs."""
    ids = [aid for aid in (article_ids or []) if aid]
    if not ids:
        return ""
    return run_async(_generate_digest(ids, user_id))
