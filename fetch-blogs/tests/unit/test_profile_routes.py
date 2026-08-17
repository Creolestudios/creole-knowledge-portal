"""Profile sync route tests."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.routes import profiles as profiles_mod
from src.models.profile import LearningPath, QuizOutcome, UserProfile


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(profiles_mod.router)
    return TestClient(app, raise_server_exceptions=False)


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_sync_inserts_profile(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_upsert(user_id: str) -> UserProfile:
        return UserProfile(
            user_id=user_id,
            name="Dev",
            primary_tech_stack=["python"],
            years_of_experience=3,
            updated_at=datetime.now(UTC),
        )

    monkeypatch.setattr(profiles_mod, "upsert_mongo_profile", fake_upsert)
    res = _client().post(
        "/profiles/u1/sync",
        headers={"X-Internal-Token": "change-me-to-a-32-char-secret"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["created"] is True
    assert "python" in body["ranking_terms"]


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_sync_preserves_learning_path(monkeypatch: pytest.MonkeyPatch) -> None:
    existing = UserProfile(
        user_id="u1",
        name="Old",
        learning_path=LearningPath(weak_topics=["hooks"], last_quiz_outcome=QuizOutcome.FAILED),
    )
    await existing.insert()

    async def fake_upsert(user_id: str) -> UserProfile:
        profile = await UserProfile.find_one(UserProfile.user_id == user_id)
        assert profile is not None
        profile.name = "New"
        profile.primary_tech_stack = ["react"]
        await profile.save()
        return profile

    monkeypatch.setattr(profiles_mod, "upsert_mongo_profile", fake_upsert)
    res = _client().post(
        "/profiles/u1/sync",
        headers={"X-Internal-Token": "change-me-to-a-32-char-secret"},
    )
    assert res.status_code == 200
    profile = await UserProfile.find_one(UserProfile.user_id == "u1")
    assert profile is not None
    assert profile.name == "New"
    assert profile.learning_path.weak_topics == ["hooks"]
