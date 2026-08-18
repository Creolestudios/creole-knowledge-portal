"""Request and response models for pipeline trigger and status."""

from __future__ import annotations

from pydantic import BaseModel, Field


class PipelineTriggerIn(BaseModel):
    """Kick off scrape → extract → rank → generate → publish for one user."""

    user_id: str = Field(min_length=1)


class PipelineTriggerOut(BaseModel):
    """Celery chain id returned after enqueueing."""

    success: bool = True
    task_id: str
    user_id: str


class PipelineStatusOut(BaseModel):
    """Latest pipeline job for a user."""

    success: bool = True
    job_id: str | None = None
    user_id: str
    status: str | None = None
    current_stage: str | None = None
    article_ids: list[str] = Field(default_factory=list)
    digest_id: str = ""
    error: str = ""
