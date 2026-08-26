"""Celery stage 1: discover preference-matched articles and insert thin docs."""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import structlog
from pymongo.errors import DuplicateKeyError

from src.adapters.article_payload import legacy_schema_to_payload, to_article_fields
from src.config.robots_cache import is_url_allowed
from src.config.source_registry import sources_by_kind
from src.models.article import Article
from src.models.job import JobStatus, PipelineJob, PipelineStage
from src.models.profile import UserProfile
from src.ranker.next_day import (
    interest_scrape_terms,
    profile_has_discovery_prefs,
    refresh_profile_embedding,
)
from src.scrapers import fetch_devto_articles, fetch_hn_top_stories, parse_rss_feed
from src.services.blog_sources import fetch_admin_blog_source_urls, scrape_admin_source_articles
from src.workers.celery_app import celery_app
from src.workers.runtime import ensure_db, mark_stage, run_async

log = structlog.get_logger(__name__)

_MAX_ARTICLES = 24
_DEVTO_PER_TAG = 4
_DEVTO_LATEST_LIMIT = 12  # untagged "today's latest" when admin prefs are empty
_HN_LIMIT = 16
_RSS_PER_FEED = 3
_ADMIN_FEED_LIMIT = 3
_SKIP_ROBOTS_HOSTS = {"dev.to", "www.dev.to", "news.ycombinator.com", "hacker-news.firebaseio.com"}


def _matches_terms(text: str, terms: list[str]) -> bool:
    if not terms:
        return True
    haystack = text.lower()
    return any(term.lower() in haystack for term in terms if term)


def _interleave(*buckets: list[dict[str, object]]) -> list[dict[str, object]]:
    """Round-robin merge so one source cannot starve the others."""
    out: list[dict[str, object]] = []
    max_len = max((len(b) for b in buckets), default=0)
    for i in range(max_len):
        for bucket in buckets:
            if i < len(bucket):
                out.append(bucket[i])
    return out


def _collect_payloads(
    terms: list[str],
    *,
    prefer_hn_match: bool = True,
    admin_source_urls: list[str] | None = None,
) -> list[dict[str, object]]:
    """Discover from Dev.to + HN + registry RSS + admin ``blog_sources`` URLs.

    Admin URLs (Admin → Sources) are scraped as RSS/Atom (with common feed path
    fallbacks) and interleaved with Dev.to / HN so they share the discovery pool.
    """
    seen: set[str] = set()
    devto: list[dict[str, object]] = []
    hn_matched: list[dict[str, object]] = []
    hn_other: list[dict[str, object]] = []
    rss: list[dict[str, object]] = []
    admin: list[dict[str, object]] = []

    def add_legacy(article: object, bucket: list[dict[str, object]]) -> None:
        raw = legacy_schema_to_payload(article)
        url = str(raw.get("url") or "")
        host = url.split("/")[2] if "://" in url else ""
        if not url or url in seen:
            return
        if host not in _SKIP_ROBOTS_HOSTS and not is_url_allowed(url):
            return
        seen.add(url)
        bucket.append(to_article_fields(raw))

    if terms:
        for term in [t for t in terms[:4] if t]:
            for article in fetch_devto_articles(tag=term, limit=_DEVTO_PER_TAG):
                add_legacy(article, devto)
    else:
        # No admin interests → that day's latest (untagged Dev.to + HN tops)
        for article in fetch_devto_articles(tag=None, limit=_DEVTO_LATEST_LIMIT):
            add_legacy(article, devto)

    for article in fetch_hn_top_stories(limit=_HN_LIMIT):
        title = str(getattr(article, "title", ""))
        if prefer_hn_match and terms and _matches_terms(title, terms):
            add_legacy(article, hn_matched)
        else:
            add_legacy(article, hn_other)

    hn = hn_matched + hn_other

    for source in sources_by_kind("rss"):
        feed_url = str(source.feed_url or "")
        if not feed_url:
            continue
        for article in parse_rss_feed(feed_url=feed_url, limit=_RSS_PER_FEED):
            title = str(getattr(article, "title", ""))
            summary = str(getattr(article, "body_text", ""))
            if not terms or _matches_terms(f"{title} {summary}", terms):
                add_legacy(article, rss)

    for article in scrape_admin_source_articles(
        admin_source_urls or [],
        limit_per_feed=_ADMIN_FEED_LIMIT,
    ):
        # Admin-registered feeds always contribute; ranker personalizes later
        add_legacy(article, admin)

    # Equal weight across HN, Dev.to, registry RSS, and admin-added feeds
    return _interleave(hn, devto, admin, rss)


