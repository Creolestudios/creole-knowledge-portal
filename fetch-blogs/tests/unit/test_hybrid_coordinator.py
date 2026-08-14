"""Unit tests for the Strategy-C hybrid pipeline coordinator.

Every external boundary (Supabase over httpx, MongoDB, the scrapers, the
AI ranking stages and the synthesizer) is stubbed so the orchestration logic
itself — filtering, ordering, fallbacks and error tolerance — is what's under
test.
"""
from __future__ import annotations

from typing import Any

import pytest

from src.hybrid import coordinator
from src.models.schemas import (
    Article,
    DailyDigest,
    DigestArticle,
    DigestMetadata,
    UserProfile,
)

# ── Test doubles ──────────────────────────────────────────────────────────────


class FakeResponse:
    def __init__(self, status_code: int = 200, payload: Any = None) -> None:
        self.status_code = status_code
        self._payload = payload if payload is not None else []

    def json(self) -> Any:
        return self._payload


class FakeAsyncClient:
    """Stands in for httpx.AsyncClient as an async context manager."""

    def __init__(self, response: FakeResponse | None = None, raise_on_get: bool = False) -> None:
        self._response = response or FakeResponse()
        self._raise = raise_on_get

    async def __aenter__(self) -> FakeAsyncClient:
        return self

    async def __aexit__(self, *_: object) -> None:
        return None

    async def get(self, *_: object, **__: object) -> FakeResponse:
        if self._raise:
            raise RuntimeError("network down")
        return self._response


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
    def __init__(self, find_one_result: Any = None, find_docs: list[dict[str, Any]] | None = None):
        self._find_one_result = find_one_result
        self._find_docs = find_docs or []
        self.inserted: list[Any] = []
        self.insert_many_calls: list[Any] = []
        self.updates: list[Any] = []
        self.deletes: list[Any] = []

    async def update_one(self, *args: object, **kwargs: object) -> None:
        self.updates.append((args, kwargs))

    async def insert_many(self, docs: Any) -> None:
        self.insert_many_calls.append(docs)

    async def find_one(self, *_: object) -> Any:
        return self._find_one_result

    async def insert_one(self, doc: Any) -> Any:
        self.inserted.append(doc)
        return type("Res", (), {"inserted_id": "mongo-id-1"})()

    def find(self, *_: object) -> FakeCursor:
        return FakeCursor(self._find_docs)

    async def delete_many(self, *_: object) -> None:
        self.deletes.append(True)


class FakeDB:
    def __init__(self, **collections: FakeCollection) -> None:
        self.user_profiles = collections.get("user_profiles", FakeCollection())
        self.scraped_sources = collections.get("scraped_sources", FakeCollection())
        self.articles = collections.get("articles", FakeCollection())
        self.daily_digests = collections.get("daily_digests", FakeCollection())


def make_article(title: str = "T", url: str = "https://x.com/a", **kw: Any) -> Article:
    defaults: dict[str, Any] = {
        "url": url,
        "title": title,
        "source_domain": "x.com",
        "body_text": "body text " * 60,
    }
    defaults.update(kw)
    return Article(**defaults)


def make_digest() -> DailyDigest:
    return DailyDigest(
        digest_id="d1",
        user_id="u1",
        article=DigestArticle(
            headline="H", tldr=["a"], sections=[], key_takeaways=[], sources=[]
        ),
        metadata=DigestMetadata(),
    )


