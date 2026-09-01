import asyncio
import logging
import re
from datetime import date, datetime

from beanie import PydanticObjectId
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from src.api.routes.pipeline import run_celery_pipeline_and_wait
from src.core.db import ensure_db, init_db
from src.generator.synthesizer import synthesize_digest, _strip_blog_frontmatter
from src.models.article import Article
from src.api.routes.pipeline import execute_pipeline_for_user, build_pipeline_chain
from src.models.digest import DailyDigest
from src.models.job import PipelineJob
from src.models.profile import UserProfile
from src.publisher.mongo_publisher import upsert_digest
from src.services.supabase_profiles import upsert_mongo_profile
from src.storage.mongodb import get_db

logger = logging.getLogger("fastapi_service.digests")

router = APIRouter(prefix="/digests", tags=["digests"])


class GenerateRequest(BaseModel):
    userId: str


def _strip_matching_heading(title: str, content: str) -> str:
    """Drop a leading markdown heading that repeats the section title."""
    text = content.lstrip()
    for prefix in (f"# {title}", f"## {title}", f"### {title}"):
        if text.startswith(prefix):
            return text[len(prefix) :].lstrip("\n")
    return content


def _is_templated_briefing_headline(headline: str) -> bool:
    """True for filler like 'Your Morning Python & AI Briefing', not a real article title."""
    text = headline.strip().lower()
    if not text or text in {
        "morning briefing",
        "your morning briefing",
        "your morning technical briefing",
    }:
        return True
    return "briefing" in text and (text.startswith("your ") or text.startswith("morning "))


