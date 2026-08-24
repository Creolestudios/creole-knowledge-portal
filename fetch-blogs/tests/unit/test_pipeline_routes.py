"""Pipeline trigger route tests — Celery apply_async is stubbed."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from src.api.deps import InternalTokenDep, RedisDep, _verify_internal_token
from src.api.routes import pipeline as pipeline_mod
from src.core.config import get_auth_settings
from src.core.redis import get_redis
from src.models.job import JobStatus, PipelineJob, PipelineStage
from src.schemas.pipeline import PipelineStatusOut, PipelineTriggerIn, PipelineTriggerOut


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(pipeline_mod.router)
    return TestClient(app, raise_server_exceptions=False)


def test_trigger_requires_internal_token() -> None:
    res = _client().post("/pipeline/trigger", json={"user_id": "u1"})
    assert res.status_code == 401


def test_trigger_enqueues_chain(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeChain:
        def apply_async(self) -> SimpleNamespace:
            return SimpleNamespace(id="task-1")

    async def _upsert(_uid: str) -> None:
        return None

    monkeypatch.setattr(pipeline_mod, "upsert_mongo_profile", _upsert)
    monkeypatch.setattr(pipeline_mod, "build_pipeline_chain", lambda _uid: FakeChain())
    res = _client().post(
        "/pipeline/trigger",
        json={"user_id": "u1"},
        headers={"X-Internal-Token": "change-me-to-a-32-char-secret"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["task_id"] == "task-1"
    assert body["user_id"] == "u1"


def test_trigger_returns_404_when_profile_sync_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _missing(_uid: str) -> None:
        raise ValueError("Supabase profile not found")

    monkeypatch.setattr(pipeline_mod, "upsert_mongo_profile", _missing)
    res = _client().post(
        "/pipeline/trigger",
        json={"user_id": "missing"},
        headers={"X-Internal-Token": "change-me-to-a-32-char-secret"},
    )
    assert res.status_code == 404
    assert "Supabase profile not found" in res.json()["detail"]


def test_build_pipeline_chain_returns_a_celery_chain() -> None:
    chain_obj = pipeline_mod.build_pipeline_chain("u1")
    assert hasattr(chain_obj, "apply_async")


def test_run_celery_pipeline_and_wait_returns_the_digest_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeResult:
        def get(self, timeout: int = 300) -> str:
            assert timeout == 300
            return "digest-99"

    class FakeChain:
        def apply_async(self) -> FakeResult:
            return FakeResult()

    monkeypatch.setattr(pipeline_mod, "build_pipeline_chain", lambda _uid: FakeChain())
    assert pipeline_mod.run_celery_pipeline_and_wait("u1") == "digest-99"


def test_run_celery_pipeline_and_wait_raises_when_chain_returns_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeResult:
        def get(self, timeout: int = 300) -> str:
            return ""

    class FakeChain:
        def apply_async(self) -> FakeResult:
            return FakeResult()

    monkeypatch.setattr(pipeline_mod, "build_pipeline_chain", lambda _uid: FakeChain())
    with pytest.raises(RuntimeError, match="without a digest id"):
        pipeline_mod.run_celery_pipeline_and_wait("u1", timeout=120)


@pytest.mark.asyncio
async def test_execute_pipeline_for_user_uses_custom_runner(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _runner(user_id: str) -> str:
        assert user_id == "u1"
        return "digest-custom"

    out = await pipeline_mod.execute_pipeline_for_user("u1", runner_func=_runner)
    assert out == "digest-custom"


@pytest.mark.asyncio
async def test_execute_pipeline_for_user_runs_in_process_when_celery_eager(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _Cfg:
        celery_eager = True

    async def _scrape(_uid: str) -> list[str]:
        return ["a1"]

    async def _extract(ids: list[str]) -> list[str]:
        return ids

    async def _rank(ids: list[str], _uid: str, _n: int) -> list[str]:
        return ids

    async def _generate(ids: list[str], _uid: str) -> str:
        assert ids == ["a1"]
        return "digest-eager"

    import src.core.config as core_config
    import src.workers.extractor_tasks as extractor_tasks
    import src.workers.generator_tasks as generator_tasks
    import src.workers.ranker_tasks as ranker_tasks
    import src.workers.scraper_tasks as scraper_tasks

    monkeypatch.setattr(core_config, "get_app_settings", lambda: _Cfg())
    monkeypatch.setattr(scraper_tasks, "_scrape_for_user", _scrape)
    monkeypatch.setattr(extractor_tasks, "_extract_articles", _extract)
    monkeypatch.setattr(ranker_tasks, "_rank_articles_for_user", _rank)
    monkeypatch.setattr(generator_tasks, "_generate_digest", _generate)

    out = await pipeline_mod.execute_pipeline_for_user("u1")
    assert out == "digest-eager"


@pytest.mark.asyncio
async def test_execute_pipeline_for_user_falls_back_to_celery_when_not_eager(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _Cfg:
        celery_eager = False

    import src.core.config as core_config

    monkeypatch.setattr(core_config, "get_app_settings", lambda: _Cfg())
    monkeypatch.setattr(
        pipeline_mod, "run_celery_pipeline_and_wait", lambda uid, timeout=300: f"celery-{uid}"
    )
    out = await pipeline_mod.execute_pipeline_for_user("u9", timeout=60)
    assert out == "celery-u9"


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_pipeline_status_returns_the_latest_job() -> None:
    await PipelineJob(
        job_id="job-latest",
        user_id="u1",
        status=JobStatus.RUNNING,
        current_stage=PipelineStage.RANK,
        article_ids=["a1"],
        digest_id="digest-1",
        error="",
    ).insert()

    res = _client().get("/pipeline/status/u1")
    assert res.status_code == 200
    body = res.json()
    assert body["job_id"] == "job-latest"
    assert body["user_id"] == "u1"
    assert body["status"] == "running"
    assert body["current_stage"] == "rank"
    assert body["article_ids"] == ["a1"]
    assert body["digest_id"] == "digest-1"


def test_pipeline_status_returns_404_when_no_job_exists() -> None:
    res = _client().get("/pipeline/status/nobody")
    assert res.status_code == 404
    assert "No pipeline job found" in res.json()["detail"]


def test_pipeline_schemas_apply_documented_defaults() -> None:
    trigger_in = PipelineTriggerIn(user_id="u1")
    trigger_out = PipelineTriggerOut(task_id="task-1", user_id="u1")
    status_out = PipelineStatusOut(user_id="u1", status="pending")

    assert trigger_in.user_id == "u1"
    assert trigger_out.success is True
    assert trigger_out.task_id == "task-1"
    assert status_out.success is True
    assert status_out.article_ids == []
    assert status_out.digest_id == ""
    assert status_out.error == ""


def test_internal_token_accepts_configured_secret() -> None:
    assert _verify_internal_token(get_auth_settings().SECRET_KEY) is None


def test_internal_token_rejects_missing_and_wrong_values() -> None:
    with pytest.raises(HTTPException) as missing:
        _verify_internal_token(None)
    assert missing.value.status_code == 401
    assert "X-Internal-Token" in missing.value.detail

    with pytest.raises(HTTPException) as wrong:
        _verify_internal_token("not-the-secret")
    assert wrong.value.status_code == 401


def test_dep_aliases_wire_redis_and_internal_token() -> None:
    assert RedisDep.__metadata__[0].dependency is get_redis
    assert InternalTokenDep.__metadata__[0].dependency is _verify_internal_token


def test_fastapi_resolves_redis_and_internal_token_deps() -> None:
    app = FastAPI()

    @app.get("/guarded")
    async def guarded(redis: RedisDep, _: InternalTokenDep) -> dict[str, bool]:
        return {"ok": bool(redis)}

    async def _fake_redis() -> SimpleNamespace:
        return SimpleNamespace(ping=lambda: True)

    app.dependency_overrides[get_redis] = _fake_redis
    client = TestClient(app, raise_server_exceptions=False)

    denied = client.get("/guarded")
    assert denied.status_code == 401

    allowed = client.get(
        "/guarded",
        headers={"X-Internal-Token": get_auth_settings().SECRET_KEY},
    )
    assert allowed.status_code == 200
    assert allowed.json() == {"ok": True}
