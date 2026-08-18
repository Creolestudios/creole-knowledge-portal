"""Unit tests for the FastAPI health and digest routes.

Routes are mounted on a bare app so the tests don't depend on the real
lifespan (Mongo/Redis/Celery). Every dependency boundary is stubbed.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api.routes import digests as digests_mod
from src.api.routes import health as health_mod
from src.models.schemas import DailyDigest, DigestArticle, DigestMetadata


def build_client(*routers: Any) -> TestClient:
    app = FastAPI()
    for r in routers:
        app.include_router(r)
    return TestClient(app, raise_server_exceptions=False)


# ── health routes ─────────────────────────────────────────────────────────────


class TestHealthRoutes:
    def test_liveness_returns_ok_without_touching_dependencies(self) -> None:
        client = build_client(health_mod.router)
        res = client.get("/health/live")
        assert res.status_code == 200
        assert res.json() == {"status": "ok"}

    def test_health_reports_ok_when_both_dependencies_respond(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def _ok() -> bool:
            return True

        monkeypatch.setattr(health_mod, "ping_db", _ok)
        monkeypatch.setattr(health_mod, "ping_redis", _ok)

        res = build_client(health_mod.router).get("/health")
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "ok"
        assert body["mongo"]["status"] == "ok"
        assert body["redis"]["status"] == "ok"
        assert body["mongo"]["latency_ms"] is not None

    def test_health_degrades_to_503_when_mongo_is_down(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def _down() -> bool:
            return False

        async def _up() -> bool:
            return True

        monkeypatch.setattr(health_mod, "ping_db", _down)
        monkeypatch.setattr(health_mod, "ping_redis", _up)

        res = build_client(health_mod.router).get("/health")
        assert res.status_code == 503
        body = res.json()
        assert body["status"] == "degraded"
        assert body["mongo"]["status"] == "down"

    def test_health_records_the_error_when_a_ping_raises(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def _boom() -> bool:
            raise RuntimeError("connection refused")

        async def _up() -> bool:
            return True

        monkeypatch.setattr(health_mod, "ping_db", _boom)
        monkeypatch.setattr(health_mod, "ping_redis", _up)

        res = build_client(health_mod.router).get("/health")
        assert res.status_code == 503
        assert res.json()["mongo"]["error"] == "connection refused"

    def test_readiness_returns_200_when_everything_is_up(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def _ok() -> bool:
            return True

        monkeypatch.setattr(health_mod, "ping_db", _ok)
        monkeypatch.setattr(health_mod, "ping_redis", _ok)

        res = build_client(health_mod.router).get("/health/ready")
        assert res.status_code == 200
        assert res.json()["ready"] is True

    def test_readiness_returns_503_when_redis_is_down(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def _ok() -> bool:
            return True

        async def _down() -> bool:
            return False

        monkeypatch.setattr(health_mod, "ping_db", _ok)
        monkeypatch.setattr(health_mod, "ping_redis", _down)

        res = build_client(health_mod.router).get("/health/ready")
        assert res.status_code == 503
        assert res.json()["ready"] is False


# ── flat_map_digest_for_dashboard ─────────────────────────────────────────────


def full_digest_doc() -> dict[str, Any]:
    return {
        "id": "d1",
        "generated_at": "2026-08-01T00:00:00",
        "article": {
            "headline": "Morning Brief",
            "tldr": ["first point", "second point"],
            "sections": [{"title": "Section A", "content": "Section A body"}],
            "key_takeaways": ["do this"],
            "sources": [
                {
                    "title": "Src One",
                    "url": "https://a.com/x",
                    "source_domain": "a.com",
                    "author": "Ada",
                },
                {"title": "Src Two", "url": "https://b.com/y", "source_domain": "b.com"},
            ],
        },
    }


class TestFlatMapDigest:
    def test_builds_a_markdown_document_from_every_section(self) -> None:
        out = digests_mod.flat_map_digest_for_dashboard(full_digest_doc())
        content = out["content"]

        assert out["title"] == "Morning Brief"
        assert content.lstrip().startswith("## Daily Overview")
        assert "# Morning Brief" not in content
        assert "## Daily Overview (TL;DR)" in content
        assert "- first point" in content
        assert "## Section A" in content
        assert "Section A body" in content
        assert "## Key Actionable Takeaways" in content
        assert "## Sources & Citations" in content
        assert "by Ada" in content

    def test_appends_source_domains_to_the_tag_list(self) -> None:
        out = digests_mod.flat_map_digest_for_dashboard(full_digest_doc())
        assert "morning-briefing" in out["tags"]
        assert "a.com" in out["tags"]
        assert "b.com" in out["tags"]

    def test_omits_optional_blocks_when_they_are_empty(self) -> None:
        out = digests_mod.flat_map_digest_for_dashboard({"article": {"headline": "Bare"}})
        content = out["content"]

        assert out["title"] == "Bare"
        assert "# Bare" not in content
        assert "TL;DR" not in content
        assert "Key Actionable Takeaways" not in content
        assert "Sources & Citations" not in content

    def test_defaults_the_headline_when_the_article_is_missing(self) -> None:
        out = digests_mod.flat_map_digest_for_dashboard({})
        assert out["title"] == "Morning Briefing"

    def test_passes_digest_reading_time_to_the_dashboard(self) -> None:
        out = digests_mod.flat_map_digest_for_dashboard(
            {"article": {"headline": "Long Brief"}, "reading_time_minutes": 20, "word_count": 4500}
        )
        assert out["estimated_read_minutes"] == 20
        assert out["word_count"] == 4500

    def test_strips_a_section_heading_that_repeats_the_title(self) -> None:
        out = digests_mod.flat_map_digest_for_dashboard(
            {
                "article": {
                    "headline": "Queues",
                    "sections": [
                        {
                            "title": "Redis queues",
                            "content": "## Redis queues\n\nWorkers drain the broker.",
                        }
                    ],
                }
            }
        )
        assert out["content"].count("Redis queues") == 1
        assert "Workers drain the broker." in out["content"]


# ── digest routes ─────────────────────────────────────────────────────────────


class FakeCursor:
    def __init__(self, docs: list[dict[str, Any]]) -> None:
        self._docs = docs

    def sort(self, *_: object, **__: object) -> FakeCursor:
        return self

    def limit(self, *_: object) -> FakeCursor:
        return self

    def __aiter__(self) -> Any:
        async def gen() -> Any:
            for d in self._docs:
                yield d

        return gen()


class FakeCollection:
    def __init__(self, docs: list[dict[str, Any]] | None = None, explode: bool = False) -> None:
        self._docs = docs or []
        self._explode = explode

    def find(self, *_: object, **__: object) -> FakeCursor:
        if self._explode:
            raise RuntimeError("mongo unavailable")
        return FakeCursor(self._docs)


class FakeDB:
    def __init__(self, daily: FakeCollection, sources: FakeCollection | None = None) -> None:
        self.daily_digests = daily
        self.scraped_sources = sources or FakeCollection()


def make_digest() -> DailyDigest:
    return DailyDigest(
        digest_id="d1",
        user_id="u1",
        article=DigestArticle(
            headline="Generated Brief",
            tldr=["a"],
            sections=[],
            key_takeaways=[],
            sources=[],
        ),
        metadata=DigestMetadata(),
    )


class TestGenerateDigestRoute:
    def test_returns_the_flat_shape_by_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        async def _upsert(_uid: str) -> None:
            return None

        class _Digest:
            id = "d1"

            def model_dump(self, mode: str = "json") -> dict[str, Any]:
                return {
                    "id": "d1",
                    "generated_at": "2026-08-01T00:00:00",
                    "content": {
                        "headline": "Generated Brief",
                        "tldr": ["a"],
                        "sections": [],
                        "key_takeaways": [],
                        "sources": [],
                    },
                }

        async def _get(_id: object) -> _Digest:
            return _Digest()

        monkeypatch.setattr(digests_mod, "upsert_mongo_profile", _upsert)
        monkeypatch.setattr(digests_mod, "run_celery_pipeline_and_wait", lambda _uid: "d1")
        monkeypatch.setattr(digests_mod.DailyDigest, "get", _get)
        monkeypatch.setattr(digests_mod, "_latest_digest", _get)

        res = build_client(digests_mod.router).post(
            "/digests/generate", json={"userId": "u1"}
        )
        assert res.status_code == 200
        body = res.json()
        assert body["success"] is True
        assert body["blog"]["title"] == "Generated Brief"
        assert "content" in body["blog"]

    def test_returns_the_structured_shape_when_flat_is_false(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def _upsert(_uid: str) -> None:
            return None

        class _Digest:
            id = "d1"

            def model_dump(self, mode: str = "json") -> dict[str, Any]:
                return {"id": "d1", "digest_id": "d1", "content": {"headline": "Generated Brief"}}

        async def _get(_id: object) -> _Digest:
            return _Digest()

        monkeypatch.setattr(digests_mod, "upsert_mongo_profile", _upsert)
        monkeypatch.setattr(digests_mod, "run_celery_pipeline_and_wait", lambda _uid: "d1")
        monkeypatch.setattr(digests_mod.DailyDigest, "get", _get)
        monkeypatch.setattr(digests_mod, "_latest_digest", _get)

        res = build_client(digests_mod.router).post(
            "/digests/generate?flat=false", json={"userId": "u1"}
        )
        assert res.status_code == 200
        assert res.json()["blog"]["digest_id"] == "d1"

    def test_rejects_a_blank_user_id(self) -> None:
        res = build_client(digests_mod.router).post("/digests/generate", json={"userId": ""})
        assert res.status_code == 400

    def test_surfaces_a_pipeline_failure_as_a_500(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def _upsert(_uid: str) -> None:
            return None

        def _boom(_uid: str) -> str:
            raise RuntimeError("gemini exploded")

        monkeypatch.setattr(digests_mod, "upsert_mongo_profile", _upsert)
        monkeypatch.setattr(digests_mod, "run_celery_pipeline_and_wait", _boom)

        res = build_client(digests_mod.router).post(
            "/digests/generate", json={"userId": "u1"}
        )
        assert res.status_code == 500
        assert "gemini exploded" in res.json()["detail"]


class TestGetLatestDigestRoute:
    def test_returns_the_most_recent_digest_flattened(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        class _Digest:
            id = "mongo-1"

            def model_dump(self, mode: str = "json") -> dict[str, Any]:
                return {
                    "id": "mongo-1",
                    "generated_at": datetime(2026, 8, 1),
                    "content": {
                        "headline": "Morning Brief",
                        "tldr": ["first point", "second point"],
                        "sections": [{"title": "Section A", "content": "Section A body"}],
                        "key_takeaways": ["do this"],
                        "sources": [
                            {
                                "title": "Src One",
                                "url": "https://a.com/x",
                                "source_domain": "a.com",
                                "author": "Ada",
                            }
                        ],
                    },
                }

        async def _latest(_uid: str) -> _Digest:
            return _Digest()

        monkeypatch.setattr(digests_mod, "_latest_digest", _latest)

        res = build_client(digests_mod.router).get("/digests/u1/latest")
        assert res.status_code == 200
        assert res.json()["blog"]["title"] == "Morning Brief"

    def test_returns_the_raw_document_when_flat_is_false(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        class _Digest:
            id = "mongo-1"

            def model_dump(self, mode: str = "json") -> dict[str, Any]:
                return {"id": "mongo-1", "content": {"headline": "Morning Brief"}}

        async def _latest(_uid: str) -> _Digest:
            return _Digest()

        monkeypatch.setattr(digests_mod, "_latest_digest", _latest)

        res = build_client(digests_mod.router).get("/digests/u1/latest?flat=false")
        assert res.json()["blog"]["id"] == "mongo-1"

    def test_returns_a_null_blog_when_the_user_has_no_digest(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def _none(_uid: str) -> None:
            return None

        monkeypatch.setattr(digests_mod, "_latest_digest", _none)

        res = build_client(digests_mod.router).get("/digests/u1/latest")
        assert res.status_code == 200
        assert res.json() == {"success": True, "blog": None}

    def test_surfaces_a_query_failure_as_a_500(self, monkeypatch: pytest.MonkeyPatch) -> None:
        async def _boom(_uid: str) -> None:
            raise RuntimeError("mongo unavailable")

        monkeypatch.setattr(digests_mod, "_latest_digest", _boom)

        res = build_client(digests_mod.router).get("/digests/u1/latest")
        assert res.status_code == 500


class TestScrapedSourcesRoute:
    def test_lists_recent_sources_with_serialised_timestamps(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        docs = [
            {"_id": "s1", "url": "https://a.com", "scraped_at": datetime(2026, 8, 1)},
            {"_id": "s2", "url": "https://b.com", "scraped_at": "already-a-string"},
        ]
        monkeypatch.setattr(
            digests_mod,
            "get_db",
            lambda: FakeDB(FakeCollection([]), FakeCollection(docs)),
        )

        res = build_client(digests_mod.router).get("/digests/scraped-sources")
        assert res.status_code == 200
        body = res.json()
        assert body["success"] is True
        assert body["sources"][0]["id"] == "s1"
        assert body["sources"][0]["scraped_at"] == "2026-08-01T00:00:00"

    def test_surfaces_a_query_failure_as_a_500(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            digests_mod,
            "get_db",
            lambda: FakeDB(FakeCollection([]), FakeCollection(explode=True)),
        )

        res = build_client(digests_mod.router).get("/digests/scraped-sources")
        assert res.status_code == 500


class TestApiRouterAggregation:
    def test_aggregator_mounts_the_health_and_digest_routers(self) -> None:
        from src.api.main import api_router

        # Exercise the aggregator end-to-end: a route it mounts must respond.
        client = build_client(api_router)
        assert client.get("/health/live").status_code == 200