def _calendar_date_key(value: object) -> str | None:
    """YYYY-MM-DD as stored — never shift through a timezone."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date) and not isinstance(value, datetime):
        return value.isoformat()
    text = str(value).strip()
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        return text[:10]
    return None


def _is_junk_headline(headline: str) -> bool:
    text = (headline or "").strip().lower()
    if not text:
        return True
    if re.search(r"\.(pdf|zip|exe|dmg|tar|gz)\b", text):
        return True
    if text.startswith("next steps after:") and re.search(
        r"\.(pdf|zip|exe|dmg)\b", text
    ):
        return True
    return False


def _display_title(headline: str, article: dict) -> str:
    sources = article.get("sources") or []
    first_title = ""
    if sources:
        first = sources[0]
        first_title = (
            str(first.get("title") or "").strip()
            if isinstance(first, dict)
            else str(getattr(first, "title", "") or "").strip()
        )
    sections = article.get("sections") or []
    first_section = ""
    if sections:
        sec = sections[0]
        first_section = (
            str(sec.get("title") or "").strip()
            if isinstance(sec, dict)
            else str(getattr(sec, "title", "") or "").strip()
        )
        if first_section.lower() in {
            "why this matters today",
            "today's curated reading",
            "untitled",
            "brief",
            "code snippet",
            "overview / summary",
            "overview/summary",
            "continuation from yesterday",
        }:
            first_section = ""
    candidates = [headline, first_title, first_section]
    for candidate in candidates:
        text = str(candidate or "").strip()
        if not text or _is_junk_headline(text) or _is_templated_briefing_headline(text):
            continue
        return text
    return "Morning Briefing"


def _section_bucket(title: str) -> str:
    """Map a section title into the dashboard display order buckets."""
    text = title.strip().lower()
    if "code" in text:
        return "code"
    if text in {
        "brief",
        "why this matters today",
        "continuation from yesterday",
    } or text.startswith("brief"):
        return "brief"
    if "overview" in text or "summary" in text or text == "going deeper":
        return "overview"
    return "overview"


def _ordered_section_markdown(sections: list) -> list[str]:
    """Emit Brief → Code Snippet → Overview/Summary in that order."""
    from src.extractors.topic_filter import is_off_topic_lifestyle

    buckets: dict[str, list[str]] = {"brief": [], "code": [], "overview": []}
    for sec in sections:
        if not isinstance(sec, dict):
            sec = getattr(sec, "model_dump", lambda: {})()
        title = str(sec.get("title") or "Untitled")
        body = _strip_blog_frontmatter(
            _strip_matching_heading(title, str(sec.get("content") or "")).strip(),
        )
        if not body:
            continue
        # Never surface lifestyle how-tos (screenshots, golf, etc.) in the digest body
        if is_off_topic_lifestyle(title, body[:1500]):
            continue
        buckets[_section_bucket(title)].append(body)

    parts: list[str] = []
    if buckets["brief"]:
        parts.append("## Brief\n")
        parts.append("\n\n".join(buckets["brief"]))
        parts.append("")
    if buckets["code"]:
        parts.append("## Code Snippet\n")
        parts.append("\n\n".join(buckets["code"]))
        parts.append("")
    if buckets["overview"]:
        parts.append("## Overview / Summary\n")
        parts.append("\n\n".join(buckets["overview"]))
        parts.append("")
    return parts


def flat_map_digest_for_dashboard(doc: dict) -> dict:
    """Flatten a digest document into the dashboard blog shape.

    Display order (title is separate in the UI):
    Daily Overview → Brief → Code Snippet → Overview/Summary →
    Key Actionables → Sources & Citations.

    Accepts both the legacy hybrid shape (``article``) and Beanie DailyDigest
    (``content``).
    """
    article = doc.get("content") or doc.get("article") or {}
    headline = article.get("headline", "Morning Briefing")

    # Title is rendered by the dashboard heading — do not repeat it as markdown H1.
    markdown_parts: list[str] = []

    tldr = article.get("tldr", [])
    if tldr:
        markdown_parts.append("## Daily Overview (TL;DR)\n")
        for item in tldr:
            markdown_parts.append(f"- {item}")
        markdown_parts.append("")

    markdown_parts.extend(_ordered_section_markdown(article.get("sections") or []))

    takeaways = article.get("key_takeaways", [])
    if takeaways:
        markdown_parts.append("## Key Actionable Takeaways\n")
        for item in takeaways:
            markdown_parts.append(f"- {item}")
        markdown_parts.append("")

    sources_raw = article.get("sources", []) or []
    sections_for_cite = article.get("sections") or []
    cited_ids: set[int] = set()
    for sec in sections_for_cite:
        if not isinstance(sec, dict):
            sec = getattr(sec, "model_dump", lambda: {})()
        for item in sec.get("sources_cited") or []:
            try:
                cited_ids.add(int(item))
            except (TypeError, ValueError):
                continue

    from src.extractors.topic_filter import is_source_title_junk

    def _source_ok(src: dict) -> bool:
        title = str(src.get("title") or "").strip()
        url = str(src.get("url") or "").strip()
        if not title or not url or url == "#":
            return False
        if is_source_title_junk(title):
            return False
        # Keep cited sources even when the title lacks an obvious tech keyword
        return True

    sources: list = []
    for src in sources_raw:
        if not isinstance(src, dict):
            src = getattr(src, "model_dump", lambda: {})()
        if not _source_ok(src):
            continue
        src_id = src.get("id")
        if cited_ids and src_id is not None:
            try:
                if int(src_id) not in cited_ids:
                    continue
            except (TypeError, ValueError):
                pass
        sources.append(src)

    # If citation filtering emptied the list, keep tech-filtered sources only
    if not sources:
        for src in sources_raw:
            if not isinstance(src, dict):
                src = getattr(src, "model_dump", lambda: {})()
            if _source_ok(src):
                sources.append(src)

    # Last resort: further_reading links (still interest-filtered)
    if not sources:
        for item in article.get("further_reading") or []:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title") or "").strip()
            url = str(item.get("url") or "").strip()
            if not title or not url or url == "#":
                continue
            if is_source_title_junk(title):
                continue
            sources.append(
                {
                    "title": title,
                    "url": url,
                    "source_domain": "",
                    "author": "",
                }
            )

    # Always end the digest with Sources & Citations when we have real links
    if sources:
        markdown_parts.append("## Sources & Citations\n")
        for src in sources:
            if not isinstance(src, dict):
                src = getattr(src, "model_dump", lambda: {})()
            title = str(src.get("title") or "").strip() or "Source"
            url = str(src.get("url") or "").strip()
            domain = str(src.get("source_domain") or "").strip()
            author = str(src.get("author") or "").strip()
            if not url or url == "#":
                continue
            meta_bits = [bit for bit in [domain, author] if bit]
            meta = f" — {' · '.join(meta_bits)}" if meta_bits else ""
            markdown_parts.append(f"- [{title}]({url}){meta}")
        markdown_parts.append("")

    flat_tags = ["morning-briefing", "mongodb", "synthesis"]
    for src in sources:
        domain = src.get("source_domain", "") if isinstance(src, dict) else ""
        if domain and domain not in flat_tags:
            flat_tags.append(domain)

    generated_at = doc.get("generated_at")
    if isinstance(generated_at, datetime):
        generated_at = generated_at.isoformat()

    digest_date = _calendar_date_key(doc.get("digest_date")) or _calendar_date_key(generated_at)

    content = "\n".join(markdown_parts)
    derived_words = len(content.split())
    word_count = int(doc.get("word_count") or derived_words or 0)
    reading = doc.get("reading_time_minutes")
    if reading is None:
        reading = max(1.0, (word_count or derived_words) / 225.0)

    title = _display_title(str(headline or ""), article)

    return {
        "id": doc.get("id"),
        "title": title,
        "content": content,
        "published_at": generated_at,
        "digest_date": digest_date,
        "tags": flat_tags,
        "word_count": word_count,
        "estimated_read_minutes": max(1, round(float(reading))),
    }


def _serialize_digest(digest: DailyDigest) -> dict:
    payload = digest.model_dump(mode="json")
    payload["id"] = str(digest.id) if digest.id is not None else ""
    payload["article"] = payload.get("content") or {}
    return payload


async def _todays_digest(user_id: str) -> DailyDigest | None:
    """Return today's digest only (IST calendar day), or None if not generated yet."""
    from zoneinfo import ZoneInfo

    today = datetime.now(ZoneInfo("Asia/Kolkata")).date()
    return (
        await DailyDigest.find(
            DailyDigest.user_id == user_id,
            DailyDigest.digest_date == today,
        )
        .sort(-DailyDigest.generated_at)
        .first_or_none()
    )


