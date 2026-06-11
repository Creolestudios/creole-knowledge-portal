import logging
import httpx
from datetime import datetime
from src.config import settings
from src.hybrid.coordinator import run_hybrid_pipeline

logger = logging.getLogger(__name__)

async def fetch_all_user_ids() -> list[str]:
    """
    Fetches all registered user IDs from Supabase to run daily briefings.
    """
    url = f"{settings.SUPABASE_URL}/rest/v1/user_profiles"
    headers = {
        "apikey": settings.SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}"
    }
    params = {
        "select": "user_id"
    }
    
    logger.info("Fetching all active user IDs from Supabase for cron job...")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(url, headers=headers, params=params)
            if res.status_code == 200:
                data = res.json()
                return [item.get("user_id") for item in data if item.get("user_id")]
    except Exception as e:
        logger.error(f"Failed to fetch user list for cron job: {e}")
        
    return []

async def trigger_daily_briefings_job():
    """
    Cron Job scheduled for 9:00 AM daily.
    Iterates through all users, runs the scrapers + Gemini synthesis, and saves to MongoDB.
    """
    start_time = datetime.utcnow()
    logger.info(f"Starting scheduled daily briefing cron job at {start_time.isoformat()}...")
    
    user_ids = await fetch_all_user_ids()
    if not user_ids:
        logger.warning("No users found. Curation cron job skipped.")
        return
        
    success_count = 0
    failure_count = 0
    
    for uid in user_ids:
        try:
            logger.info(f"Running automated daily briefing for user: {uid}")
            await run_hybrid_pipeline(uid)
            success_count += 1
        except Exception as e:
            logger.error(f"Cron job failed for user {uid}: {e}", exc_info=True)
            failure_count += 1
            
    logger.info(
        f"Scheduled cron job finished. Successes: {success_count}, Failures: {failure_count}, "
        f"Duration: {(datetime.utcnow() - start_time).total_seconds()}s"
    )
