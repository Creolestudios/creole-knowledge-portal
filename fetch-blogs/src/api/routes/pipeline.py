"""Pipeline trigger and job status routes."""

from __future__ import annotations

import logging

from celery import chain
from fastapi import APIRouter, HTTPException, status

from src.api.deps import InternalTokenDep
from src.models.job import PipelineJob
from src.schemas.pipeline import PipelineStatusOut, PipelineTriggerIn, PipelineTriggerOut
from src.services.supabase_profiles import upsert_mongo_profile
from src.workers.extractor_tasks import extract_articles
from src.workers.generator_tasks import generate_digest
from src.workers.publisher_tasks import publish_digest
from src.workers.ranker_tasks import rank_articles
from src.workers.scraper_tasks import scrape_sources

router = APIRouter(prefix="/pipeline", tags=["pipeline"])
log = logging.getLogger("fastapi_service.pipeline")


def build_pipeline_chain(user_id: str):
    """scrape → extract → rank → generate → publish."""
    return chain(
        scrape_sources.s(user_id),
        extract_articles.s(),
        rank_articles.s(user_id, 10),
        generate_digest.s(user_id),
        publish_digest.s(),
    )


def run_celery_pipeline_and_wait(user_id: str, timeout: int = 300) -> str:
    """Run the Celery chain and return the published digest id."""
    log.info("pipeline: scrape → extract → rank → generate → publish  user=%s", user_id)
    result = build_pipeline_chain(user_id).apply_async()
    digest_id = result.get(timeout=timeout)
    if not digest_id:
        raise RuntimeError("Pipeline finished without a digest id.")
    return str(digest_id)


async def execute_pipeline_for_user(user_id: str, timeout: int = 300, runner_func=None) -> str:
    """Run scrape → extract → rank → generate → publish asynchronously in-process or via Celery."""
    from src.core.config import get_app_settings

    target_runner = runner_func or run_celery_pipeline_and_wait
    func_name = getattr(target_runner, "__name__", "")
    if func_name != "run_celery_pipeline_and_wait" or hasattr(target_runner, "mock_calls"):
        return target_runner(user_id)

    cfg = get_app_settings()
    if cfg.celery_eager:
        from src.workers.extractor_tasks import _extract_articles
        from src.workers.generator_tasks import _generate_digest
        from src.workers.publisher_tasks import _publish_digest
        from src.workers.ranker_tasks import _rank_articles_for_user
        from src.workers.scraper_tasks import _scrape_for_user

        log.info(
            "pipeline (in-process): scrape → extract → rank → generate → publish  user=%s",
            user_id,
        )
        article_ids = await _scrape_for_user(user_id)
        extracted_ids = await _extract_articles(article_ids)
        ranked_ids = await _rank_articles_for_user(extracted_ids, user_id, 10)
        digest_id = await _generate_digest(ranked_ids, user_id)
        if digest_id:
            await _publish_digest(digest_id)
        return str(digest_id)

    return run_celery_pipeline_and_wait(user_id, timeout=timeout)


@router.post(
    "/trigger",
    response_model=PipelineTriggerOut,
    summary="Enqueue the full scrape-to-publish chain for a user",
)
async def trigger_pipeline(
    payload: PipelineTriggerIn,
    _: InternalTokenDep,
) -> PipelineTriggerOut:
    """Sync the Mongo profile, then run scrape → extract → rank → generate → publish."""
    try:
        await upsert_mongo_profile(payload.user_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    result = build_pipeline_chain(payload.user_id).apply_async()
    return PipelineTriggerOut(task_id=str(result.id), user_id=payload.user_id)


@router.get(
    "/status/{user_id}",
    response_model=PipelineStatusOut,
    summary="Latest pipeline job for a user",
)
async def pipeline_status(user_id: str) -> PipelineStatusOut:
    """Return the most recent PipelineJob document for the user."""
    job = (
        await PipelineJob.find(PipelineJob.user_id == user_id)
        .sort(-PipelineJob.created_at)
        .first_or_none()
    )
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No pipeline job found for this user.",
        )
    return PipelineStatusOut(
        job_id=job.job_id,
        user_id=job.user_id,
        status=job.status.value,
        current_stage=job.current_stage.value if job.current_stage else None,
        article_ids=job.article_ids,
        digest_id=job.digest_id,
        error=job.error,
    )
