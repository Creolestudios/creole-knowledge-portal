"""Unit tests for the AI synthesis/ranking pipeline and the infrastructure glue.

Gemini, Mongo, Redis, Celery and APScheduler are all stubbed — what's under
test is the prompt-assembly, response-mapping, fallback and lifecycle logic.
"""
from __future__ import annotations

import json
from typing import Any

import pytest

from src.ai_pipeline import embeddings as embeddings_mod
from src.ai_pipeline import reranker as reranker_mod
from src.models.schemas import Article, UserProfile
from src.scheduler import jobs as jobs_mod
from src.storage import mongodb as mongodb_mod
from src.synthesis import generator as generator_mod


def make_article(title: str = "T", url: str = "https://x.com/a", **kw: Any) -> Article:
    base: dict[str, Any] = {
        "url": url,
        "title": title,
        "source_domain": "x.com",
        "body_text": "body text " * 40,
    }
    base.update(kw)
    return Article(**base)


def make_profile(**kw: Any) -> UserProfile:
    base: dict[str, Any] = {"user_id": "u1", "name": "Dev", "primary_tech_stack": ["python"]}
    base.update(kw)
    return UserProfile(**base)


class FakeGeminiModel:
    """Stands in for genai.GenerativeModel."""

    def __init__(self, text: str | None = None, explode: bool = False, tokens: int | None = 42):
        self._text = text
        self._explode = explode
        self._tokens = tokens

    def __call__(self, _name: str) -> FakeGeminiModel:
        return self

    def generate_content(self, *_: object, **__: object) -> Any:
        if self._explode:
            raise RuntimeError("model unavailable")
        return type("Res", (), {"text": self._text})()

    def count_tokens(self, _prompt: str) -> Any:
        if self._tokens is None:
            raise RuntimeError("token counting unsupported")
        return type("T", (), {"total_tokens": self._tokens})()


# ── embeddings ────────────────────────────────────────────────────────────────


