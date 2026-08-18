"""Shared Beanie bootstrap for Celery workers."""

from __future__ import annotations

import asyncio
from collections.abc import Coroutine
from datetime import UTC, datetime
from typing import TypeVar

from src.core.db import close_db, init_db
from src.models.article import Article
from src.models.job import JobStatus, PipelineJob, PipelineStage, StageResult

T = TypeVar("T")

_loop: asyncio.AbstractEventLoop | None = None


def run_async(coro: Coroutine[object, object, T]) -> T:
    """Run a coroutine on a process-wide loop that is never closed.

    Celery's solo pool runs scrape → extract → rank in the same process.
    ``asyncio.run()`` closes the loop after each task, and Motor then fails
    the next stage with "Event loop is closed".
    """
    global _loop
    if _loop is None or _loop.is_closed():
        close_db()
        _loop = asyncio.new_event_loop()
        asyncio.set_event_loop(_loop)
    return _loop.run_until_complete(coro)


async def ensure_db() -> None:
    """Initialize Beanie when the worker process has not already done so."""
    try:
        Article.get_motor_collection()
    except Exception:
        await init_db()


async def mark_stage(
    job: PipelineJob | None,
    stage: PipelineStage,
    *,
    status: JobStatus,
    items_in: int = 0,
    items_out: int = 0,
    error: str = "",
) -> None:
    """Persist per-stage progress onto a pipeline job."""
    if job is None:
        return
    now = datetime.now(UTC)
    result = job.stages.get(stage.value, StageResult())
    if status == JobStatus.RUNNING:
        result.started_at = now
        job.current_stage = stage
        job.status = JobStatus.RUNNING
    if status in {JobStatus.SUCCEEDED, JobStatus.FAILED}:
        result.finished_at = now
    result.status = status
    result.items_in = items_in
    result.items_out = items_out
    result.error = error
    job.stages[stage.value] = result
    if status == JobStatus.FAILED:
        job.status = JobStatus.FAILED
        job.error = error
    job.updated_at = now
    await job.save()