async def _upsert_thin_article(payload: dict[str, object]) -> str | None:
    fields = to_article_fields(payload)
    existing = await Article.find_one(Article.url == fields["url"])
    if existing is not None and existing.id is not None:
        return str(existing.id)
    try:
        article = Article(**fields)
        await article.insert()
    except DuplicateKeyError:
        existing = await Article.find_one(Article.url == fields["url"])
        if existing is not None and existing.id is not None:
            return str(existing.id)
        return None
    if article.id is None:
        return None
    return str(article.id)


async def _scrape_for_user(user_id: str) -> list[str]:
    await ensure_db()
    job = PipelineJob(
        job_id=str(uuid4()),
        user_id=user_id,
        status=JobStatus.RUNNING,
        current_stage=PipelineStage.SCRAPE,
        triggered_by="api",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    await job.insert()
    await mark_stage(job, PipelineStage.SCRAPE, status=JobStatus.RUNNING)

    profile = await UserProfile.find_one(UserProfile.user_id == user_id)
    if profile is None:
        log.warning("scrape: profile missing", user_id=user_id)
        await mark_stage(
            job,
            PipelineStage.SCRAPE,
            status=JobStatus.FAILED,
            error="user profile not found in Mongo",
        )
        return []

    # Personalized scrape when admin filled stack/interests; else today's latest.
    has_prefs = profile_has_discovery_prefs(profile)
    terms = interest_scrape_terms(profile)
    if has_prefs and not terms:
        terms = profile.ranking_terms
    refresh_profile_embedding(profile)
    profile.updated_at = datetime.now(UTC)
    await profile.save()
    already_served = {str(url).rstrip("/") for url in profile.learning_path.served_urls}

    admin_urls = await fetch_admin_blog_source_urls()
    # Also honor per-profile preferred_sources if mirrored from Supabase
    extra = [*(admin_urls or []), *(profile.preferred_sources or [])]
    discovered = _collect_payloads(
        terms,
        prefer_hn_match=has_prefs,
        admin_source_urls=extra,
    )
    log.info(
        "scrape: discovery mode",
        user_id=user_id,
        personalized=has_prefs,
        terms=terms[:6],
        admin_feeds=len(extra),
        discovered=len(discovered),
    )
    # Only widen with ranking_terms when the user actually has prefs
    if has_prefs and len(discovered) < 6:
        widened = list(dict.fromkeys([*(terms or []), *profile.ranking_terms]))[:8]
        if widened != terms:
            discovered = (
                _collect_payloads(
                    widened,
                    prefer_hn_match=True,
                    admin_source_urls=extra,
                )
                or discovered
            )
    article_ids: list[str] = []
    seen: set[str] = set()
    from src.extractors.topic_filter import is_career_fluff

    for payload in discovered:
        if len(article_ids) >= _MAX_ARTICLES:
            break
        url = str(payload.get("url") or "").rstrip("/")
        title = str(payload.get("title") or "")
        summary = str(payload.get("summary") or "")
        if is_career_fluff(title, summary):
            continue
        if not url or url in seen or url in already_served:
            continue
        seen.add(url)
        article_id = await _upsert_thin_article(payload)
        if article_id:
            article_ids.append(article_id)

    job.article_ids = article_ids
    await mark_stage(
        job,
        PipelineStage.SCRAPE,
        status=JobStatus.SUCCEEDED,
        items_in=len(discovered),
        items_out=len(article_ids),
    )
    log.info("scrape: stored articles", user_id=user_id, count=len(article_ids), job_id=job.job_id)
    return article_ids


@celery_app.task(
    name="src.workers.scraper_tasks.scrape_sources",
    queue="scrape_queue",
    acks_late=True,
    max_retries=3,
    default_retry_delay=60,
)
def scrape_sources(user_id: str) -> list[str]:
    """Discover articles for a user and return inserted Article IDs."""
    return run_async(_scrape_for_user(user_id))


@celery_app.task(
    name="src.workers.scraper_tasks.run_scrape_stage",
    queue="scrape_queue",
    acks_late=True,
)
def run_scrape_stage(trigger: str = "cron") -> str:
    """Cron entry: enqueue the full pipeline for every Supabase user."""
    from src.scheduler.jobs import trigger_daily_briefings_job

    run_async(trigger_daily_briefings_job())
    return trigger