async def _latest_digest(user_id: str) -> DailyDigest | None:
    """Prefer today's digest (IST calendar day), else the newest by generated_at."""
    todays = await _todays_digest(user_id)
    if todays is not None:
        return todays
    return (
        await DailyDigest.find(DailyDigest.user_id == user_id)
        .sort(-DailyDigest.generated_at)
        .first_or_none()
    )


def _parse_digest_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _generated_ts(doc: dict) -> str:
    value = doc.get("generated_at") or doc.get("updated_at") or doc.get("digest_date") or ""
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _doc_date_key(doc: dict) -> str:
    return (
        _calendar_date_key(doc.get("digest_date"))
        or _calendar_date_key(doc.get("generated_at"))
        or ""
    )


def _dedupe_digest_docs(raw: list[dict], digest_date: date | None) -> list[dict]:
    """One digest per calendar day, newest first — keeps yesterday and earlier."""
    by_day: dict[str, dict] = {}
    for doc in raw:
        key = _doc_date_key(doc)
        if not key:
            continue
        previous = by_day.get(key)
        if previous is None or _generated_ts(doc) >= _generated_ts(previous):
            by_day[key] = doc

    ordered = [by_day[key] for key in sorted(by_day, reverse=True)]
    if digest_date is None:
        return ordered
    wanted = digest_date.isoformat()
    return [doc for doc in ordered if _doc_date_key(doc) == wanted]


async def _existing_digest_days(user_id: str) -> set[str]:
    collection = DailyDigest.get_motor_collection()
    days: set[str] = set()
    async for doc in collection.find({"user_id": user_id}, {"digest_date": 1, "generated_at": 1}):
        key = _doc_date_key(doc)
        if key:
            days.add(key)
    return days


async def _backfill_orphan_digests(user_id: str) -> int:
    """Create missing daily_digests from jobs that scraped articles but never published."""
    profile = await UserProfile.find_one(UserProfile.user_id == user_id)
    if profile is None:
        return 0

    existing_days = await _existing_digest_days(user_id)
    jobs = await PipelineJob.find(PipelineJob.user_id == user_id).sort(-PipelineJob.created_at).to_list()
    best_job_by_day: dict[str, PipelineJob] = {}
    for job in jobs:
        if not job.article_ids:
            continue
        day = _calendar_date_key(job.created_at)
        if not day or day in existing_days:
            continue
        previous = best_job_by_day.get(day)
        if previous is None or len(job.article_ids) > len(previous.article_ids):
            best_job_by_day[day] = job

    saved = 0
    for day, job in best_job_by_day.items():
        articles: list[Article] = []
        for article_id in job.article_ids:
            try:
                article = await Article.get(PydanticObjectId(article_id))
            except Exception:
                article = None
            if article is not None:
                articles.append(article)
        if not articles:
            continue

        digest = synthesize_digest(
            profile,
            articles,
            digest_date=date.fromisoformat(day),
            scraped_only=True,
        )
        digest.generated_at = job.created_at
        digest.updated_at = job.created_at
        await upsert_digest(digest)
        existing_days.add(day)
        saved += 1
        logger.info(
            "backfill: stored orphan digest",
            user_id=user_id,
            digest_date=day,
            articles=len(articles),
        )
    return saved


async def _past_digest_docs(user_id: str, digest_date: date | None) -> list[dict]:
    """Load every stored digest for the user, including legacy hybrid documents.

    Beanie validation skips older ``article``/``generated_at`` rows that have no
    ``digest_date``/``content``. Raw collection reads keep yesterday and earlier.
    """
    collection = DailyDigest.get_motor_collection()
    raw: list[dict] = []
    async for doc in collection.find({"user_id": user_id}):
        payload = dict(doc)
        oid = payload.pop("_id", None)
        if oid is not None:
            payload["id"] = str(oid)
        raw.append(payload)
    return _dedupe_digest_docs(raw, digest_date)


