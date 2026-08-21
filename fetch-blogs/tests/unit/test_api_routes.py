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

    def test_health_records_redis_error_when_ping_raises(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def _boom() -> bool:
            raise RuntimeError("redis connection refused")

        async def _up() -> bool:
            return True

        monkeypatch.setattr(health_mod, "ping_db", _up)
        monkeypatch.setattr(health_mod, "ping_redis", _boom)

        res = build_client(health_mod.router).get("/health")
        assert res.status_code == 503
        assert res.json()["redis"]["error"] == "redis connection refused"

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

    def test_replaces_templated_morning_briefing_with_the_source_title(self) -> None:
        out = digests_mod.flat_map_digest_for_dashboard(
            {
                "digest_date": "2026-08-18T18:30:00.000Z",
                "article": {
                    "headline": "Your Morning Python & AI Briefing",
                    "sources": [{"title": "Redis queues in production", "url": "https://dev.to/a"}],
                    "sections": [{"title": "Why this matters today", "content": "body"}],
                },
            }
        )
        assert out["title"] == "Redis queues in production"
        assert out["digest_date"] == "2026-08-18"

    def test_keeps_a_real_headline(self) -> None:
        out = digests_mod.flat_map_digest_for_dashboard(
            {"article": {"headline": "Redis Streams in production"}}
        )
        assert out["title"] == "Redis Streams in production"


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

        res = build_client(digests_mod.router).post("/digests/generate", json={"userId": "u1"})
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

    def test_surfaces_a_pipeline_failure_as_a_500(self, monkeypatch: pytest.MonkeyPatch) -> None:
        async def _upsert(_uid: str) -> None:
            return None

        def _boom(_uid: str) -> str:
            raise RuntimeError("gemini exploded")

        monkeypatch.setattr(digests_mod, "upsert_mongo_profile", _upsert)
        monkeypatch.setattr(digests_mod, "run_celery_pipeline_and_wait", _boom)

        res = build_client(digests_mod.router).post("/digests/generate", json={"userId": "u1"})
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


class TestGetPastDigestsRoute:
    def test_dedupes_legacy_and_beanie_docs_by_calendar_day(self) -> None:
        from datetime import date as date_cls

        docs = digests_mod._dedupe_digest_docs(
            [
                {
                    "id": "older-today",
                    "digest_date": "2026-08-19",
                    "generated_at": "2026-08-19T08:00:00",
                    "content": {"headline": "stale"},
                },
                {
                    "id": "newer-today",
                    "digest_date": "2026-08-19",
                    "generated_at": "2026-08-19T11:00:00",
                    "content": {"headline": "fresh"},
                },
                {
                    "id": "yesterday",
                    "generated_at": datetime(2026, 8, 18, 18, 30),
                    "article": {"headline": "Yesterday queues"},
                },
            ],
            None,
        )
        assert [item["id"] for item in docs] == ["newer-today", "yesterday"]
        one_day = digests_mod._dedupe_digest_docs(docs, date_cls(2026, 8, 18))
        assert [item["id"] for item in one_day] == ["yesterday"]

    def test_lists_yesterday_and_earlier_including_legacy_docs(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def _docs(_uid: str, _day: object) -> list[dict[str, Any]]:
            return [
                {
                    "id": "today",
                    "digest_date": "2026-08-19",
                    "content": {
                        "headline": "Today Redis",
                        "sources": [{"title": "Today Redis", "url": "https://dev.to/t"}],
                    },
                },
                {
                    "id": "yesterday",
                    "generated_at": datetime(2026, 8, 18, 18, 30),
                    "article": {
                        "headline": "Your Morning Python & AI Briefing",
                        "sources": [{"title": "Yesterday queues", "url": "https://dev.to/y"}],
                    },
                },
                {
                    "id": "older",
                    "digest_date": "2026-08-17",
                    "content": {"headline": "FastAPI auth"},
                },
            ]

        async def _init() -> None:
            return None

        async def _no_backfill(_uid: str) -> int:
            return 0

        monkeypatch.setattr(digests_mod, "init_db", _init)
        monkeypatch.setattr(digests_mod, "_backfill_orphan_digests", _no_backfill)
        monkeypatch.setattr(digests_mod, "_past_digest_docs", _docs)
        res = build_client(digests_mod.router).get("/digests/u1/past")
        assert res.status_code == 200
        blogs = res.json()["blogs"]
        assert [item["title"] for item in blogs] == [
            "Today Redis",
            "Yesterday queues",
            "FastAPI auth",
        ]
        assert blogs[1]["digest_date"] == "2026-08-18"

    def test_returns_one_day_when_date_is_supplied(self, monkeypatch: pytest.MonkeyPatch) -> None:
        async def _docs(_uid: str, day: object) -> list[dict[str, Any]]:
            assert str(day) == "2026-08-18"
            return [
                {
                    "id": "yesterday",
                    "generated_at": datetime(2026, 8, 18, 18, 30),
                    "article": {"headline": "Yesterday queues"},
                }
            ]

        async def _init() -> None:
            return None

        async def _no_backfill(_uid: str) -> int:
            return 0

        monkeypatch.setattr(digests_mod, "init_db", _init)
        monkeypatch.setattr(digests_mod, "_backfill_orphan_digests", _no_backfill)
        monkeypatch.setattr(digests_mod, "_past_digest_docs", _docs)
        res = build_client(digests_mod.router).get("/digests/u1/past?date=2026-08-18")
        assert res.json()["blog"]["title"] == "Yesterday queues"

    def test_surfaces_a_query_failure_as_a_500(self, monkeypatch: pytest.MonkeyPatch) -> None:
        async def _boom(_uid: str, _day: object) -> list[dict[str, Any]]:
            raise RuntimeError("mongo unavailable")

        async def _init() -> None:
            return None

        async def _no_backfill(_uid: str) -> int:
            return 0

        monkeypatch.setattr(digests_mod, "init_db", _init)
        monkeypatch.setattr(digests_mod, "_backfill_orphan_digests", _no_backfill)
        monkeypatch.setattr(digests_mod, "_past_digest_docs", _boom)
        res = build_client(digests_mod.router).get("/digests/u1/past")
        assert res.status_code == 500

    def test_backfills_orphan_pipeline_jobs_before_listing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def _noop_backfill(_uid: str) -> int:
            return 1

        async def _docs(_uid: str, _day: object) -> list[dict[str, Any]]:
            return [
                {
                    "id": "older",
                    "digest_date": "2026-08-17",
                    "content": {"headline": "Aug 17 Brief", "sources": []},
                },
                {
                    "id": "today",
                    "digest_date": "2026-08-19",
                    "content": {"headline": "Today Brief", "sources": []},
                },
            ]

        async def _init() -> None:
            return None

        monkeypatch.setattr(digests_mod, "init_db", _init)
        monkeypatch.setattr(digests_mod, "_backfill_orphan_digests", _noop_backfill)
        monkeypatch.setattr(digests_mod, "_past_digest_docs", _docs)

        res = build_client(digests_mod.router).get("/digests/u1/past")
        assert res.status_code == 200
        titles = [item["title"] for item in res.json()["blogs"]]
        assert titles == ["Aug 17 Brief", "Today Brief"]


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

    def test_aggregator_includes_pipeline_and_profile_routes(self) -> None:
        from src.api.main import api_router

        client = build_client(api_router)
        assert client.get("/health/live").status_code == 200
        assert client.post("/pipeline/trigger", json={"user_id": "u1"}).status_code == 401
        assert client.post("/profiles/u1/sync").status_code == 401


class TestDigestsHelperAndEdgeCases:
    def test_calendar_date_key_and_parse_helpers(self) -> None:
        from datetime import date, datetime

        assert digests_mod._calendar_date_key(date(2026, 8, 19)) == "2026-08-19"
        assert digests_mod._calendar_date_key(datetime(2026, 8, 19, 10, 0, 0)) == "2026-08-19"
        assert digests_mod._calendar_date_key("2026-08-19T10:00:00Z") == "2026-08-19"
        assert digests_mod._calendar_date_key(None) is None
        assert digests_mod._calendar_date_key(12345) is None
        assert digests_mod._parse_digest_date("invalid-date") is None
        assert digests_mod._parse_digest_date("") is None

    def test_flat_map_digest_with_model_source_and_date_branches(self) -> None:
        from datetime import date, datetime

        class DummyModelSource:
            def model_dump(self) -> dict[str, Any]:
                return {
                    "title": "Model Title",
                    "url": "https://example.com",
                    "source_domain": "example.com",
                    "author": "Alice",
                }

        doc = {
            "id": "d1",
            "digest_date": date(2026, 8, 19),
            "generated_at": datetime(2026, 8, 19, 12, 0, 0),
            "article": {
                "headline": "Model Source Brief",
                "sources": [DummyModelSource()],
            },
        }
        res = digests_mod.flat_map_digest_for_dashboard(doc)
        assert res["title"] == "Model Source Brief"
        assert "Model Title" in res["content"]

    def test_dedupe_digest_docs_skips_doc_without_date_key(self) -> None:
        raw = [
            {"id": "valid", "digest_date": "2026-08-19"},
            {"id": "invalid", "digest_date": None, "generated_at": None},
        ]
        deduped = digests_mod._dedupe_digest_docs(raw, None)
        assert len(deduped) == 1
        assert deduped[0]["id"] == "valid"

    @pytest.mark.asyncio
    async def test_backfill_orphan_digests_when_profile_missing_returns_zero(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def _none(_query: object) -> None:
            return None

        monkeypatch.setattr(digests_mod.UserProfile, "find_one", _none)
        res = await digests_mod._backfill_orphan_digests("missing_user")
        assert res == 0

    @pytest.mark.asyncio
    async def test_backfill_orphan_digests_process_jobs_and_articles(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from datetime import datetime
        from types import SimpleNamespace

        user_profile = SimpleNamespace(user_id="u1")

        class MockJob:
            def __init__(self, created_at: datetime, article_ids: list[str]) -> None:
                self.created_at = created_at
                self.article_ids = article_ids

        class MockJobQuery:
            def sort(self, *_: object) -> MockJobQuery:
                return self

            async def to_list(self) -> list[MockJob]:
                return [
                    MockJob(
                        datetime(2026, 8, 15),
                        ["507f1f77bcf86cd799439011", "507f1f77bcf86cd799439012"],
                    ),
                    MockJob(datetime(2026, 8, 15), ["507f1f77bcf86cd799439013"]),
                ]

        class MockArticle:
            @classmethod
            async def get(cls, oid: object) -> MockArticle | None:
                if str(oid) == "507f1f77bcf86cd799439011":
                    return MockArticle()
                raise ValueError("invalid oid")

        async def _existing(_uid: str) -> set[str]:
            return set()

        async def _profile(_query: object) -> SimpleNamespace:
            return user_profile

        async def _upsert(_digest: object) -> None:
            return None

        def _synthesize(*_: object, **__: object) -> SimpleNamespace:
            return SimpleNamespace(generated_at=None, updated_at=None)

        monkeypatch.setattr(digests_mod.UserProfile, "find_one", _profile)
        monkeypatch.setattr(digests_mod, "_existing_digest_days", _existing)
        monkeypatch.setattr(digests_mod.PipelineJob, "find", lambda _query: MockJobQuery())
        monkeypatch.setattr(digests_mod.Article, "get", MockArticle.get)
        monkeypatch.setattr(digests_mod, "synthesize_digest", _synthesize)
        monkeypatch.setattr(digests_mod, "upsert_digest", _upsert)

        res = await digests_mod._backfill_orphan_digests("u1")
        assert res == 1

    @pytest.mark.asyncio
    async def test_past_digest_docs_reads_raw_collection(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        class MockMotorCollection:
            def find(self, _query: object) -> FakeCursor:
                return FakeCursor([{"_id": "oid123", "user_id": "u1", "digest_date": "2026-08-10"}])

        monkeypatch.setattr(digests_mod.DailyDigest, "get_motor_collection", MockMotorCollection)
        docs = await digests_mod._past_digest_docs("u1", None)
        assert len(docs) == 1
        assert docs[0]["id"] == "oid123"

    def test_generate_digest_raises_500_when_digest_not_found(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def _upsert(_uid: str) -> None:
            return None

        async def _none(*_: object) -> None:
            return None

        monkeypatch.setattr(digests_mod, "upsert_mongo_profile", _upsert)
        monkeypatch.setattr(digests_mod, "run_celery_pipeline_and_wait", lambda _uid: "valid_id")
        monkeypatch.setattr(digests_mod.DailyDigest, "get", _none)
        monkeypatch.setattr(digests_mod, "_latest_digest", _none)

        res = build_client(digests_mod.router).post("/digests/generate", json={"userId": "u1"})
        assert res.status_code == 500
        assert "no digest was stored" in res.json()["detail"]

    def test_generate_digest_raises_404_on_value_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def _boom(_uid: str) -> None:
            raise ValueError("user profile not synced")

        monkeypatch.setattr(digests_mod, "upsert_mongo_profile", _boom)
        res = build_client(digests_mod.router).post("/digests/generate", json={"userId": "u1"})
        assert res.status_code == 404
        assert "user profile not synced" in res.json()["detail"]

    def test_trigger_cron_manually_route(self, monkeypatch: pytest.MonkeyPatch) -> None:
        res = build_client(digests_mod.router).post("/digests/cron/trigger")
        assert res.status_code == 200
        assert res.json()["success"] is True

    def test_generated_ts_uses_isoformat_when_available(self) -> None:
        stamp = datetime(2026, 8, 18, 9, 30, 0)
        assert digests_mod._generated_ts({"generated_at": stamp}).startswith("2026-08-18")
        assert digests_mod._generated_ts({"updated_at": "raw"}) == "raw"

    @pytest.mark.asyncio
    async def test_existing_digest_days_collects_calendar_keys(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        class MockMotorCollection:
            def find(self, _query: object, _proj: object = None) -> FakeCursor:
                return FakeCursor(
                    [
                        {"digest_date": "2026-08-18", "generated_at": "2026-08-18T10:00:00"},
                        {"digest_date": None, "generated_at": None},
                    ]
                )

        monkeypatch.setattr(digests_mod.DailyDigest, "get_motor_collection", MockMotorCollection)
        days = await digests_mod._existing_digest_days("u1")
        assert "2026-08-18" in days

    @pytest.mark.asyncio
    async def test_backfill_skips_when_article_ids_do_not_resolve(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from types import SimpleNamespace

        profile = SimpleNamespace(user_id="u1")

        async def _profile(_query: object) -> object:
            return profile

        async def _existing(_uid: str) -> set[str]:
            return set()

        class MockJobQuery:
            def sort(self, *_: object) -> MockJobQuery:
                return self

            async def to_list(self) -> list[object]:
                return [
                    SimpleNamespace(
                        article_ids=["bad-id"],
                        created_at=datetime(2026, 8, 17, 8, 0, 0),
                    )
                ]

        async def _get(_oid: object) -> None:
            raise ValueError("bad oid")

        monkeypatch.setattr(digests_mod.UserProfile, "find_one", _profile)
        monkeypatch.setattr(digests_mod, "_existing_digest_days", _existing)
        monkeypatch.setattr(digests_mod.PipelineJob, "find", lambda _query: MockJobQuery())
        monkeypatch.setattr(digests_mod.Article, "get", _get)

        assert await digests_mod._backfill_orphan_digests("u1") == 0

    @pytest.mark.asyncio
    async def test_latest_digest_reads_beanie_document(self) -> None:
        from datetime import date

        from src.models.digest import DailyDigest as BeanieDigest
        from src.models.digest import DigestContent

        digest = BeanieDigest(
            user_id="latest-user",
            digest_date=date(2026, 8, 20),
            content=DigestContent(
                headline="From Mongo",
                tldr=[],
                sections=[],
                key_takeaways=[],
                sources=[],
            ),
        )
        await digest.insert()
        found = await digests_mod._latest_digest("latest-user")
        assert found is not None
        assert found.content.headline == "From Mongo"

        missing = await digests_mod._latest_digest("nobody")
        assert missing is None

    @pytest.mark.asyncio
    async def test_backfill_skips_empty_ids_and_days_already_stored(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from types import SimpleNamespace

        profile = SimpleNamespace(user_id="u1")

        async def _profile(_query: object) -> object:
            return profile

        async def _existing(_uid: str) -> set[str]:
            return {"2026-08-15"}

        class MockJobQuery:
            def sort(self, *_: object) -> MockJobQuery:
                return self

            async def to_list(self) -> list[object]:
                return [
                    SimpleNamespace(article_ids=[], created_at=datetime(2026, 8, 15)),
                    SimpleNamespace(
                        article_ids=["already-served"],
                        created_at=datetime(2026, 8, 15),
                    ),
                    SimpleNamespace(article_ids=["no-day"], created_at="not-a-date"),
                ]

        monkeypatch.setattr(digests_mod.UserProfile, "find_one", _profile)
        monkeypatch.setattr(digests_mod, "_existing_digest_days", _existing)
        monkeypatch.setattr(digests_mod.PipelineJob, "find", lambda _query: MockJobQuery())

        assert await digests_mod._backfill_orphan_digests("u1") == 0
