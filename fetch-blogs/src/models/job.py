"""Pipeline job document tracking scrape → publish progress."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Literal

from beanie import Document, Indexed
from pydantic import BaseModel, Field


class PipelineStage(StrEnum):
    """Ordered Celery pipeline stages."""

    SCRAPE = "scrape"
    EXTRACT = "extract"
    RANK = "rank"
    GENERATE = "generate"
    PUBLISH = "publish"


class JobStatus(StrEnum):
    """Overall or per-stage job status."""

    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class StageResult(BaseModel):
    """Counts and timing for a single pipeline stage."""

    status: JobStatus = JobStatus.PENDING
    items_in: int = 0
    items_out: int = 0
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error: str = ""


class PipelineJob(Document):
    """One pipeline run for a user."""

    job_id: Indexed(str, unique=True)
    user_id: Indexed(str)
    status: JobStatus = JobStatus.PENDING
    current_stage: PipelineStage | None = None
    stages: dict[str, StageResult] = Field(default_factory=dict)
    triggered_by: Literal["cron", "manual", "api"] = "api"
    article_ids: list[str] = Field(default_factory=list)
    digest_id: str = ""
    error: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    class Settings:
        """Beanie collection settings."""

        name = "pipeline_jobs"
        indexes = [
            "job_id",
            "user_id",
            "created_at",
        ]