class TestEmbeddings:
    def test_returns_a_zero_vector_when_the_api_key_is_missing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(embeddings_mod.settings, "GEMINI_API_KEY", "")
        vec = embeddings_mod.get_text_embedding("some text")
        assert len(vec) == 768
        assert set(vec) == {0.0}

    def test_returns_the_embedding_from_the_api(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(embeddings_mod.settings, "GEMINI_API_KEY", "key")
        monkeypatch.setattr(
            embeddings_mod.genai, "embed_content", lambda **_: {"embedding": [0.5] * 768}
        )

        assert embeddings_mod.get_text_embedding("text")[0] == 0.5

    def test_falls_back_to_zeroes_when_the_response_has_no_embedding(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(embeddings_mod.settings, "GEMINI_API_KEY", "key")
        monkeypatch.setattr(embeddings_mod.genai, "embed_content", lambda **_: {})

        assert embeddings_mod.get_text_embedding("text") == [0.0] * 768

    def test_falls_back_to_zeroes_when_the_api_raises(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(embeddings_mod.settings, "GEMINI_API_KEY", "key")

        def _boom(**_: object) -> None:
            raise RuntimeError("quota exceeded")

        monkeypatch.setattr(embeddings_mod.genai, "embed_content", _boom)
        assert embeddings_mod.get_text_embedding("text") == [0.0] * 768

    def test_trims_very_long_input_before_embedding(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(embeddings_mod.settings, "GEMINI_API_KEY", "key")
        seen: dict[str, Any] = {}

        def _capture(**kwargs: Any) -> dict[str, Any]:
            seen.update(kwargs)
            return {"embedding": [0.1] * 768}

        monkeypatch.setattr(embeddings_mod.genai, "embed_content", _capture)
        embeddings_mod.get_text_embedding("x" * 20000)
        assert len(seen["contents"]) == 15000

    @pytest.mark.parametrize(
        ("a", "b", "expected"),
        [
            ([1.0, 0.0], [1.0, 0.0], 1.0),
            ([1.0, 0.0], [0.0, 1.0], 0.0),
            ([], [1.0], 0.0),
            ([1.0, 2.0], [1.0], 0.0),
            ([0.0, 0.0], [1.0, 1.0], 0.0),
        ],
    )
    def test_cosine_similarity_edge_cases(
        self, a: list[float], b: list[float], expected: float
    ) -> None:
        assert embeddings_mod.calculate_cosine_similarity(a, b) == pytest.approx(expected)


# ── reranker ──────────────────────────────────────────────────────────────────


class TestReranker:
    def test_profile_embedding_summarises_the_whole_profile(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        captured: list[str] = []
        monkeypatch.setattr(
            reranker_mod,
            "get_text_embedding",
            lambda text: (captured.append(text), [0.2] * 8)[1],
        )

        reranker_mod.get_profile_embedding(
            make_profile(current_role="SRE", interests=["k8s"], secondary_tech_stack=["go"])
        )
        assert "SRE" in captured[0]
        assert "k8s" in captured[0]
        assert "go" in captured[0]

    def test_semantic_rank_orders_by_similarity_and_truncates(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        near = make_article("Near", url="https://x.com/near", embedding=[1.0, 0.0])
        far = make_article("Far", url="https://x.com/far", embedding=[0.0, 1.0])

        out = reranker_mod.semantic_rank([far, near], [1.0, 0.0], top_n=1)
        assert [a.title for a in out] == ["Near"]

    def test_semantic_rank_embeds_articles_that_lack_one(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        calls: list[str] = []
        monkeypatch.setattr(
            reranker_mod,
            "get_text_embedding",
            lambda text: (calls.append(text), [1.0, 0.0])[1],
        )
        art = make_article("Needs embedding")

        reranker_mod.semantic_rank([art], [1.0, 0.0])
        assert calls, "an embedding should have been requested"
        assert art.embedding == [1.0, 0.0]

    def test_semantic_rank_re_embeds_an_all_zero_embedding(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        calls: list[str] = []
        monkeypatch.setattr(
            reranker_mod,
            "get_text_embedding",
            lambda text: (calls.append(text), [0.3, 0.4])[1],
        )
        art = make_article("Zeroed", embedding=[0.0, 0.0])

        reranker_mod.semantic_rank([art], [1.0, 0.0])
        assert len(calls) == 1

    def test_llm_rerank_returns_early_for_an_empty_shortlist(self) -> None:
        assert reranker_mod.llm_rerank([], make_profile()) == []

    def test_llm_rerank_applies_the_model_ordering(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        arts = [make_article(f"A{i}", url=f"https://x.com/{i}") for i in range(4)]
        monkeypatch.setattr(
            reranker_mod.genai, "GenerativeModel", FakeGeminiModel(text="[2, 0]")
        )

        out = reranker_mod.llm_rerank(arts, make_profile(), top_n=2)
        assert [a.title for a in out] == ["A2", "A0"]

    def test_llm_rerank_ignores_invalid_and_duplicate_indices(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        arts = [make_article(f"A{i}", url=f"https://x.com/{i}") for i in range(3)]
        monkeypatch.setattr(
            reranker_mod.genai,
            "GenerativeModel",
            FakeGeminiModel(text='[1, 1, 99, -5, "x"]'),
        )

        out = reranker_mod.llm_rerank(arts, make_profile(), top_n=3)
        # A1 first (valid), then the remaining articles backfilled in order.
        assert out[0].title == "A1"
        assert len(out) == 3
        assert len({a.title for a in out}) == 3

    def test_llm_rerank_falls_back_to_the_original_order_when_all_models_fail(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        arts = [make_article(f"A{i}", url=f"https://x.com/{i}") for i in range(3)]
        monkeypatch.setattr(
            reranker_mod.genai, "GenerativeModel", FakeGeminiModel(explode=True)
        )

        out = reranker_mod.llm_rerank(arts, make_profile(), top_n=2)
        assert [a.title for a in out] == ["A0", "A1"]

    def test_llm_rerank_falls_back_when_the_response_is_not_a_list(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        arts = [make_article("A0"), make_article("A1", url="https://x.com/1")]
        monkeypatch.setattr(
            reranker_mod.genai, "GenerativeModel", FakeGeminiModel(text='{"not": "a list"}')
        )

        out = reranker_mod.llm_rerank(arts, make_profile(), top_n=2)
        assert len(out) == 2


# ── synthesis generator ───────────────────────────────────────────────────────


VALID_SYNTHESIS = json.dumps(
    {
        "headline": "Your Stack This Week",
        "tldr": ["one", "two"],
        "sections": [
            {
                "title": "Sec A",
                "content": "word " * 100,
                "sources_cited": [1],
                "estimated_read_minutes": 5.0,
            }
        ],
        "key_takeaways": ["ship it"],
        "further_reading": [{"title": "More", "url": "https://x.com/more"}],
    }
)


class TestGenerateDailyDigest:
    def test_maps_a_valid_model_response_onto_the_digest_schema(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            generator_mod.genai, "GenerativeModel", FakeGeminiModel(text=VALID_SYNTHESIS)
        )

        digest = generator_mod.generate_daily_digest(
            make_profile(), [make_article("Src", url="https://x.com/s")]
        )

        assert digest.article.headline == "Your Stack This Week"
        assert digest.strategy_used == "C"
        assert digest.user_id == "u1"
        assert len(digest.article.sections) == 1
        assert digest.reading_time_minutes == 5.0
        assert digest.metadata.articles_evaluated == 1
        assert digest.metadata.llm_tokens_used == 42

    def test_builds_a_citation_for_each_source_article(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            generator_mod.genai, "GenerativeModel", FakeGeminiModel(text=VALID_SYNTHESIS)
        )
        arts = [make_article(f"S{i}", url=f"https://x.com/{i}") for i in range(3)]

        digest = generator_mod.generate_daily_digest(make_profile(), arts)
        assert [s.id for s in digest.article.sources] == [1, 2, 3]
        assert digest.metadata.articles_used_in_synthesis == 3

    def test_caps_the_source_context_at_ten_articles(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            generator_mod.genai, "GenerativeModel", FakeGeminiModel(text=VALID_SYNTHESIS)
        )
        arts = [make_article(f"S{i}", url=f"https://x.com/{i}") for i in range(15)]

        digest = generator_mod.generate_daily_digest(make_profile(), arts)
        assert len(digest.article.sources) == 10
        assert digest.metadata.articles_evaluated == 15

    def test_estimates_tokens_when_counting_is_unsupported(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            generator_mod.genai,
            "GenerativeModel",
            FakeGeminiModel(text=VALID_SYNTHESIS, tokens=None),
        )

        digest = generator_mod.generate_daily_digest(make_profile(), [make_article()])
        assert digest.metadata.llm_tokens_used > 0

    def test_falls_back_to_the_emergency_digest_when_every_model_fails(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            generator_mod.genai, "GenerativeModel", FakeGeminiModel(explode=True)
        )

        digest = generator_mod.generate_daily_digest(make_profile(), [make_article()])
        assert digest.article.headline == "Your Morning Technical Briefing"
        assert digest.article.sections[0].title.startswith("Welcome")

    def test_tolerates_a_response_with_missing_optional_keys(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            generator_mod.genai,
            "GenerativeModel",
            FakeGeminiModel(text=json.dumps({"headline": "Minimal"})),
        )

        digest = generator_mod.generate_daily_digest(make_profile(), [make_article()])
        assert digest.article.headline == "Minimal"
        assert digest.article.sections == []
        # No sections -> reading time derived from the (zero) word count, floored at 1.
        assert digest.reading_time_minutes >= 0

    def test_serialises_a_published_date_into_the_citation(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from datetime import datetime

        monkeypatch.setattr(
            generator_mod.genai, "GenerativeModel", FakeGeminiModel(text=VALID_SYNTHESIS)
        )
        art = make_article(published_at=datetime(2026, 8, 1))

        digest = generator_mod.generate_daily_digest(make_profile(), [art])
        assert digest.article.sources[0].published_at == "2026-08-01"


# ── scheduler jobs ────────────────────────────────────────────────────────────


class FakeResponse:
    def __init__(self, status_code: int = 200, payload: Any = None) -> None:
        self.status_code = status_code
        self._payload = payload if payload is not None else []

    def json(self) -> Any:
        return self._payload


class FakeAsyncClient:
    def __init__(self, response: FakeResponse | None = None, raise_on_get: bool = False) -> None:
        self._response = response or FakeResponse()
        self._raise = raise_on_get

    async def __aenter__(self) -> FakeAsyncClient:
        return self

    async def __aexit__(self, *_: object) -> None:
        return None

    async def get(self, *_: object, **__: object) -> FakeResponse:
        if self._raise:
            raise RuntimeError("supabase unreachable")
        return self._response


class TestSchedulerJobs:
    @pytest.mark.asyncio
    async def test_fetch_all_user_ids_filters_blank_rows(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = [{"user_id": "u1"}, {"user_id": None}, {}]
        monkeypatch.setattr(
            jobs_mod.httpx, "AsyncClient", lambda **_: FakeAsyncClient(FakeResponse(200, payload))
        )

        assert await jobs_mod.fetch_all_user_ids() == ["u1"]

    @pytest.mark.asyncio
    async def test_fetch_all_user_ids_returns_empty_on_a_non_200(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            jobs_mod.httpx, "AsyncClient", lambda **_: FakeAsyncClient(FakeResponse(500))
        )
        assert await jobs_mod.fetch_all_user_ids() == []

    @pytest.mark.asyncio
    async def test_fetch_all_user_ids_swallows_transport_errors(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            jobs_mod.httpx, "AsyncClient", lambda **_: FakeAsyncClient(raise_on_get=True)
        )
        assert await jobs_mod.fetch_all_user_ids() == []

    @pytest.mark.asyncio
    async def test_cron_job_short_circuits_when_there_are_no_users(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def _none() -> list[str]:
            return []

        ran: list[str] = []

        async def _pipeline(uid: str) -> None:
            ran.append(uid)

        monkeypatch.setattr(jobs_mod, "fetch_all_user_ids", _none)
        monkeypatch.setattr(jobs_mod, "run_hybrid_pipeline", _pipeline)

        await jobs_mod.trigger_daily_briefings_job()
        assert ran == []

    @pytest.mark.asyncio
    async def test_cron_job_runs_the_pipeline_for_every_user(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def _users() -> list[str]:
            return ["u1", "u2"]

        ran: list[str] = []

        async def _pipeline(uid: str) -> None:
            ran.append(uid)

        monkeypatch.setattr(jobs_mod, "fetch_all_user_ids", _users)
        monkeypatch.setattr(jobs_mod, "run_hybrid_pipeline", _pipeline)

        await jobs_mod.trigger_daily_briefings_job()
        assert ran == ["u1", "u2"]

    @pytest.mark.asyncio
    async def test_cron_job_continues_after_a_per_user_failure(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def _users() -> list[str]:
            return ["bad", "good"]

        ran: list[str] = []

        async def _pipeline(uid: str) -> None:
            if uid == "bad":
                raise RuntimeError("pipeline blew up")
            ran.append(uid)

        monkeypatch.setattr(jobs_mod, "fetch_all_user_ids", _users)
        monkeypatch.setattr(jobs_mod, "run_hybrid_pipeline", _pipeline)

        await jobs_mod.trigger_daily_briefings_job()
        assert ran == ["good"]


# ── storage / mongo manager ───────────────────────────────────────────────────


class FakeMotorCollection:
    def __init__(self, explode: bool = False) -> None:
        self.explode = explode
        self.indexes: list[Any] = []

    async def create_index(self, keys: Any, **kwargs: Any) -> None:
        if self.explode:
            raise RuntimeError("index build failed")
        self.indexes.append((keys, kwargs))


class FakeMotorDB:
    def __init__(self, explode: bool = False) -> None:
        self.articles = FakeMotorCollection(explode)
        self.user_profiles = FakeMotorCollection(explode)
        self.daily_digests = FakeMotorCollection(explode)
        self.scraped_sources = FakeMotorCollection(explode)


class FakeMotorClient:
    def __init__(self, *_: object, **__: object) -> None:
        self.closed = False
        self._db = FakeMotorDB()

    def get_database(self, _name: str) -> FakeMotorDB:
        return self._db

    def close(self) -> None:
        self.closed = True


class TestMongoDBConnection:
    def test_connect_is_idempotent(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(mongodb_mod, "AsyncIOMotorClient", FakeMotorClient)
        conn = mongodb_mod.MongoDBConnection()

        conn.connect()
        first = conn.client
        conn.connect()

        assert conn.client is first
        assert conn.db is not None

    def test_close_resets_the_client_and_db(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(mongodb_mod, "AsyncIOMotorClient", FakeMotorClient)
        conn = mongodb_mod.MongoDBConnection()
        conn.connect()

        conn.close()
        assert conn.client is None
        assert conn.db is None

    def test_close_is_safe_when_never_connected(self) -> None:
        mongodb_mod.MongoDBConnection().close()  # must not raise

    @pytest.mark.asyncio
    async def test_setup_indexes_connects_lazily_and_creates_every_index(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(mongodb_mod, "AsyncIOMotorClient", FakeMotorClient)
        conn = mongodb_mod.MongoDBConnection()

        await conn.setup_indexes()

        assert conn.db is not None
        assert len(conn.db.articles.indexes) == 2  # unique url + text search
        assert len(conn.db.user_profiles.indexes) == 1
        assert len(conn.db.daily_digests.indexes) == 1
        assert len(conn.db.scraped_sources.indexes) == 1

    @pytest.mark.asyncio
    async def test_setup_indexes_swallows_index_failures(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        class ExplodingClient(FakeMotorClient):
            def get_database(self, _name: str) -> FakeMotorDB:
                return FakeMotorDB(explode=True)

        monkeypatch.setattr(mongodb_mod, "AsyncIOMotorClient", ExplodingClient)
        conn = mongodb_mod.MongoDBConnection()

        await conn.setup_indexes()  # must not raise

    def test_get_db_connects_the_singleton_on_first_use(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(mongodb_mod, "AsyncIOMotorClient", FakeMotorClient)
        mongodb_mod.mongo_manager.client = None
        mongodb_mod.mongo_manager.db = None

        db = mongodb_mod.get_db()
        assert db is not None

        mongodb_mod.mongo_manager.close()


# ── core.redis / core.db / core.scheduler ─────────────────────────────────────


class TestCoreRedis:
    def test_pool_is_built_once_and_reused(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from src.core import redis as redis_mod

        redis_mod._pool = None
        built: list[int] = []
        monkeypatch.setattr(
            redis_mod.aioredis.ConnectionPool,
            "from_url",
            classmethod(lambda cls, *a, **k: (built.append(1), object())[1]),
        )

        first = redis_mod.get_redis_pool()
        second = redis_mod.get_redis_pool()

        assert first is second
        assert len(built) == 1
        redis_mod._pool = None

    @pytest.mark.asyncio
    async def test_ping_returns_false_when_the_client_raises(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from src.core import redis as redis_mod

        def _boom() -> None:
            raise RuntimeError("no redis")

        monkeypatch.setattr(redis_mod, "get_redis_client", _boom)
        assert await redis_mod.ping_redis() is False

    @pytest.mark.asyncio
    async def test_ping_returns_true_on_a_successful_ping(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from src.core import redis as redis_mod

        class FakeClient:
            async def ping(self) -> bool:
                return True

        monkeypatch.setattr(redis_mod, "get_redis_client", lambda: FakeClient())
        assert await redis_mod.ping_redis() is True


class TestCoreDb:
    @pytest.mark.asyncio
    async def test_ping_db_is_false_before_initialisation(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from src.core import db as db_mod

        monkeypatch.setattr(db_mod, "_client", None)
        assert await db_mod.ping_db() is False

    @pytest.mark.asyncio
    async def test_ping_db_is_true_when_the_admin_command_succeeds(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from src.core import db as db_mod

        class FakeAdmin:
            async def command(self, _cmd: str) -> dict[str, int]:
                return {"ok": 1}

        monkeypatch.setattr(db_mod, "_client", type("C", (), {"admin": FakeAdmin()})())
        assert await db_mod.ping_db() is True

    @pytest.mark.asyncio
    async def test_ping_db_is_false_when_the_admin_command_raises(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from src.core import db as db_mod

        class FakeAdmin:
            async def command(self, _cmd: str) -> None:
                raise RuntimeError("unreachable")

        monkeypatch.setattr(db_mod, "_client", type("C", (), {"admin": FakeAdmin()})())
        assert await db_mod.ping_db() is False

    @pytest.mark.asyncio
    async def test_close_db_is_safe_when_never_initialised(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from src.core import db as db_mod

        monkeypatch.setattr(db_mod, "_client", None)
        db_mod.close_db()  # must not raise

    @pytest.mark.asyncio
    async def test_close_db_closes_an_open_client(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from src.core import db as db_mod

        closed: list[bool] = []
        monkeypatch.setattr(
            db_mod, "_client", type("C", (), {"close": lambda self: closed.append(True)})()
        )

        db_mod.close_db()
        assert closed == [True]


class TestCoreScheduler:
    def test_enqueue_sends_the_scrape_task_to_celery(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from src.core import scheduler as sched_mod
        from src.workers import celery_app as celery_mod

        sent: list[tuple[Any, Any]] = []
        monkeypatch.setattr(
            celery_mod.celery_app,
            "send_task",
            lambda name, **kw: sent.append((name, kw)),
        )

        sched_mod._enqueue_pipeline()
        assert sent[0][0] == "src.workers.scraper_tasks.run_scrape_stage"
        assert sent[0][1]["queue"] == "scrape_queue"

    def test_start_and_stop_manage_the_scheduler_lifecycle(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from src.core import scheduler as sched_mod

        events: list[str] = []

        class FakeScheduler:
            def __init__(self, **_: object) -> None:
                pass

            def add_job(self, *_: object, **__: object) -> None:
                events.append("add_job")

            def start(self) -> None:
                events.append("start")

            def shutdown(self, **_: object) -> None:
                events.append("shutdown")

        monkeypatch.setattr(sched_mod, "AsyncIOScheduler", FakeScheduler)

        sched_mod.start_scheduler()
        sched_mod.stop_scheduler()

        assert events == ["add_job", "start", "shutdown"]

    def test_stop_is_safe_when_the_scheduler_was_never_started(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from src.core import scheduler as sched_mod

        monkeypatch.setattr(sched_mod, "_scheduler", None)
        sched_mod.stop_scheduler()  # must not raise
