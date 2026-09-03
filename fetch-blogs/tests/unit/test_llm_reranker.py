from __future__ import annotations

from dataclasses import dataclass

import pytest

from src.models.profile import UserProfile
from src.ranker.llm_reranker import (
    RerankCandidate,
    fallback_rerank,
    parse_gemini_rerank_response,
    rerank_with_gemini,
)


@dataclass
class _Response:
    text: str


@dataclass
class _Model:
    response_text: str

    def generate_content(self, prompt: str) -> _Response:
        assert "Candidates" in prompt
        return _Response(text=self.response_text)


def _profile() -> UserProfile:
    return UserProfile(
        user_id="user-1",
        years_of_experience=6,
        primary_tech_stack=["Python"],
        interests=["AI"],
    )


def _candidates() -> list[RerankCandidate]:
    return [
        RerankCandidate(
            article_id="a",
            title="A",
            source_domain="example.com",
            composite_score=0.9,
            vector_similarity=0.8,
        ),
        RerankCandidate(
            article_id="b",
            title="B",
            source_domain="example.com",
            composite_score=0.5,
            vector_similarity=0.4,
        ),
    ]


def test_fallback_rerank_preserves_deterministic_order() -> None:
    results = fallback_rerank(_candidates(), limit=2)

    assert [result.article_id for result in results] == ["a", "b"]
    assert results[0].reason.startswith("Fallback rank")


def test_parse_gemini_rerank_response_validates_ids_and_order() -> None:
    results = parse_gemini_rerank_response(
        '{"results":[{"article_id":"b","score":0.99,"reason":"better"},'
        '{"article_id":"unknown","score":1,"reason":"skip"},'
        '{"article_id":"a","score":0.5,"reason":"ok"}]}',
        _candidates(),
    )

    assert [result.article_id for result in results] == ["b", "a"]


def test_rerank_with_gemini_uses_valid_model_response() -> None:
    model = _Model('{"results":[{"article_id":"b","score":0.99,"reason":"better"}]}')

    results = rerank_with_gemini(_profile(), _candidates(), limit=2, model=model)

    assert results[0].article_id == "b"
    assert results[0].reason == "better"
    assert {result.article_id for result in results} == {"a", "b"}


def test_rerank_with_gemini_falls_back_on_invalid_json() -> None:
    model = _Model("not-json")

    results = rerank_with_gemini(_profile(), _candidates(), limit=2, model=model)

    assert [result.article_id for result in results] == ["a", "b"]
    assert results[0].reason.startswith("Fallback rank")


def test_from_article_clamps_scores_and_truncates_lists() -> None:
    from types import SimpleNamespace

    article = SimpleNamespace(
        id="art-1",
        title="Ranked",
        source_domain="example.com",
        summary="s" * 800,
        topics=["python"] * 12,
        tech_stack=["fastapi"] * 12,
    )
    candidate = RerankCandidate.from_article(article, composite_score=1.4, vector_similarity=-0.2)  # type: ignore[arg-type]

    assert candidate.article_id == "art-1"
    assert candidate.summary == "s" * 600
    assert candidate.topics == ["python"] * 10
    assert candidate.tech_stack == ["fastapi"] * 10
    assert candidate.composite_score == 1.0
    assert candidate.vector_similarity == 0.0


def test_rerank_configures_gemini_when_no_model_is_passed(monkeypatch: pytest.MonkeyPatch) -> None:
    from src.core.config import Environment
    from src.ranker import llm_reranker

    class MockSettings:
        GEMINI_API_KEY = "test-key"
        GEMINI_MODEL = "gemini-test"

    class MockApp:
        ENVIRONMENT = Environment.STAGING

    configured: dict[str, str] = {}

    class FakeModel:
        def __init__(self, name: str) -> None:
            configured["model"] = name

        def generate_content(self, prompt: str) -> _Response:
            assert "Candidates" in prompt
            return _Response(text='{"results":[{"article_id":"a","score":0.9,"reason":"fit"}]}')

    monkeypatch.setattr(llm_reranker, "get_llm_settings", lambda: MockSettings())
    monkeypatch.setattr("src.core.config.get_app_settings", lambda: MockApp())
    # Also patch the import site used inside the function after from-import
    monkeypatch.setattr(
        "src.ranker.llm_reranker.get_app_settings",
        lambda: MockApp(),
        raising=False,
    )
    # get_app_settings is imported inside the function from src.core.config
    import src.core.config as core_config

    monkeypatch.setattr(core_config, "get_app_settings", lambda: MockApp())
    monkeypatch.setattr(
        llm_reranker.genai,
        "configure",
        lambda api_key: configured.update({"api_key": api_key}),
    )
    monkeypatch.setattr(llm_reranker.genai, "GenerativeModel", FakeModel)

    results = rerank_with_gemini(_profile(), _candidates(), limit=1, model=None)
    assert configured == {"api_key": "test-key", "model": "gemini-test"}
    assert results[0].article_id == "a"


def test_rerank_skips_gemini_in_local_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    from src.core.config import Environment
    import src.core.config as core_config

    class MockApp:
        ENVIRONMENT = Environment.LOCAL

    called = {"gemini": False}

    class FakeModel:
        def __init__(self, name: str) -> None:
            called["gemini"] = True

        def generate_content(self, prompt: str) -> _Response:
            called["gemini"] = True
            return _Response(text='{"results":[]}')

    monkeypatch.setattr(core_config, "get_app_settings", lambda: MockApp())
    monkeypatch.setattr(
        "src.ranker.llm_reranker.genai.GenerativeModel",
        FakeModel,
    )
    results = rerank_with_gemini(_profile(), _candidates(), limit=2, model=None)
    assert called["gemini"] is False
    assert [r.article_id for r in results] == ["a", "b"]
    assert "fallback" in results[0].reason.lower() or results[0].reason


def test_rerank_with_gemini_edge_cases_and_missing_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    from src.ranker import llm_reranker

    # Empty candidates returns empty list
    assert rerank_with_gemini(_profile(), [], limit=2) == []

    # Missing API key falls back to deterministic rank
    class MockSettings:
        GEMINI_API_KEY = ""
        GEMINI_MODEL = "gemini-3.6-flash"

    monkeypatch.setattr(llm_reranker, "get_llm_settings", lambda: MockSettings())
    results = rerank_with_gemini(_profile(), _candidates(), limit=2, model=None)
    assert [r.article_id for r in results] == ["a", "b"]

    # Empty extracted JSON returns fallback rank
    empty_model = _Model('{"results":[]}')
    empty_results = rerank_with_gemini(_profile(), _candidates(), limit=2, model=empty_model)
    assert [r.article_id for r in empty_results] == ["a", "b"]
