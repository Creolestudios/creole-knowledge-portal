from __future__ import annotations

from dataclasses import dataclass

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
