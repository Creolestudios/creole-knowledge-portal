"""Celery stage 5: mark the digest published and record served URLs."""

from __future__ import annotations

from datetime import UTC, datetime

import structlog
from beanie import PydanticObjectId

from src.models.digest import DailyDigest
from src.models.job import JobStatus, PipelineJob, PipelineStage
from src.models.profile import UserProfile
from src.publisher.mongo_publisher import record_served_urls
from src.workers.celery_app import celery_app
from src.workers.runtime import ensure_db, mark_stage, run_async

log = structlog.get_logger(__name__)


async def _publish_digest(digest_id: str) -> str:
    await ensure_db()
    if not digest_id:
        return ""
    digest = await DailyDigest.get(PydanticObjectId(digest_id))
    if digest is None:
        log.warning("publish: digest missing", digest_id=digest_id)
        return ""

    profile = await UserProfile.find_one(UserProfile.user_id == digest.user_id)
    if profile is None:
        return digest_id

    published_id = str(digest.id)
    await record_served_urls(digest, profile)
    job = (
        await PipelineJob.find(PipelineJob.user_id == digest.user_id)
        .sort(-PipelineJob.created_at)
        .first_or_none()
    )
    if job is not None:
        job.digest_id = published_id
        job.status = JobStatus.SUCCEEDED
        job.current_stage = PipelineStage.PUBLISH
        job.updated_at = datetime.now(UTC)
        await mark_stage(
            job,
            PipelineStage.PUBLISH,
            status=JobStatus.SUCCEEDED,
            items_in=1,
            items_out=1,
        )
    return published_id


@celery_app.task(
    name="src.workers.publisher_tasks.publish_digest",
    queue="publish_queue",
    acks_late=True,
    max_retries=3,
    default_retry_delay=60,
)
def publish_digest(digest_id: str) -> str:
    """Publish a generated digest and update the user learning path."""
    return run_async(_publish_digest(digest_id))
