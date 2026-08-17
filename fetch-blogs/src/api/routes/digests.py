import logging
from datetime import datetime

from beanie import PydanticObjectId
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from src.api.routes.pipeline import run_celery_pipeline_and_wait
from src.models.digest import DailyDigest
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


def flat_map_digest_for_dashboard(doc: dict) -> dict:
    """Flatten a digest document into the dashboard blog shape.

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

    for sec in article.get("sections", []):
        title = str(sec.get("title") or "Untitled")
        markdown_parts.append(f"## {title}\n")
        markdown_parts.append(_strip_matching_heading(title, str(sec.get("content") or "")))
        markdown_parts.append("")

    takeaways = article.get("key_takeaways", [])
    if takeaways:
        markdown_parts.append("## Key Actionable Takeaways\n")
        for item in takeaways:
            markdown_parts.append(f"- {item}")
        markdown_parts.append("")

    sources = article.get("sources", [])
    if sources:
        markdown_parts.append("## Sources & Citations\n")
        for src in sources:
            if not isinstance(src, dict):
                src = getattr(src, "model_dump", lambda: {})()
            author_str = f" by {src.get('author')}" if src.get("author") else ""
            markdown_parts.append(
                f"- **[{src.get('title')}]({src.get('url')})** — Published on "
                f"*{src.get('source_domain')}*{author_str}"
            )
        markdown_parts.append("")

    flat_tags = ["morning-briefing", "mongodb", "synthesis"]
    for src in sources:
        domain = src.get("source_domain", "") if isinstance(src, dict) else ""
        if domain and domain not in flat_tags:
            flat_tags.append(domain)

    generated_at = doc.get("generated_at")
    if isinstance(generated_at, datetime):
        generated_at = generated_at.isoformat()

    content = "\n".join(markdown_parts)
    derived_words = len(content.split())
    word_count = int(doc.get("word_count") or derived_words or 0)
    reading = doc.get("reading_time_minutes")
    if reading is None:
        reading = max(1.0, (word_count or derived_words) / 225.0)

    return {
        "id": doc.get("id"),
        "title": headline,
        "content": content,
        "published_at": generated_at,
        "tags": flat_tags,
        "word_count": word_count,
        "estimated_read_minutes": max(1, round(float(reading))),
    }


def _serialize_digest(digest: DailyDigest) -> dict:
    payload = digest.model_dump(mode="json")
    payload["id"] = str(digest.id) if digest.id is not None else ""
    payload["article"] = payload.get("content") or {}
    return payload


async def _latest_digest(user_id: str) -> DailyDigest | None:
    return (
        await DailyDigest.find(DailyDigest.user_id == user_id)
        .sort(-DailyDigest.generated_at)
        .first_or_none()
    )


@router.post("/generate")
async def generate_digest(payload: GenerateRequest, flat: bool = True):
    """Sync profile, run the Celery scrape→publish chain, return the digest."""
    if not payload.userId:
        raise HTTPException(status_code=400, detail="userId is required")

    try:
        await upsert_mongo_profile(payload.userId)
        digest_id = run_celery_pipeline_and_wait(payload.userId)
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
        raise HTTPException(
            status_code=500,
            detail=f"Synthesis pipeline error: {str(exc)}",
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
async def get_latest_digest(user_id: str, flat: bool = True):
    """Return the newest Beanie DailyDigest for the user."""
    try:
        digest = await _latest_digest(user_id)
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
