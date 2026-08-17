"""APScheduler configuration to trigger background Celery tasks."""

from __future__ import annotations

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from src.core.config import get_scraping_settings

log = structlog.get_logger(__name__)

_scheduler: AsyncIOScheduler | None = None


def _enqueue_pipeline() -> None:
    """Trigger the full Celery chain for every user."""
    from src.workers.celery_app import celery_app

    celery_app.send_task(
        "src.workers.scraper_tasks.run_scrape_stage",
        kwargs={"trigger": "cron"},
        queue="scrape_queue",
    )
    log.info("scheduler: pipeline enqueued", trigger="cron")


def start_scheduler() -> None:
    """Start the scheduler pool using env cron configurations."""
    global _scheduler
    cfg = get_scraping_settings()

    _scheduler = AsyncIOScheduler(timezone="UTC")

    minute, hour, day, month, day_of_week = cfg.CRON_SCHEDULE.split()
    _scheduler.add_job(
        _enqueue_pipeline,
        "cron",
        minute=minute,
        hour=hour,
        day=day,
        month=month,
        day_of_week=day_of_week,
        id="daily_pipeline",
        replace_existing=True,
    )
    _scheduler.start()
    log.info("scheduler: started", cron=cfg.CRON_SCHEDULE)


def stop_scheduler() -> None:
    """Stop the scheduler pool."""
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        log.info("scheduler: stopped")
