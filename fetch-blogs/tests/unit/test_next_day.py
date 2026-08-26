"""Unit tests for next-day query building (embeddings + interests + score)."""

from __future__ import annotations

from src.models.profile import LearningPath, QuizOutcome, ScrapePace, UserProfile, next_scrape_pace
from src.ranker.next_day import (
    build_next_day_query_text,
    interest_scrape_terms,
    profile_has_discovery_prefs,
    refresh_profile_embedding,
)


def test_build_next_day_query_includes_interests_and_quiz_score() -> None:
    profile = UserProfile(
        user_id="u1",
        primary_tech_stack=["python"],
        interests=["asyncio"],
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
    assert "python" in text.lower()
    assert "asyncio" in text.lower()
    assert "Event loops" in text
    assert "38" in text
    assert "remedial" in text.lower() or "simpler" in text.lower()
    assert next_scrape_pace(profile) is ScrapePace.REMEDIAL


def test_interest_scrape_terms_prefer_stack_and_pace_hints() -> None:
    profile = UserProfile(
        user_id="u1",
        primary_tech_stack=["python"],
        interests=["redis"],
        learning_path=LearningPath(
            last_quiz_outcome=QuizOutcome.PASSED,
            last_quiz_percentage=90,
            last_quiz_attempt_number=1,
        ),
    )
    terms = interest_scrape_terms(profile)
    assert terms[0] in {"python", "redis"}
    assert "advanced" in terms or "production" in terms
    assert profile_has_discovery_prefs(profile) is True


def test_interest_scrape_terms_empty_when_admin_prefs_empty() -> None:
    """No invented tags — scraper should pull that day's latest instead."""
    profile = UserProfile(user_id="u-empty")
    assert interest_scrape_terms(profile) == []
    assert profile_has_discovery_prefs(profile) is False


def test_refresh_profile_embedding_stores_vector(monkeypatch) -> None:
    profile = UserProfile(user_id="u1", primary_tech_stack=["python"])
    monkeypatch.setattr(
        "src.ranker.next_day.embed_query",
        lambda _text: [0.1, 0.2, 0.3],
    )
    vector = refresh_profile_embedding(profile)
    assert vector == [0.1, 0.2, 0.3]
    assert profile.profile_embedding == [0.1, 0.2, 0.3]
