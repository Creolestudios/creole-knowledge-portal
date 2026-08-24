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
from src.models.profile import UserProfile, scrape_focus_terms
from src.scrapers import fetch_devto_articles, fetch_hn_top_stories, parse_rss_feed
from src.workers.celery_app import celery_app
from src.workers.runtime import ensure_db, mark_stage, run_async

log = structlog.get_logger(__name__)

_MAX_ARTICLES = 24
_SKIP_ROBOTS_HOSTS = {"dev.to", "www.dev.to", "news.ycombinator.com", "hacker-news.firebaseio.com"}


def _matches_terms(text: str, terms: list[str]) -> bool:
    if not terms:
        return True
    haystack = text.lower()
    return any(term.lower() in haystack for term in terms if term)


def _collect_payloads(terms: list[str]) -> list[dict[str, object]]:
    """Use existing Strategy-A scrapers; return thin Article field dicts."""
    payloads: list[dict[str, object]] = []
    seen: set[str] = set()

    def add_legacy(article: object) -> None:
        raw = legacy_schema_to_payload(article)
        url = str(raw.get("url") or "")
        host = url.split("/")[2] if "://" in url else ""
        if not url or url in seen:
            return
        if host not in _SKIP_ROBOTS_HOSTS and not is_url_allowed(url):
            return
        seen.add(url)
        payloads.append(to_article_fields(raw))

    for term in terms[:4]:
        for article in fetch_devto_articles(tag=term or None, limit=6):
            add_legacy(article)

    for article in fetch_hn_top_stories(limit=8):
        title = str(getattr(article, "title", ""))
        if _matches_terms(title, terms):
            add_legacy(article)

    for source in sources_by_kind("rss"):
        feed_url = str(source.feed_url or "")
        if not feed_url:
            continue
        for article in parse_rss_feed(feed_url=feed_url, limit=3):
            title = str(getattr(article, "title", ""))
            summary = str(getattr(article, "body_text", ""))
            if _matches_terms(f"{title} {summary}", terms):
                add_legacy(article)

    return payloads


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

    terms = scrape_focus_terms(profile) or profile.ranking_terms
    already_served = {str(url).rstrip("/") for url in profile.learning_path.served_urls}
    discovered = _collect_payloads(terms)
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
