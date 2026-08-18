import logging
from datetime import datetime, timezone

import httpx

from src.config import settings
from src.services.supabase_profiles import upsert_mongo_profile

logger = logging.getLogger(__name__)


async def fetch_all_user_ids() -> list[str]:
    """Fetch registered user IDs from cloud Supabase for the daily cron."""
    url = f"{settings.SUPABASE_URL}/rest/v1/user_profiles"
    headers = {
        "apikey": settings.SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
    }
    params = {"select": "user_id"}

    logger.info("Fetching all active user IDs from Supabase for cron job...")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(url, headers=headers, params=params)
            if res.status_code == 200:
                data = res.json()
                return [item.get("user_id") for item in data if item.get("user_id")]
    except Exception as e:
        logger.error("Failed to fetch user list for cron job: %s", e)

    return []


def enqueue_user_pipeline(user_id: str) -> None:
    """Enqueue scrape → extract → rank → generate → publish for one user."""
    from src.api.routes.pipeline import build_pipeline_chain

    build_pipeline_chain(user_id).apply_async()


async def trigger_daily_briefings_job() -> None:
    """Enqueue the Celery pipeline for every Supabase user."""
    start_time = datetime.now(timezone.utc)
    logger.info("Starting scheduled daily briefing cron job at %s...", start_time.isoformat())

    user_ids = await fetch_all_user_ids()
    if not user_ids:
        logger.warning("No users found. Curation cron job skipped.")
        return

    success_count = 0
    failure_count = 0

    for uid in user_ids:
        try:
            logger.info("Enqueueing Celery pipeline for user: %s", uid)
            await upsert_mongo_profile(uid)
            enqueue_user_pipeline(uid)
            success_count += 1
        except Exception as e:
            logger.error("Cron job failed for user %s: %s", uid, e, exc_info=True)
            failure_count += 1

    logger.info(
        "Scheduled cron job finished. Successes: %s, Failures: %s, Duration: %ss",
        success_count,
        failure_count,
        (datetime.now(timezone.utc) - start_time).total_seconds(),
    )
