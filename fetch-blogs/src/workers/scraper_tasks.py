"""Celery stage 1: discover interest-matched or stack-trending articles."""

from __future__ import annotations

from datetime import UTC, datetime
from urllib.parse import urlparse
from uuid import uuid4

import structlog
from pymongo.errors import DuplicateKeyError

from src.adapters.article_payload import legacy_schema_to_payload, to_article_fields
from src.config.robots_cache import is_url_allowed
from src.config.source_registry import SOURCE_REGISTRY, sources_by_kind
from src.models.article import Article
from src.models.job import JobStatus, PipelineJob, PipelineStage
from src.models.profile import UserProfile
from src.ranker.next_day import (
    continuity_scrape_terms,
    discovery_match_terms,
    discovery_scrape_terms,
    hay_is_off_yesterday_family,
    profile_has_interests,
    profile_has_yesterday,
    refresh_profile_embedding,
)
from src.scrapers import fetch_devto_articles, fetch_hn_top_stories, parse_rss_feed
from src.services.blog_sources import fetch_admin_blog_source_urls, scrape_admin_source_articles
from src.workers.celery_app import celery_app
from src.workers.runtime import ensure_db, mark_stage, run_async

log = structlog.get_logger(__name__)

_MAX_ARTICLES = 24
_DEVTO_PER_TAG = 4
_DEVTO_TRENDING_LIMIT = 12
_HN_LIMIT = 16
_HN_TRENDING_LIMIT = 12
_RSS_PER_FEED = 3
_ADMIN_FEED_LIMIT = 4
_SKIP_ROBOTS_HOSTS = {"dev.to", "www.dev.to", "news.ycombinator.com", "hacker-news.firebaseio.com"}
_REGISTRY_HOSTS = frozenset(
    {
        "dev.to",
        "www.dev.to",
        "news.ycombinator.com",
        "hacker-news.firebaseio.com",
    }
)


def _matches_terms(text: str, terms: list[str]) -> bool:
    from src.extractors.topic_filter import matches_any_term

    return matches_any_term(text, terms)


