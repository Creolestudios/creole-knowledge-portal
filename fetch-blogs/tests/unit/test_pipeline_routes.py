"""Pipeline trigger route tests — Celery apply_async is stubbed."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.routes import pipeline as pipeline_mod


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
