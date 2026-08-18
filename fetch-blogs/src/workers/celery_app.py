"""
Celery application factory — 5-queue pipeline configuration.

Queues (one container per queue):
  scrape_queue → extract_queue → rank_queue → generate_queue → publish_queue

Workers reference this module:
  celery -A src.workers.celery_app worker -Q scrape_queue ...
"""

from __future__ import annotations

from celery import Celery
from kombu import Queue

from src.core.config import get_app_settings, get_redis_settings

_cfg = get_redis_settings()
_app_cfg = get_app_settings()

celery_app = Celery(
    "knowledge_portal",
    broker=_cfg.URL,  # Redis db=0 — task messages
    backend=_cfg.RESULT_URL,  # Redis db=1 — task results
    include=[
        "src.workers.scraper_tasks",
        "src.workers.extractor_tasks",
        "src.workers.ranker_tasks",
        "src.workers.generator_tasks",
        "src.workers.publisher_tasks",
    ],
)

# ── Queue definitions ─────────────────────────────────────────────────────────
_QUEUES = (
    "scrape_queue",
    "extract_queue",
    "rank_queue",
    "generate_queue",
    "publish_queue",
)

celery_app.conf.update(
    # Routing
    task_queues=tuple(Queue(q) for q in _QUEUES),
    task_default_queue="scrape_queue",
    # Reliability
    task_acks_late=True,  # ACK only after task finishes (re-queue on worker crash)
    task_reject_on_worker_lost=True,  # Re-queue if worker process dies mid-task
    worker_prefetch_multiplier=1,  # Fair dispatch — no task hoarding
    # Serialisation — JSON only (never pickle)
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    # Result expiry
    result_expires=86_400,  # 24 hours
    # Time zones
    timezone="UTC",
    enable_utc=True,
    # Global safety limits (override per-task if needed)
    task_soft_time_limit=150,
    task_time_limit=180,  # 3 min hard cap — daily briefing, not a 70-min rewrite
    task_always_eager=_app_cfg.celery_eager,
    task_eager_propagates=True,
)