@router.get("/{user_id}/past")
async def get_past_digests(user_id: str, date: str | None = None, flat: bool = True):
    """Return stored Mongo digests for the Past Blogs tab."""
    try:
        await ensure_db()
        await _backfill_orphan_digests(user_id)
        docs = await _past_digest_docs(user_id, _parse_digest_date(date))
        blogs = []
        for digest_dict in docs:
            blogs.append(flat_map_digest_for_dashboard(digest_dict) if flat else digest_dict)
        if date:
            return {"success": True, "blog": blogs[0] if blogs else None}
        return {"success": True, "blogs": blogs}
    except Exception as exc:
        logger.error("Failed to fetch past digests: %s", exc)
        raise HTTPException(
            status_code=500,
            detail=f"Database query failed: {str(exc)}",
        ) from exc


@router.post("/generate")
async def generate_digest(payload: GenerateRequest, flat: bool = True, wait: bool = True):
    """Sync profile, run the Celery scrape→publish chain, return the digest.

    Idempotent for the IST calendar day: if today's digest already exists,
    return it without re-running the pipeline.
    """
    if not payload.userId:
        raise HTTPException(status_code=400, detail="userId is required")

    try:
        await ensure_db()
        await upsert_mongo_profile(payload.userId)

        existing = await _todays_digest(payload.userId)
        if existing is not None:
            digest_dict = _serialize_digest(existing)
            if flat:
                return {
                    "success": True,
                    "blog": flat_map_digest_for_dashboard(digest_dict),
                    "cached": True,
                }
            return {"success": True, "blog": digest_dict, "cached": True}

        if not wait:
            # Enqueue Celery pipeline asynchronously and return immediately to prevent CloudFront 504
            build_pipeline_chain(payload.userId).apply_async()
            return {
                "success": True,
                "status": "generating",
                "message": "Synthesis pipeline initiated in the background.",
            }

        digest_id = await execute_pipeline_for_user(payload.userId)
        digest = None
        try:
            digest = await DailyDigest.get(PydanticObjectId(digest_id))
        except Exception:
            digest = None
        if digest is None:
            digest = await _latest_digest(payload.userId)
        if digest is None:
            raise RuntimeError("Pipeline completed but no digest was stored.")
        digest_dict = _serialize_digest(digest)
        if flat:
            return {"success": True, "blog": flat_map_digest_for_dashboard(digest_dict)}
        return {"success": True, "blog": digest_dict}
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        logger.error("Digest generation failed: %s", exc, exc_info=True)
        msg = str(exc)
        lower = msg.lower()
        if "429" in lower or "quota" in lower:
            raise HTTPException(
                status_code=429,
                detail=(
                    "Gemini API quota exceeded (429). "
                    "Daily free-tier limit reached — wait for reset or upgrade the API plan, "
                    "then retry synthesize."
                ),
            ) from exc
        raise HTTPException(
            status_code=500,
            detail=f"Synthesis pipeline error: {msg}",
        ) from exc


@router.get("/scraped-sources")
async def get_scraped_sources(limit: int = 50):
    """Queries MongoDB and returns the recently scraped site URLs with metadata."""
    db = get_db()
    try:
        cursor = db.scraped_sources.find().sort("scraped_at", -1).limit(limit)
        sources = []
        async for doc in cursor:
            doc["id"] = str(doc.pop("_id", ""))
            if isinstance(doc.get("scraped_at"), datetime):
                doc["scraped_at"] = doc["scraped_at"].isoformat()
            sources.append(doc)
        return {"success": True, "sources": sources}
    except Exception as e:
        logger.error("Failed to fetch scraped sources from MongoDB: %s", e)
        raise HTTPException(
            status_code=500,
            detail=f"Database query failed: {str(e)}",
        ) from e


@router.get("/{user_id}/latest")
async def get_latest_digest(user_id: str, flat: bool = True, today_only: bool = True):
    """Return today's digest for Daily Blog (synthesize CTA when missing).

    Set ``today_only=false`` to fall back to the newest prior digest.
    """
    try:
        await ensure_db()
        digest = await (_todays_digest(user_id) if today_only else _latest_digest(user_id))
        if digest is None:
            return {"success": True, "blog": None}
        digest_dict = _serialize_digest(digest)
        if flat:
            return {"success": True, "blog": flat_map_digest_for_dashboard(digest_dict)}
        return {"success": True, "blog": digest_dict}
    except Exception as exc:
        logger.error("Failed to fetch latest digest: %s", exc)
        raise HTTPException(
            status_code=500,
            detail=f"Database query failed: {str(exc)}",
        ) from exc


@router.post("/cron/trigger")
async def trigger_cron_manually(background_tasks: BackgroundTasks):
    """Manually triggers the daily briefing cron job in the background."""
    from src.scheduler.jobs import trigger_daily_briefings_job

    background_tasks.add_task(trigger_daily_briefings_job)
    return {
        "success": True,
        "message": "Daily briefing generation cron job successfully triggered in the background.",
    }
