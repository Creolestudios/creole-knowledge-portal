"""Profile sync route tests."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.routes import profiles as profiles_mod
from src.models.profile import DifficultyDirection, LearningPath, QuizOutcome, UserProfile


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


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_quiz_result_marks_weak_topics() -> None:
    existing = UserProfile(
        user_id="u1",
        name="Dev",
        learning_path=LearningPath(last_topics=["python"]),
    )
    await existing.insert()

    res = _client().post(
        "/profiles/u1/quiz",
        headers={"X-Internal-Token": "change-me-to-a-32-char-secret"},
        json={"score": 1, "total": 5},
    )
    assert res.status_code == 200
    profile = await UserProfile.find_one(UserProfile.user_id == "u1")
    assert profile is not None
    assert profile.learning_path.weak_topics == ["python"]


def test_sync_requires_internal_token() -> None:
    res = _client().post("/profiles/u1/sync")
    assert res.status_code == 401


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_sync_returns_404_when_supabase_profile_is_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _missing(_user_id: str) -> UserProfile:
        raise ValueError("Supabase profile not found")

    monkeypatch.setattr(profiles_mod, "upsert_mongo_profile", _missing)
    res = _client().post(
        "/profiles/u1/sync",
        headers={"X-Internal-Token": "change-me-to-a-32-char-secret"},
    )
    assert res.status_code == 404
    assert "Supabase profile not found" in res.json()["detail"]


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_get_profile_returns_the_mongo_mirror() -> None:
    await UserProfile(
        user_id="u1",
        name="Dev",
        primary_tech_stack=["python"],
        years_of_experience=2,
        updated_at=datetime.now(UTC),
    ).insert()

    res = _client().get("/profiles/u1")
    assert res.status_code == 200
    body = res.json()
    assert body["user_id"] == "u1"
    assert body["name"] == "Dev"
    assert body["content_depth"] == "intermediate"
    assert "python" in body["ranking_terms"]


def test_get_profile_returns_404_when_not_mirrored() -> None:
    res = _client().get("/profiles/nobody")
    assert res.status_code == 404
    assert "Profile not mirrored" in res.json()["detail"]


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_quiz_result_returns_404_when_profile_is_missing() -> None:
    res = _client().post(
        "/profiles/nobody/quiz",
        headers={"X-Internal-Token": "change-me-to-a-32-char-secret"},
        json={"score": 3, "total": 5},
    )
    assert res.status_code == 404


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_quiz_result_marks_passed_scores_as_harder() -> None:
    await UserProfile(
        user_id="u1",
        name="Dev",
        learning_path=LearningPath(last_topics=["docker"]),
    ).insert()

    res = _client().post(
        "/profiles/u1/quiz",
        headers={"X-Internal-Token": "change-me-to-a-32-char-secret"},
        json={"score": 4, "total": 4},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["learning_path"]["last_quiz_outcome"] == "passed"
    assert body["learning_path"]["difficulty_direction"] == "harder"

    profile = await UserProfile.find_one(UserProfile.user_id == "u1")
    assert profile is not None
    assert profile.learning_path.difficulty_direction is DifficultyDirection.HARDER


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_quiz_result_marks_mid_scores_as_same_difficulty() -> None:
    await UserProfile(
        user_id="u1",
        name="Dev",
        learning_path=LearningPath(last_topics=["react"]),
    ).insert()

    res = _client().post(
        "/profiles/u1/quiz",
        headers={"X-Internal-Token": "change-me-to-a-32-char-secret"},
        json={"score": 3, "total": 5},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["learning_path"]["last_quiz_outcome"] == "passed"
    assert body["learning_path"]["difficulty_direction"] == "same"


class TestSupabaseProfileService:
    @pytest.mark.filterwarnings("ignore::RuntimeWarning")
    async def test_fetch_profile_row_returns_the_first_match(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from pydantic import SecretStr

        from src.services import supabase_profiles as svc_mod

        class FakeSettings:
            URL = "https://example.supabase.co"
            ANON_KEY = SecretStr("anon-key")
            SERVICE_ROLE_KEY = SecretStr("service-role")

        class FakeResponse:
            status_code = 200

            def json(self) -> list[dict[str, str]]:
                return [{"user_id": "u1", "name": "Dev"}]

        class FakeClient:
            def __init__(self, **_: object) -> None:
                pass

            async def __aenter__(self) -> FakeClient:
                return self

            async def __aexit__(self, *_: object) -> None:
                return None

            async def get(self, url: str, headers: dict[str, str], params: dict[str, str]) -> FakeResponse:
                assert url.endswith("/rest/v1/user_profiles")
                assert headers["Authorization"] == "Bearer service-role"
                assert params["user_id"] == "eq.u1"
                return FakeResponse()

        monkeypatch.setattr(svc_mod, "get_supabase_settings", lambda: FakeSettings())
        monkeypatch.setattr(svc_mod.httpx, "AsyncClient", FakeClient)

        row = await svc_mod.fetch_profile_row("u1")
        assert row == {"user_id": "u1", "name": "Dev"}

    @pytest.mark.filterwarnings("ignore::RuntimeWarning")
    async def test_fetch_profile_row_returns_none_on_http_or_empty_payload(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from pydantic import SecretStr

        from src.services import supabase_profiles as svc_mod

        class FakeSettings:
            URL = "https://example.supabase.co"
            ANON_KEY = None
            SERVICE_ROLE_KEY = SecretStr("service-role")

        class ErrorResponse:
            status_code = 503

            def json(self) -> list[dict[str, str]]:
                return []

        class EmptyResponse:
            status_code = 200

            def json(self) -> list[dict[str, str]]:
                return []

        class FakeClient:
            def __init__(self, **_: object) -> None:
                self.response: object = ErrorResponse()

            async def __aenter__(self) -> FakeClient:
                return self

            async def __aexit__(self, *_: object) -> None:
                return None

            async def get(self, *_: object, **__: object) -> object:
                return self.response

        monkeypatch.setattr(svc_mod, "get_supabase_settings", lambda: FakeSettings())
        monkeypatch.setattr(svc_mod.httpx, "AsyncClient", FakeClient)

        client = FakeClient()
        monkeypatch.setattr(svc_mod.httpx, "AsyncClient", lambda **_kw: client)

        assert await svc_mod.fetch_profile_row("u1") is None

        client.response = EmptyResponse()
        assert await svc_mod.fetch_profile_row("u1") is None

    @pytest.mark.filterwarnings("ignore::RuntimeWarning")
    async def test_upsert_mongo_profile_inserts_when_missing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from src.services import supabase_profiles as svc_mod

        async def fake_fetch(user_id: str) -> dict[str, object]:
            return {
                "user_id": user_id,
                "name": "Dev",
                "primary_tech_stack": ["python"],
            }

        monkeypatch.setattr(svc_mod, "fetch_profile_row", fake_fetch)

        profile = await svc_mod.upsert_mongo_profile("u-new")
        assert profile.user_id == "u-new"
        assert profile.name == "Dev"
        assert profile.primary_tech_stack == ["python"]

    @pytest.mark.filterwarnings("ignore::RuntimeWarning")
    async def test_upsert_mongo_profile_updates_existing_without_wiping_learning_path(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from src.services import supabase_profiles as svc_mod

        existing = UserProfile(
            user_id="u1",
            name="Old",
            learning_path=LearningPath(weak_topics=["hooks"]),
        )
        await existing.insert()

        async def fake_fetch(user_id: str) -> dict[str, object]:
            return {
                "user_id": user_id,
                "name": "New",
                "primary_tech_stack": ["react"],
            }

        monkeypatch.setattr(svc_mod, "fetch_profile_row", fake_fetch)

        profile = await svc_mod.upsert_mongo_profile("u1")
        assert profile.name == "New"
        assert profile.primary_tech_stack == ["react"]
        assert profile.learning_path.weak_topics == ["hooks"]

    @pytest.mark.filterwarnings("ignore::RuntimeWarning")
    async def test_upsert_mongo_profile_raises_when_supabase_row_missing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from src.services import supabase_profiles as svc_mod

        async def fake_fetch(_user_id: str) -> None:
            return None

        monkeypatch.setattr(svc_mod, "fetch_profile_row", fake_fetch)

        with pytest.raises(ValueError, match="Supabase profile not found"):
            await svc_mod.upsert_mongo_profile("missing")
