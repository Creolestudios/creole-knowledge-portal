from __future__ import annotations

from src.models.article import Article
from src.models.profile import UserProfile
from src.ranker.vector_search import cosine_similarity, rank_by_vector_similarity


def _article(title: str, embedding: list[float]) -> Article:
    return Article(
        url=f"https://example.com/{title}",
        title=title,
        source_domain="example.com",
        embedding=embedding,
    )


def test_cosine_similarity_handles_invalid_embeddings() -> None:
    assert cosine_similarity([], [1.0]) == 0.0
    assert cosine_similarity([1.0], []) == 0.0
    assert cosine_similarity([1.0, 2.0], [1.0]) == 0.0
    assert cosine_similarity([0.0, 0.0], [1.0, 0.0]) == 0.0


def test_cosine_similarity_normalizes_to_zero_one() -> None:
    assert cosine_similarity([1.0, 0.0], [1.0, 0.0]) == 1.0
    assert cosine_similarity([1.0, 0.0], [-1.0, 0.0]) == 0.0


def test_cosine_similarity_returns_zero_for_nan_producing_inputs() -> None:
    import math

    result = cosine_similarity([float("inf")], [float("inf")])
    assert result == 0.0


def test_rank_by_vector_similarity_orders_articles() -> None:
    profile = UserProfile(user_id="user-1", profile_embedding=[1.0, 0.0])
    strong = _article("strong", [1.0, 0.0])
    weak = _article("weak", [0.0, 1.0])

    ranked = rank_by_vector_similarity(profile, [weak, strong])

    assert [item.article.title for item in ranked] == ["strong", "weak"]
    assert ranked[0].similarity > ranked[1].similarity


def test_rank_by_vector_similarity_respects_limit() -> None:
    profile = UserProfile(user_id="user-1", profile_embedding=[1.0, 0.0])
    a = _article("a", [1.0, 0.0])
    b = _article("b", [0.5, 0.5])
    c = _article("c", [0.0, 1.0])

    ranked = rank_by_vector_similarity(profile, [a, b, c], limit=2)
    assert len(ranked) == 2
    assert ranked[0].article.title == "a"
