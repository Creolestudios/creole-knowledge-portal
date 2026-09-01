"""Unit tests for interest-first, else tech-stack trending selection."""

from __future__ import annotations

from src.models.profile import LearningPath, QuizOutcome, UserProfile
from src.ranker.next_day import (
    build_next_day_query_text,
    continuity_scrape_terms,
    discovery_match_terms,
    discovery_scrape_terms,
    interest_scrape_terms,
    profile_has_discovery_prefs,
    profile_has_interests,
    profile_has_yesterday,
    quiz_focus_terms,
    refresh_profile_embedding,
    stack_scrape_terms,
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
    assert "tech stack" not in text.lower()


def test_build_query_stack_trending_for_new_join_without_interests() -> None:
    profile = UserProfile(
        user_id="u-new",
        primary_tech_stack=["python"],
        secondary_tech_stack=["fastapi"],
    )
    text = build_next_day_query_text(profile)
    assert "python" in text.lower()
    assert "fastapi" in text.lower()
    assert "tech stack" in text.lower()
    assert "trending" in text.lower()
    assert "Yesterday" not in text


def test_build_query_continuity_for_returning_user_without_interests() -> None:
    profile = UserProfile(
        user_id="u-empty",
        primary_tech_stack=["python"],
        learning_path=LearningPath(
            last_digest_headline="Async Python event loops",
            last_topics=["asyncio"],
            last_quiz_outcome=QuizOutcome.FAILED,
            last_quiz_percentage=40,
            last_quiz_attempt_number=1,
            weak_topics=["asyncio"],
        ),
    )
    text = build_next_day_query_text(profile)
    assert "yesterday" in text.lower()
    assert "asyncio" in text.lower()
    assert "quiz" in text.lower()
    assert "Apple" not in text


def test_build_query_generic_only_when_no_interest_or_stack() -> None:
    profile = UserProfile(user_id="u-new")
    text = build_next_day_query_text(profile)
    assert "trending" in text.lower()
    assert "Yesterday" not in text
    assert "tech stack" not in text.lower()


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
    assert "asyncio" in terms
    assert "docker" not in terms
    assert "apple" not in terms


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
    assert discovery_scrape_terms(profile) == ["redis"]
    assert discovery_match_terms(profile) == ["redis"]
    assert stack_scrape_terms(profile) == []


def test_stack_terms_used_when_interests_empty_new_join() -> None:
    profile = UserProfile(
        user_id="u-empty",
        primary_tech_stack=["python"],
        secondary_tech_stack=["FastAPI"],
    )
    assert interest_scrape_terms(profile) == []
    assert profile_has_interests(profile) is False
    assert profile_has_yesterday(profile) is False
    assert profile_has_discovery_prefs(profile) is True
    assert "python" in stack_scrape_terms(profile)
    assert "fastapi" in stack_scrape_terms(profile)
    assert discovery_scrape_terms(profile) == stack_scrape_terms(profile)
    match = [t.lower() for t in discovery_match_terms(profile)]
    assert "python" in match
    assert "fastapi" in match
    assert "react" not in match
    assert "flutter" not in match


def test_returning_no_interest_discovery_uses_yesterday_and_quiz() -> None:
    profile = UserProfile(
        user_id="u-ret",
        primary_tech_stack=["python"],
        learning_path=LearningPath(
            last_digest_headline="Async Python event loops",
            last_topics=["asyncio"],
            last_digest_embedding=[0.1] * 8,
            last_quiz_outcome=QuizOutcome.FAILED,
            last_quiz_percentage=35,
            last_quiz_attempt_number=1,
            weak_topics=["eventloop"],
        ),
    )
    assert profile_has_yesterday(profile) is True
    scrape = discovery_scrape_terms(profile)
    assert "asyncio" in scrape
    assert "flutter" not in scrape
    quiz = quiz_focus_terms(profile)
    assert "eventloop" in quiz or "event-loop" in quiz or quiz


def test_returning_python_theme_excludes_flutter_stack() -> None:
    profile = UserProfile(
        user_id="u-py",
        primary_tech_stack=["python", "flutter"],
        secondary_tech_stack=["dart"],
        learning_path=LearningPath(
            last_digest_headline="Python chunking for RAG pipelines",
            last_topics=["python", "chunks", "rag"],
            last_digest_embedding=[0.2] * 8,
        ),
    )
    scrape = discovery_scrape_terms(profile)
    match = discovery_match_terms(profile)
    hay = " ".join(scrape + match).lower()
    assert "python" in hay
    assert "flutter" not in hay
    assert "dart" not in hay
    from src.extractors.topic_filter import matches_any_term

    assert matches_any_term("Chunking documents in Python for RAG", match) is True
    assert matches_any_term("Beautiful Flutter UI animations", match) is False


def test_python_yesterday_rejects_react_family() -> None:
    from src.ranker.next_day import hay_is_off_yesterday_family

    profile = UserProfile(
        user_id="u-py",
        primary_tech_stack=["python", "react"],
        learning_path=LearningPath(
            last_digest_headline="Python Text Chunking: Overlapping Slices",
            last_topics=["python", "chunks"],
            last_digest_embedding=[0.1] * 8,
        ),
    )
    assert hay_is_off_yesterday_family(
        "React 19 Actions: I Explained 3 Hooks Without Ever Explaining What an Action Is",
        profile,
    )
    assert not hay_is_off_yesterday_family(
        "Python chunking: overlapping windows for RAG",
        profile,
    )


def test_new_join_python_react_does_not_scrape_react() -> None:
    profile = UserProfile(
        user_id="u-new",
        primary_tech_stack=["python", "react"],
    )
    hay = " ".join(discovery_scrape_terms(profile) + discovery_match_terms(profile)).lower()
    assert "python" in hay
    assert "react" not in hay


def test_one_chunking_digest_does_not_rotate_to_react() -> None:
    from src.models.profile import record_stack_run_progress, stack_run_is_complete
    from src.ranker.next_day import stack_curriculum_topics

    profile = UserProfile(
        user_id="u-py",
        primary_tech_stack=["python", "react"],
        learning_path=LearningPath(active_stack="python"),
    )
    record_stack_run_progress(
        profile,
        ["python", "chunk", "chunks", "chunking", "rag", "embedding", "embeddings"],
    )
    assert profile.learning_path.active_stack == "python"
    assert stack_run_is_complete(profile) is False
    covered = set(profile.learning_path.stack_run_covered)
    assert "chunking" in covered
    assert "chunks" not in covered
    remaining = set(stack_curriculum_topics(profile)) - {
        "chunking",
        "rag",
        "embeddings",
    }
    assert remaining


def test_covering_all_python_topics_rotates_to_react() -> None:
    from src.models.profile import record_stack_run_progress, stack_run_is_complete
    from src.ranker.next_day import (
        hay_is_off_yesterday_family,
        stack_curriculum_topics,
    )

    profile = UserProfile(
        user_id="u-py",
        primary_tech_stack=["python", "react"],
        learning_path=LearningPath(
            active_stack="python",
            last_digest_headline="Python Text Chunking: Overlapping Slices",
            last_topics=["python", "chunks"],
            last_digest_embedding=[0.1] * 8,
        ),
    )
    curriculum = stack_curriculum_topics(profile)
    assert "django" in curriculum or "fastapi" in curriculum
    record_stack_run_progress(profile, list(curriculum))
    assert stack_run_is_complete(profile) is False
    assert profile.learning_path.active_stack == "react"
    assert hay_is_off_yesterday_family(
        "Python chunking: overlapping windows for RAG",
        profile,
    )
    assert not hay_is_off_yesterday_family(
        "React 19 Actions: I Explained 3 Hooks Without Ever Explaining What an Action Is",
        profile,
    )


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


def test_refresh_reuses_yesterday_embedding_for_returning_no_interest(monkeypatch) -> None:
    stored = [0.9, 0.8, 0.7]
    profile = UserProfile(
        user_id="u1",
        primary_tech_stack=["python"],
        learning_path=LearningPath(
            last_digest_headline="MongoDB indexing patterns",
            last_digest_embedding=stored,
        ),
    )
    monkeypatch.setattr("src.ranker.next_day.embed_query", lambda _text: [0.4, 0.5])
    vector = refresh_profile_embedding(profile)
    assert vector == stored
    assert profile.profile_embedding == stored


def test_refresh_embeds_stack_for_new_join_without_interests(monkeypatch) -> None:
    profile = UserProfile(
        user_id="u1",
        primary_tech_stack=["python"],
    )
    seen: list[str] = []

    def _embed(text: str) -> list[float]:
        seen.append(text)
        return [0.4, 0.5]

    monkeypatch.setattr("src.ranker.next_day.embed_query", _embed)
    vector = refresh_profile_embedding(profile)
    assert vector == [0.4, 0.5]
    assert "python" in seen[0].lower()
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