@pytest.fixture
def stub_pipeline(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Neutralise every external stage; individual tests override as needed."""
    state: dict[str, Any] = {"db": FakeDB(), "digest": make_digest()}

    monkeypatch.setattr(coordinator, "get_db", lambda: state["db"])
    monkeypatch.setattr(coordinator, "fetch_hn_top_stories", lambda **_: [])
    monkeypatch.setattr(coordinator, "fetch_devto_articles", lambda **_: [])
    monkeypatch.setattr(coordinator, "parse_rss_feed", lambda **_: [])
    monkeypatch.setattr(coordinator, "get_profile_embedding", lambda _u: [])
    monkeypatch.setattr(coordinator, "semantic_rank", lambda arts, _e, top_n=20: arts[:top_n])
    monkeypatch.setattr(coordinator, "llm_rerank", lambda arts, _u, top_n=6: arts[:top_n])
    monkeypatch.setattr(coordinator, "enrich_article_via_jina", lambda a: a)
    monkeypatch.setattr(coordinator, "generate_daily_digest", lambda _u, _a: state["digest"])

    async def _no_sources() -> list[str]:
        return []

    monkeypatch.setattr(coordinator, "fetch_admin_blog_sources_from_supabase", _no_sources)

    async def _default_profile(user_id: str) -> UserProfile:
        return UserProfile(user_id=user_id, name="Dev", primary_tech_stack=["python"])

    monkeypatch.setattr(coordinator, "fetch_user_profile_from_supabase", _default_profile)
    return state


# ── fetch_user_profile_from_supabase ──────────────────────────────────────────


class TestFetchUserProfile:
    @pytest.mark.asyncio
    async def test_maps_supabase_row_onto_the_profile_schema(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = [
            {
                "user_id": "u1",
                "name": "Priya",
                "years_of_experience": "7",
                "primary_tech_stack": ["python"],
                "secondary_tech_stack": ["react"],
                "interests": ["llm"],
                "current_role": "Staff Engineer",
                "preferred_content_depth": "deep",
                "excluded_topics": ["crypto"],
            }
        ]
        monkeypatch.setattr(
            coordinator.httpx, "AsyncClient", lambda **_: FakeAsyncClient(FakeResponse(200, payload))
        )

        profile = await coordinator.fetch_user_profile_from_supabase("u1")
        assert profile.name == "Priya"
        assert profile.years_of_experience == 7
        assert profile.current_role == "Staff Engineer"
        assert profile.excluded_topics == ["crypto"]

    @pytest.mark.asyncio
    async def test_falls_back_to_future_learning_goals_for_interests(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = [{"user_id": "u1", "future_learning_goals": ["rust"]}]
        monkeypatch.setattr(
            coordinator.httpx, "AsyncClient", lambda **_: FakeAsyncClient(FakeResponse(200, payload))
        )

        profile = await coordinator.fetch_user_profile_from_supabase("u1")
        assert profile.interests == ["rust"]
        assert profile.name == "Developer"  # blank name coerced to the default

    @pytest.mark.asyncio
    async def test_returns_a_default_profile_on_an_empty_result(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            coordinator.httpx, "AsyncClient", lambda **_: FakeAsyncClient(FakeResponse(200, []))
        )

        profile = await coordinator.fetch_user_profile_from_supabase("u1")
        assert profile == UserProfile(user_id="u1", name="Developer")

    @pytest.mark.asyncio
    async def test_returns_a_default_profile_on_a_non_200(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            coordinator.httpx, "AsyncClient", lambda **_: FakeAsyncClient(FakeResponse(500))
        )

        profile = await coordinator.fetch_user_profile_from_supabase("u1")
        assert profile.name == "Developer"


# ── fetch_admin_blog_sources_from_supabase ────────────────────────────────────


class TestFetchAdminBlogSources:
    @pytest.mark.asyncio
    async def test_returns_only_rows_that_carry_a_url(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = [{"url": "https://a.com/feed"}, {"url": None}, {}]
        monkeypatch.setattr(
            coordinator.httpx, "AsyncClient", lambda **_: FakeAsyncClient(FakeResponse(200, payload))
        )

        assert await coordinator.fetch_admin_blog_sources_from_supabase() == ["https://a.com/feed"]

    @pytest.mark.asyncio
    async def test_returns_empty_on_a_non_200(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            coordinator.httpx, "AsyncClient", lambda **_: FakeAsyncClient(FakeResponse(404))
        )
        assert await coordinator.fetch_admin_blog_sources_from_supabase() == []

    @pytest.mark.asyncio
    async def test_swallows_network_errors(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            coordinator.httpx, "AsyncClient", lambda **_: FakeAsyncClient(raise_on_get=True)
        )
        assert await coordinator.fetch_admin_blog_sources_from_supabase() == []


# ── score_article_relevance ───────────────────────────────────────────────────


class TestScoreArticleRelevance:
    def test_exact_keyword_match_scores_higher_than_no_match(self) -> None:
        hit = make_article(title="Deep dive into Python asyncio", body_text="asyncio internals")
        miss = make_article(title="Gardening tips", body_text="soil and water")

        assert coordinator.score_article_relevance(hit, ["python"]) > 0
        assert coordinator.score_article_relevance(miss, ["python"]) == 0.0

    def test_matches_against_tags_as_well_as_title_and_body(self) -> None:
        art = make_article(title="Untitled", body_text="nothing here", tags=["kubernetes"])
        assert coordinator.score_article_relevance(art, ["kubernetes"]) > 0

    def test_multi_word_keywords_accumulate_partial_credit(self) -> None:
        art = make_article(title="Machine intelligence", body_text="learning systems")
        # Neither full phrase matches, but both words do -> partial credit only.
        score = coordinator.score_article_relevance(art, ["machine learning"])
        assert 0 < score < 10.0

    def test_short_words_are_ignored_for_partial_credit(self) -> None:
        art = make_article(title="An analysis", body_text="of go")
        assert coordinator.score_article_relevance(art, ["is at"]) == 0.0

    def test_no_keywords_yields_a_zero_score(self) -> None:
        assert coordinator.score_article_relevance(make_article(), []) == 0.0


# ── run_hybrid_pipeline ───────────────────────────────────────────────────────


class TestRunHybridPipeline:
    @pytest.mark.asyncio
    async def test_happy_path_returns_a_strategy_c_digest(
        self, monkeypatch: pytest.MonkeyPatch, stub_pipeline: dict[str, Any]
    ) -> None:
        monkeypatch.setattr(
            coordinator, "fetch_hn_top_stories", lambda **_: [make_article("HN post")]
        )

        digest = await coordinator.run_hybrid_pipeline("u1")

        assert digest.strategy_used == "C"
        assert stub_pipeline["db"].articles.inserted, "new article should be cached"
        assert stub_pipeline["db"].daily_digests.inserted, "digest should be persisted"

    @pytest.mark.asyncio
    async def test_mirrors_the_user_profile_into_mongo(
        self, stub_pipeline: dict[str, Any]
    ) -> None:
        await coordinator.run_hybrid_pipeline("u1")
        assert stub_pipeline["db"].user_profiles.updates, "profile should be upserted"

    @pytest.mark.asyncio
    async def test_records_each_scraped_source_with_its_status(
        self, monkeypatch: pytest.MonkeyPatch, stub_pipeline: dict[str, Any]
    ) -> None:
        def _boom(**_: object) -> list[Article]:
            raise RuntimeError("HN unreachable")

        monkeypatch.setattr(coordinator, "fetch_hn_top_stories", _boom)

        await coordinator.run_hybrid_pipeline("u1")

        recorded = stub_pipeline["db"].scraped_sources.insert_many_calls[0]
        hn_entry = next(r for r in recorded if r["type"] == "hacker_news")
        assert hn_entry["status"] == "failed"
        assert hn_entry["articles_count"] == 0

    @pytest.mark.asyncio
    async def test_queries_devto_with_a_default_tag_when_the_profile_is_bare(
        self, monkeypatch: pytest.MonkeyPatch, stub_pipeline: dict[str, Any]
    ) -> None:
        async def _bare(user_id: str) -> UserProfile:
            return UserProfile(user_id=user_id, name="Dev")

        monkeypatch.setattr(coordinator, "fetch_user_profile_from_supabase", _bare)
        seen: list[str] = []
        monkeypatch.setattr(
            coordinator,
            "fetch_devto_articles",
            lambda tag, limit: (seen.append(tag), [])[1],
        )

        await coordinator.run_hybrid_pipeline("u1")
        assert seen == ["webdev"]

    @pytest.mark.asyncio
    async def test_scrapes_custom_rss_feeds_and_caps_them_at_four(
        self, monkeypatch: pytest.MonkeyPatch, stub_pipeline: dict[str, Any]
    ) -> None:
        async def _six_feeds() -> list[str]:
            return [f"https://f{i}.com/rss" for i in range(6)]

        monkeypatch.setattr(coordinator, "fetch_admin_blog_sources_from_supabase", _six_feeds)
        seen: list[str] = []
        monkeypatch.setattr(
            coordinator,
            "parse_rss_feed",
            lambda feed_url, limit: (seen.append(feed_url), [])[1],
        )

        await coordinator.run_hybrid_pipeline("u1")
        assert len(seen) == 4

    @pytest.mark.asyncio
    async def test_drops_articles_matching_an_excluded_topic(
        self, monkeypatch: pytest.MonkeyPatch, stub_pipeline: dict[str, Any]
    ) -> None:
        async def _profile(user_id: str) -> UserProfile:
            return UserProfile(user_id=user_id, name="Dev", excluded_topics=["crypto"])

        monkeypatch.setattr(coordinator, "fetch_user_profile_from_supabase", _profile)
        monkeypatch.setattr(
            coordinator,
            "fetch_hn_top_stories",
            lambda **_: [
                make_article("Crypto mining rigs", url="https://x.com/crypto"),
                make_article("Python typing", url="https://x.com/py"),
            ],
        )
        synthesised: list[list[Article]] = []
        monkeypatch.setattr(
            coordinator,
            "generate_daily_digest",
            lambda _u, arts: (synthesised.append(arts), stub_pipeline["digest"])[1],
        )

        await coordinator.run_hybrid_pipeline("u1")

        titles = [a.title for a in synthesised[0]]
        assert "Crypto mining rigs" not in titles
        assert "Python typing" in titles

    @pytest.mark.asyncio
    async def test_uses_semantic_ranking_when_an_embedding_is_available(
        self, monkeypatch: pytest.MonkeyPatch, stub_pipeline: dict[str, Any]
    ) -> None:
        monkeypatch.setattr(coordinator, "get_profile_embedding", lambda _u: [0.4] * 8)
        called: list[bool] = []
        monkeypatch.setattr(
            coordinator,
            "semantic_rank",
            lambda arts, _e, top_n=20: (called.append(True), arts[:top_n])[1],
        )
        monkeypatch.setattr(coordinator, "fetch_hn_top_stories", lambda **_: [make_article()])

        await coordinator.run_hybrid_pipeline("u1")
        assert called == [True]

    @pytest.mark.asyncio
    async def test_skips_semantic_ranking_for_an_all_zero_embedding(
        self, monkeypatch: pytest.MonkeyPatch, stub_pipeline: dict[str, Any]
    ) -> None:
        monkeypatch.setattr(coordinator, "get_profile_embedding", lambda _u: [0.0] * 8)
        called: list[bool] = []
        monkeypatch.setattr(
            coordinator,
            "semantic_rank",
            lambda arts, _e, top_n=20: (called.append(True), arts)[1],
        )
        monkeypatch.setattr(coordinator, "fetch_hn_top_stories", lambda **_: [make_article()])

        await coordinator.run_hybrid_pipeline("u1")
        assert called == []

    @pytest.mark.asyncio
    async def test_tolerates_a_failing_profile_embedding(
        self, monkeypatch: pytest.MonkeyPatch, stub_pipeline: dict[str, Any]
    ) -> None:
        def _boom(_u: object) -> list[float]:
            raise RuntimeError("embedding service down")

        monkeypatch.setattr(coordinator, "get_profile_embedding", _boom)
        monkeypatch.setattr(coordinator, "fetch_hn_top_stories", lambda **_: [make_article()])

        digest = await coordinator.run_hybrid_pipeline("u1")
        assert digest.strategy_used == "C"

    @pytest.mark.asyncio
    async def test_falls_back_to_newspaper_extraction_when_jina_returns_thin_content(
        self, monkeypatch: pytest.MonkeyPatch, stub_pipeline: dict[str, Any]
    ) -> None:
        thin = make_article("Thin", url="https://x.com/thin")
        thin.body_text = "tiny"
        monkeypatch.setattr(coordinator, "fetch_hn_top_stories", lambda **_: [thin])
        monkeypatch.setattr(coordinator, "enrich_article_via_jina", lambda a: a)

        import src.scrapers.extractor as extractor_mod

        monkeypatch.setattr(
            extractor_mod,
            "extract_article_content",
            lambda _url: {
                "body_text": "recovered body " * 40,
                "body_markdown": "# recovered",
                "word_count": 80,
                "reading_time_min": 2.0,
                "author": "Recovered Author",
            },
        )

        await coordinator.run_hybrid_pipeline("u1")
        assert thin.author == "Recovered Author"
        assert thin.word_count == 80

    @pytest.mark.asyncio
    async def test_tolerates_a_failing_deep_scrape(
        self, monkeypatch: pytest.MonkeyPatch, stub_pipeline: dict[str, Any]
    ) -> None:
        def _boom(_a: object) -> Article:
            raise RuntimeError("jina exploded")

        monkeypatch.setattr(coordinator, "fetch_hn_top_stories", lambda **_: [make_article()])
        monkeypatch.setattr(coordinator, "enrich_article_via_jina", _boom)

        digest = await coordinator.run_hybrid_pipeline("u1")
        assert digest.strategy_used == "C"

    @pytest.mark.asyncio
    async def test_falls_back_to_semantic_order_when_the_llm_reranker_fails(
        self, monkeypatch: pytest.MonkeyPatch, stub_pipeline: dict[str, Any]
    ) -> None:
        def _boom(*_: object, **__: object) -> list[Article]:
            raise RuntimeError("gemini down")

        monkeypatch.setattr(coordinator, "fetch_hn_top_stories", lambda **_: [make_article()])
        monkeypatch.setattr(coordinator, "llm_rerank", _boom)

        digest = await coordinator.run_hybrid_pipeline("u1")
        assert digest.strategy_used == "C"

    @pytest.mark.asyncio
    async def test_reuses_an_already_cached_article_instead_of_reinserting(
        self, monkeypatch: pytest.MonkeyPatch, stub_pipeline: dict[str, Any]
    ) -> None:
        stub_pipeline["db"].articles = FakeCollection(find_one_result={"_id": "existing-id"})
        monkeypatch.setattr(coordinator, "fetch_hn_top_stories", lambda **_: [make_article()])

        await coordinator.run_hybrid_pipeline("u1")
        assert stub_pipeline["db"].articles.inserted == []

    @pytest.mark.asyncio
    async def test_loads_older_mongo_articles_when_scraping_yields_nothing(
        self, stub_pipeline: dict[str, Any]
    ) -> None:
        stub_pipeline["db"].articles = FakeCollection(
            find_docs=[
                {
                    "_id": "old-1",
                    "url": "https://x.com/old",
                    "title": "Older piece",
                    "source_domain": "x.com",
                    "body_text": "body",
                }
            ]
        )
        captured: list[list[Article]] = []
        import src.hybrid.coordinator as c

        original = c.generate_daily_digest
        c.generate_daily_digest = lambda _u, arts: (  # type: ignore[assignment]
            captured.append(arts),
            stub_pipeline["digest"],
        )[1]
        try:
            await coordinator.run_hybrid_pipeline("u1")
        finally:
            c.generate_daily_digest = original  # type: ignore[assignment]

        assert [a.title for a in captured[0]] == ["Older piece"]

    @pytest.mark.asyncio
    async def test_still_returns_the_digest_when_persistence_fails(
        self, monkeypatch: pytest.MonkeyPatch, stub_pipeline: dict[str, Any]
    ) -> None:
        class ExplodingDigests(FakeCollection):
            async def delete_many(self, *_: object) -> None:
                raise RuntimeError("mongo unavailable")

        stub_pipeline["db"].daily_digests = ExplodingDigests()
        monkeypatch.setattr(coordinator, "fetch_hn_top_stories", lambda **_: [make_article()])

        digest = await coordinator.run_hybrid_pipeline("u1")
        assert digest.strategy_used == "C"