def _host_of(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower()
    except Exception:
        return ""


def _configured_hosts(admin_source_urls: list[str] | None = None) -> set[str]:
    """Hosts we are allowed to pull trending posts from (registry + admin sites)."""
    hosts = set(_REGISTRY_HOSTS)
    for source in SOURCE_REGISTRY:
        for raw in (source.base_url, source.feed_url):
            if raw is None:
                continue
            host = _host_of(str(raw))
            if host:
                hosts.add(host)
    for url in admin_source_urls or []:
        host = _host_of(str(url))
        if host:
            hosts.add(host)
            if host.startswith("www."):
                hosts.add(host[4:])
            else:
                hosts.add(f"www.{host}")
    return hosts


def _is_from_configured_sites(url: str, allowed_hosts: set[str]) -> bool:
    host = _host_of(url)
    if not host:
        return False
    if host in allowed_hosts:
        return True
    if host.startswith("www.") and host[4:] in allowed_hosts:
        return True
    if f"www.{host}" in allowed_hosts:
        return True
    return False


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
    trending_mode: bool = False,
    continuity_terms: list[str] | None = None,
) -> list[dict[str, object]]:
    """Discover posts for interests, or stack-tagged trending when interests empty.

    Interests / stack tags (terms set): Dev.to by tag + HN/RSS/admin only when
    the title matches those terms. Untagged latest is used only when the user
    has neither interests nor a tech stack.
    """
    from src.extractors.topic_filter import has_tech_learning_signal

    _ = prefer_hn_match  # kept for call-site compatibility
    seen: set[str] = set()
    devto_continuity: list[dict[str, object]] = []
    devto_trending: list[dict[str, object]] = []
    hn_matched: list[dict[str, object]] = []
    rss: list[dict[str, object]] = []
    admin: list[dict[str, object]] = []
    allowed_hosts = _configured_hosts(admin_source_urls)
    cont = [t for t in (continuity_terms or [])[:4] if t]

    def add_legacy(
        article: object,
        bucket: list[dict[str, object]],
        *,
        require_trending_site: bool = False,
        require_continuity_match: bool = False,
    ) -> None:
        raw = legacy_schema_to_payload(article)
        url = str(raw.get("url") or "")
        title = str(raw.get("title") or "")
        summary = str(raw.get("summary") or raw.get("body_text") or "")
        host = url.split("/")[2] if "://" in url else ""
        if not url or url in seen:
            return
        if title.lower().endswith((".pdf", ".zip", ".exe", ".dmg")):
            return
        if url.lower().endswith((".pdf", ".zip", ".exe", ".dmg")):
            return
        hay = f"{title} {summary}"
        if trending_mode and not has_tech_learning_signal(title, summary[:1500]):
            return
        if require_continuity_match and cont and not _matches_terms(hay, cont):
            return
        if require_trending_site and not _is_from_configured_sites(url, allowed_hosts):
            return
        if host not in _SKIP_ROBOTS_HOSTS and not is_url_allowed(url):
            return
        seen.add(url)
        bucket.append(to_article_fields(raw))

    if terms:
        for term in [t for t in terms[:4] if t]:
            for article in fetch_devto_articles(tag=term, limit=_DEVTO_PER_TAG):
                add_legacy(article, devto_trending)
        for article in fetch_hn_top_stories(limit=_HN_LIMIT):
            title = str(getattr(article, "title", ""))
            if _matches_terms(title, terms):
                add_legacy(article, hn_matched)
    else:
        # No interests: continue yesterday's theme + today's trending tech
        if cont:
            for term in cont:
                for article in fetch_devto_articles(tag=term, limit=_DEVTO_PER_TAG):
                    add_legacy(
                        article,
                        devto_continuity,
                        require_continuity_match=True,
                    )
            for article in fetch_hn_top_stories(limit=_HN_LIMIT):
                title = str(getattr(article, "title", ""))
                if _matches_terms(title, cont):
                    add_legacy(
                        article,
                        hn_matched,
                        require_continuity_match=True,
                    )
        if trending_mode:
            for article in fetch_devto_articles(tag=None, limit=_DEVTO_TRENDING_LIMIT):
                add_legacy(article, devto_trending, require_trending_site=True)
            for article in fetch_hn_top_stories(limit=_HN_TRENDING_LIMIT):
                add_legacy(article, hn_matched, require_trending_site=True)

    for source in sources_by_kind("rss"):
        feed_url = str(source.feed_url or "")
        if not feed_url:
            continue
        for article in parse_rss_feed(feed_url=feed_url, limit=_RSS_PER_FEED):
            title = str(getattr(article, "title", ""))
            summary = str(getattr(article, "body_text", ""))
            hay = f"{title} {summary}"
            if terms:
                if not _matches_terms(hay, terms):
                    continue
                add_legacy(article, rss)
            elif cont and _matches_terms(hay, cont):
                add_legacy(article, rss, require_continuity_match=True)
            elif trending_mode:
                add_legacy(article, rss, require_trending_site=True)

    for article in scrape_admin_source_articles(
        admin_source_urls or [],
        limit_per_feed=_ADMIN_FEED_LIMIT,
    ):
        title = str(getattr(article, "title", ""))
        summary = str(getattr(article, "body_text", "") or getattr(article, "summary", ""))
        hay = f"{title} {summary}"
        if terms:
            if not _matches_terms(hay, terms):
                continue
            add_legacy(article, admin)
        elif cont and _matches_terms(hay, cont):
            add_legacy(article, admin, require_continuity_match=True)
        elif trending_mode:
            add_legacy(article, admin, require_trending_site=True)

    return _interleave(devto_continuity, devto_trending, hn_matched, admin, rss)


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

    has_interests = profile_has_interests(profile)
    returning = (not has_interests) and profile_has_yesterday(profile)
    scrape_terms = discovery_scrape_terms(profile)
    match_terms = discovery_match_terms(profile)
    continuity_terms = continuity_scrape_terms(profile) if returning else None
    refresh_profile_embedding(profile)
    profile.updated_at = datetime.now(UTC)
    await profile.save()
    already_served = {str(url).rstrip("/") for url in profile.learning_path.served_urls}

    admin_urls = await fetch_admin_blog_source_urls()
    extra = [*(admin_urls or []), *(profile.preferred_sources or [])]
    discovered = _collect_payloads(
        scrape_terms,
        prefer_hn_match=bool(scrape_terms),
        admin_source_urls=extra,
        trending_mode=not match_terms,
        continuity_terms=continuity_terms,
    )
    if has_interests:
        mode = "interests"
    elif returning:
        mode = "continuity"
    elif match_terms:
        mode = "stack_trending"
    else:
        mode = "unscoped_learning"
    log.info(
        "scrape: discovery mode",
        user_id=user_id,
        mode=mode,
        terms=scrape_terms[:6],
        match=match_terms[:6],
        admin_feeds=len(extra),
        discovered=len(discovered),
    )
    article_ids: list[str] = []
    seen: set[str] = set()
    from src.extractors.topic_filter import has_tech_learning_signal, is_non_learning

    allowed_hosts = _configured_hosts(extra)

    for payload in discovered:
        if len(article_ids) >= _MAX_ARTICLES:
            break
        url = str(payload.get("url") or "").rstrip("/")
        title = str(payload.get("title") or "")
        summary = str(payload.get("summary") or "")
        domain = str(payload.get("source_domain") or "")
        if is_non_learning(title, summary, source_domain=domain, url=url):
            continue
        if not has_interests and hay_is_off_yesterday_family(f"{title} {summary}", profile):
            continue
        if match_terms:
            if not _matches_terms(f"{title} {summary}", match_terms):
                continue
        else:
            if not has_tech_learning_signal(title, summary):
                continue
            if not _is_from_configured_sites(url, allowed_hosts):
                continue
        if not url or url in seen or url in already_served:
            continue
        seen.add(url)
        article_id = await _upsert_thin_article(payload)
        if article_id:
            article_ids.append(article_id)

    # Last resort: corpus — still interest-matched or configured-site tech only
    if not article_ids:
        log.warning(
            "scrape: no new URLs; falling back to filtered corpus",
            user_id=user_id,
            mode=mode,
        )
        cursor = Article.find_all().sort(-Article.created_at).limit(80)
        async for article in cursor:
            if len(article_ids) >= _MAX_ARTICLES:
                break
            url = str(article.url or "").rstrip("/")
            if not url or url in already_served or url in seen:
                continue
            if article.id is None:
                continue
            title = str(article.title or "")
            summary = str(article.summary or article.body_text or "")[:1500]
            if is_non_learning(
                title,
                summary,
                source_domain=str(article.source_domain or ""),
                url=url,
            ):
                continue
            if not has_interests and hay_is_off_yesterday_family(f"{title} {summary}", profile):
                continue
            if match_terms:
                if not _matches_terms(f"{title} {summary}", match_terms):
                    continue
            else:
                if not _is_from_configured_sites(url, allowed_hosts):
                    continue
                if not has_tech_learning_signal(title, summary):
                    continue
            seen.add(url)
            article_ids.append(str(article.id))

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
