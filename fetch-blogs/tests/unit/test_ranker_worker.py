"""Unit tests for the rank_queue Celery stage."""
from __future__ import annotations

from typing import Any

import pytest
from src.workers import ranker_tasks


# ── test doubles ──────────────────────────────────────────────────────────────


class FakeBreakdown:
    def __init__(self, composite_score: float = 0.5) -> None:
        self.composite_score = composite_score

    def model_copy(self, update: dict[str, Any] | None = None) -> FakeBreakdown:
        return self

    def model_dump(self) -> dict[str, Any]:
        return {"composite_score": self.composite_score}


class FakeArticle:
    def __init__(self, article_id: str | None = "a1") -> None:
        self.id = article_id
        self.quality_score = 0.0
        self.ranking_breakdown: Any = None
        self.llm_rerank_reason: str | None = None
        self.ranked_at: Any = None
        self.saved = False

    async def save(self) -> None:
        self.saved = True


class FakeScored:
    def __init__(self, article: FakeArticle, composite: float = 0.5) -> None:
        self.article = article
        self.breakdown = FakeBreakdown(composite)


class FakeRerankResult:
    def __init__(self, article_id: str, score: float = 0.9, reason: str = "relevant") -> None:
        self.article_id = article_id
        self.score = score
        self.reason = reason


class FakeVectorResult:
    def __init__(self, article: FakeArticle, similarity: float = 0.7) -> None:
        self.article = article
        self.similarity = similarity


@pytest.fixture
def patched_ranker(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Neutralise every collaborator of _rank_articles_for_user."""
    state: dict[str, Any] = {"profile": object(), "articles": []}

    async def _find_one(*_: object, **__: object) -> Any:
        return state["profile"]

    monkeypatch.setattr(ranker_tasks.UserProfile, "find_one", _find_one)

    async def _load(_ids: list[str]) -> list[Any]:
        return state["articles"]

    monkeypatch.setattr(ranker_tasks, "_load_articles", _load)
    monkeypatch.setattr(
        ranker_tasks,
        "score_articles_for_profile",
        lambda arts, _p: [FakeScored(a) for a in arts],
    )
    monkeypatch.setattr(
        ranker_tasks,
        "rank_by_vector_similarity",
        lambda _p, arts, limit=50: [FakeVectorResult(a) for a in arts],
    )
    monkeypatch.setattr(
        ranker_tasks.RerankCandidate,
        "from_article",
        classmethod(lambda cls, **kw: kw),
    )
    monkeypatch.setattr(
        ranker_tasks,
        "rerank_with_gemini",
        lambda _p, _c, limit=20: [FakeRerankResult("a1")],
    )
    monkeypatch.setattr(
        ranker_tasks.RankingBreakdown,
        "model_validate",
        classmethod(lambda cls, data: data),
    )
    return state


class TestArticleIdHelper:
    def test_returns_the_stringified_id(self) -> None:
        assert ranker_tasks._article_id(FakeArticle("abc")) == "abc"  # type: ignore[arg-type]

    def test_returns_an_empty_string_for_an_unsaved_document(self) -> None:
        assert ranker_tasks._article_id(FakeArticle(None)) == ""  # type: ignore[arg-type]


class TestLoadArticles:
    @pytest.mark.asyncio
    async def test_preserves_order_and_skips_missing_documents(self) -> None:
        from src.models.article import Article

        first = Article(
            url="https://dev.to/first",
            title="First",
            source_domain="dev.to",
            body_text="body " * 20,
        )
        second = Article(
            url="https://dev.to/second",
            title="Second",
            source_domain="dev.to",
            body_text="body " * 20,
        )
        await first.insert()
        await second.insert()

        loaded = await ranker_tasks._load_articles(
            [str(first.id), "507f1f77bcf86cd799439011", str(second.id)]
        )
        assert [article.id for article in loaded] == [first.id, second.id]


class TestRankArticlesForUser:
    @pytest.mark.asyncio
    async def test_returns_the_input_unchanged_when_the_profile_is_missing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def _none(*_: object, **__: object) -> None:
            return None

        monkeypatch.setattr(ranker_tasks.UserProfile, "find_one", _none)

        out = await ranker_tasks._rank_articles_for_user(["a1", "a2"], "u1", 10)
        assert out == ["a1", "a2"]

    @pytest.mark.asyncio
    async def test_returns_empty_when_no_articles_load(
        self, patched_ranker: dict[str, Any]
    ) -> None:
        patched_ranker["articles"] = []
        assert await ranker_tasks._rank_articles_for_user(["a1"], "u1", 10) == []

    @pytest.mark.asyncio
    async def test_persists_ranking_metadata_onto_each_article(
        self, patched_ranker: dict[str, Any]
    ) -> None:
        art = FakeArticle("a1")
        patched_ranker["articles"] = [art]

        out = await ranker_tasks._rank_articles_for_user(["a1"], "u1", 10)

        assert out == ["a1"]
        assert art.saved is True
        assert art.quality_score == 0.9
        assert art.llm_rerank_reason == "#1: relevant"
        assert art.ranked_at is not None

    @pytest.mark.asyncio
    async def test_skips_reranked_ids_that_are_not_in_the_scored_set(
        self, patched_ranker: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        art = FakeArticle("a1")
        patched_ranker["articles"] = [art]
        monkeypatch.setattr(
            ranker_tasks,
            "rerank_with_gemini",
            lambda _p, _c, limit=20: [FakeRerankResult("unknown-id")],
        )

        out = await ranker_tasks._rank_articles_for_user(["a1"], "u1", 10)
        assert out == ["unknown-id"]
        assert art.saved is False

    @pytest.mark.asyncio
    async def test_excludes_unsaved_articles_from_the_candidate_set(
        self, patched_ranker: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        patched_ranker["articles"] = [FakeArticle(None)]
        seen: list[Any] = []
        monkeypatch.setattr(
            ranker_tasks,
            "rerank_with_gemini",
            lambda _p, candidates, limit=20: (seen.append(candidates), [])[1],
        )

        await ranker_tasks._rank_articles_for_user(["a1"], "u1", 10)
        assert seen[0] == []


class TestRankArticlesTask:
    def test_task_delegates_to_the_async_implementation(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def _impl(ids: list[str], user_id: str, limit: int) -> list[str]:
            return [f"{user_id}:{limit}:{','.join(ids)}"]

        monkeypatch.setattr(ranker_tasks, "_rank_articles_for_user", _impl)

        # Call the undecorated function body via the Celery task's __wrapped__.
        out = ranker_tasks.rank_articles(["a1", "a2"], "u1", 5)
        assert out == ["u1:5:a1,a2"]
