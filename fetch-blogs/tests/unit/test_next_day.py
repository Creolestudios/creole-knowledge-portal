"""Unit tests for interest-only vs continuity+trending selection."""

from __future__ import annotations

from src.models.profile import LearningPath, QuizOutcome, UserProfile
from src.ranker.next_day import (
    build_next_day_query_text,
    continuity_scrape_terms,
    interest_scrape_terms,
    profile_has_discovery_prefs,
    profile_has_interests,
    refresh_profile_embedding,
)


def test_build_query_uses_interests_only_not_yesterday() -> None:
    profile = UserProfile(
        user_id="u1",
        primary_tech_stack=["python"],
        interests=["asyncio", "redis"],
        learning_path=LearningPath(
            last_digest_headline="Event loops in Python",
            last_topics=["asyncio"],
            last_quiz_outcome=QuizOutcome.FAILED,
            last_quiz_percentage=38,
            last_quiz_attempt_number=1,
            last_quiz_score=3,
            last_quiz_total=8,
        ),
    )
    text = build_next_day_query_text(profile)
    assert "asyncio" in text.lower()
    assert "redis" in text.lower()
    assert "Yesterday" not in text
    assert "Event loops" not in text
    assert "Continue the same" not in text


def test_build_query_continuity_and_trending_when_interests_empty() -> None:
    profile = UserProfile(
        user_id="u-empty",
        primary_tech_stack=["python"],
        learning_path=LearningPath(
            last_digest_headline="RAG pipelines with Python",
            last_topics=["rag", "python"],
            last_digest_tldr=["Vector search basics"],
            active_stack="rag",
        ),
    )
    text = build_next_day_query_text(profile)
    assert "Yesterday" in text
    assert "RAG pipelines" in text
    assert "Continue the same" in text
    assert "rag" in text.lower()
    assert "trending" in text.lower()


def test_build_query_trending_only_on_first_day_no_yesterday() -> None:
    profile = UserProfile(user_id="u-new", primary_tech_stack=["python"])
    text = build_next_day_query_text(profile)
    assert "trending" in text.lower()
    assert "Yesterday" not in text


def test_continuity_scrape_terms_from_yesterday_not_stack() -> None:
    profile = UserProfile(
        user_id="u1",
        primary_tech_stack=["docker"],
        learning_path=LearningPath(
            last_digest_headline="Async Python event loops",
            last_topics=["asyncio"],
            active_stack="python",
        ),
    )
    terms = continuity_scrape_terms(profile)
    assert "python" in terms
    assert "asyncio" in terms
    assert "docker" not in terms


def test_continuity_scrape_terms_empty_when_interests_filled() -> None:
    profile = UserProfile(
        user_id="u1",
        interests=["redis"],
        learning_path=LearningPath(last_topics=["python"]),
    )
    assert continuity_scrape_terms(profile) == []


def test_interest_scrape_terms_only_from_interests_field() -> None:
    profile = UserProfile(
        user_id="u1",
        primary_tech_stack=["python"],
        interests=["redis"],
        learning_path=LearningPath(
            active_stack="python",
            last_quiz_outcome=QuizOutcome.PASSED,
            last_quiz_percentage=90,
            last_quiz_attempt_number=1,
            last_digest_embedding=[0.1, 0.2],
        ),
    )
    terms = interest_scrape_terms(profile)
    assert terms == ["redis"]
    assert profile_has_interests(profile) is True
    assert profile_has_discovery_prefs(profile) is True


def test_interest_scrape_terms_empty_when_interests_empty() -> None:
    profile = UserProfile(user_id="u-empty", primary_tech_stack=["python"])
    assert interest_scrape_terms(profile) == []
    assert profile_has_interests(profile) is False
    assert profile_has_discovery_prefs(profile) is False


def test_refresh_embeds_interests_not_yesterday(monkeypatch) -> None:
    profile = UserProfile(
        user_id="u1",
        interests=["python"],
        learning_path=LearningPath(
            last_digest_headline="RAG basics",
            last_digest_embedding=[0.9, 0.8, 0.7],
            last_quiz_outcome=QuizOutcome.PASSED,
            last_quiz_percentage=80,
        ),
    )
    seen: list[str] = []

    def _embed(text: str) -> list[float]:
        seen.append(text)
        return [0.1, 0.2, 0.3]

    monkeypatch.setattr("src.ranker.next_day.embed_query", _embed)
    vector = refresh_profile_embedding(profile)
    assert vector == [0.1, 0.2, 0.3]
    assert "python" in seen[0].lower()
    assert "RAG basics" not in seen[0]


def test_refresh_embeds_yesterday_for_no_interest_user(monkeypatch) -> None:
    profile = UserProfile(
        user_id="u1",
        learning_path=LearningPath(
            last_digest_headline="MongoDB indexing patterns",
            last_digest_tldr=["Compound indexes"],
        ),
    )
    seen: list[str] = []

    def _embed(text: str) -> list[float]:
        seen.append(text)
        return [0.4, 0.5]

    monkeypatch.setattr("src.ranker.next_day.embed_query", _embed)
    vector = refresh_profile_embedding(profile)
    assert vector == [0.4, 0.5]
    assert "MongoDB indexing" in seen[0]
    assert "trending" in seen[0].lower()


def test_refresh_falls_back_to_stored_digest_embedding(monkeypatch) -> None:
    profile = UserProfile(
        user_id="u1",
        interests=["python"],
        learning_path=LearningPath(last_digest_embedding=[0.9, 0.8, 0.7]),
    )
    monkeypatch.setattr("src.ranker.next_day.embed_query", lambda _text: [])
    vector = refresh_profile_embedding(profile)
    assert vector == [0.9, 0.8, 0.7]
