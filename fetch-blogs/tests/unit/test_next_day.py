"""Unit tests for interest-first, else tech-stack trending selection."""

from __future__ import annotations

from src.models.profile import LearningPath, QuizOutcome, UserProfile
from src.ranker.next_day import (
    build_next_day_query_text,
    continuing_interest_run,
    continuity_scrape_terms,
    discovery_match_terms,
    discovery_scrape_terms,
    hay_is_off_interest_continuity,
    interest_scrape_terms,
    profile_has_discovery_prefs,
    profile_has_interests,
    profile_has_yesterday,
    quiz_focus_terms,
    refresh_profile_embedding,
    stack_scrape_terms,
)


def test_build_query_interest_day_one_uses_interests_only() -> None:
    profile = UserProfile(
        user_id="u-new-int",
        interests=["LLMs", "RAG"],
    )
    text = build_next_day_query_text(profile)
    assert "llm" in text.lower() or "rag" in text.lower()
    assert "Yesterday" not in text
    assert "trending" not in text.lower()


def test_build_query_interest_returning_includes_yesterday_and_quiz() -> None:
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
            weak_topics=["asyncio"],
        ),
    )
    assert continuing_interest_run(profile) is True
    text = build_next_day_query_text(profile)
    assert "asyncio" in text.lower()
    assert "redis" in text.lower()
    assert "yesterday" in text.lower()
    assert "quiz" in text.lower()
    assert "interests only" in text.lower()
    assert "trending" not in text.lower()


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


def test_continuity_scrape_terms_from_yesterday_for_interest_user() -> None:
    profile = UserProfile(
        user_id="u1",
        interests=["rag", "llm"],
        learning_path=LearningPath(
            last_digest_headline="RAG chunking in Python",
            last_topics=["rag", "chunking"],
        ),
    )
    terms = continuity_scrape_terms(profile)
    assert "rag" in terms or "chunking" in terms or "chunk" in terms
    assert "docker" not in terms


def test_interest_returning_discovery_uses_yesterday_and_quiz() -> None:
    profile = UserProfile(
        user_id="u-int-ret",
        interests=["rag", "llm"],
        learning_path=LearningPath(
            last_digest_headline="RAG chunking strategies",
            last_topics=["rag", "chunking"],
            last_digest_embedding=[0.1] * 8,
            last_quiz_outcome=QuizOutcome.FAILED,
            last_quiz_percentage=35,
            last_quiz_attempt_number=1,
            weak_topics=["embeddings"],
        ),
    )
    assert continuing_interest_run(profile) is True
    scrape = discovery_scrape_terms(profile)
    # Same shape as non-interest returning: yesterday + quiz (not a fresh interest dump).
    assert "rag" in scrape or "chunking" in scrape or "chunk" in scrape
    quiz = quiz_focus_terms(profile)
    assert quiz
    assert any(t in scrape for t in quiz) or "embedding" in " ".join(scrape)
    match = [t.lower() for t in discovery_match_terms(profile)]
    assert "rag" in match or "chunk" in match or "chunking" in match
    assert "flutter" not in match
    assert hay_is_off_interest_continuity("Beautiful Flutter UI animations", profile) is True
    assert hay_is_off_interest_continuity("RAG chunking with overlapping windows", profile) is False


def test_interest_day_one_scrape_terms_only_from_interests_field() -> None:
    """Day 1 interest users: interests only — no yesterday continuity yet."""
    profile = UserProfile(
        user_id="u1",
        primary_tech_stack=["python"],
        interests=["redis"],
    )
    terms = interest_scrape_terms(profile)
    assert terms == ["redis"]
    assert profile_has_interests(profile) is True
    assert profile_has_yesterday(profile) is False
    assert continuing_interest_run(profile) is False
    assert profile_has_discovery_prefs(profile) is True
    assert discovery_scrape_terms(profile) == ["redis"]
    assert discovery_match_terms(profile) == ["redis"]
    assert stack_scrape_terms(profile) == []


def test_sentence_interest_matches_llm_articles_not_raw_phrase() -> None:
    """Natural-language interests must expand to tech tokens for title matching."""
    from src.extractors.topic_filter import matches_any_term

    profile = UserProfile(
        user_id="u-llm",
        interests=["Want to learn about LLMs."],
    )
    match = [t.lower() for t in discovery_match_terms(profile)]
    assert "llm" in match
    assert "llms" in match
    assert not any("want" in t for t in match)
    assert matches_any_term(
        "LLM fine-tuning 101: a practical guide for developers",
        discovery_match_terms(profile),
    )
    assert matches_any_term(
        "Building with LLMs and RAG pipelines",
        discovery_match_terms(profile),
    )


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


def test_returning_match_uses_continuity_not_whole_stack_family() -> None:
    profile = UserProfile(
        user_id="u-cont",
        primary_tech_stack=["python"],
        learning_path=LearningPath(
            last_digest_headline="Python chunking for RAG pipelines",
            last_topics=["python", "chunks", "rag"],
            last_digest_embedding=[0.2] * 8,
            active_stack="python",
        ),
    )
    match = [t.lower() for t in discovery_match_terms(profile)]
    assert "rag" in match or "chunks" in match or "chunk" in match
    assert "pytorch" not in match
    assert "pandas" not in match
    from src.extractors.topic_filter import matches_any_term

    assert matches_any_term("Python chunking: overlapping windows for RAG", match) is True
    assert (
        matches_any_term(
            "Three Gemma 4 Deployments on One T4G for Under $3: What the Runtime Changes",
            match,
        )
        is False
    )


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


def test_refresh_reuses_yesterday_embedding_for_returning_interest_user(monkeypatch) -> None:
    stored = [0.9, 0.8, 0.7]
    profile = UserProfile(
        user_id="u1",
        interests=["rag", "llm"],
        learning_path=LearningPath(
            last_digest_headline="RAG basics",
            last_digest_embedding=stored,
            last_quiz_outcome=QuizOutcome.PASSED,
            last_quiz_percentage=80,
        ),
    )
    monkeypatch.setattr("src.ranker.next_day.embed_query", lambda _text: [0.4, 0.5])
    vector = refresh_profile_embedding(profile)
    assert vector == stored
    assert profile.profile_embedding == stored


def test_refresh_embeds_interests_on_interest_day_one(monkeypatch) -> None:
    profile = UserProfile(
        user_id="u1",
        interests=["python"],
    )
    seen: list[str] = []

    def _embed(text: str) -> list[float]:
        seen.append(text)
        return [0.1, 0.2, 0.3]

    monkeypatch.setattr("src.ranker.next_day.embed_query", _embed)
    vector = refresh_profile_embedding(profile)
    assert vector == [0.1, 0.2, 0.3]
    assert "python" in seen[0].lower()
    assert "Yesterday" not in seen[0]


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


def test_profile_has_yesterday_checks_all_signals() -> None:
    from datetime import date

    assert profile_has_yesterday(UserProfile(user_id="u0")) is False
    assert profile_has_yesterday(
        UserProfile(user_id="u1", learning_path=LearningPath(last_digest_embedding=[0.1]))
    )
    assert profile_has_yesterday(
        UserProfile(user_id="u2", learning_path=LearningPath(last_digest_headline="Python asyncio"))
    )
    assert profile_has_yesterday(
        UserProfile(user_id="u3", learning_path=LearningPath(last_digest_date=date(2026, 9, 1)))
    )
    assert profile_has_yesterday(
        UserProfile(user_id="u4", learning_path=LearningPath(last_topics=["python"]))
    )


def test_quiz_focus_terms_for_remedial_and_advance() -> None:
    remedial = UserProfile(
        user_id="u1",
        primary_tech_stack=["python"],
        learning_path=LearningPath(
            last_digest_headline="Python basics",
            last_quiz_outcome=QuizOutcome.FAILED,
            last_quiz_percentage=20,
            weak_topics=["asyncio", "typing"],
            next_step_topics=["fastapi"],
            last_topics=["django"],
        ),
    )
    terms = quiz_focus_terms(remedial)
    assert terms
    assert any("async" in t or "typing" in t for t in terms)

    advance = UserProfile(
        user_id="u2",
        primary_tech_stack=["python"],
        learning_path=LearningPath(
            last_digest_headline="Python basics",
            last_quiz_outcome=QuizOutcome.PASSED,
            last_quiz_percentage=90,
            next_step_topics=["fastapi"],
            attempt_count=1,
        ),
    )
    assert isinstance(quiz_focus_terms(advance), list)


def test_digest_embedding_text_and_store(monkeypatch) -> None:
    from src.ranker.next_day import digest_embedding_text, embed_and_store_digest

    text = digest_embedding_text(
        headline=" Python queues ",
        tldr=[" Celery workers ", ""],
        takeaways=["Use Redis"],
        section_snippets=["Briefing body", "   "],
    )
    assert "Python queues" in text
    assert "Celery workers" in text
    assert "Use Redis" in text
    assert "Briefing body" in text

    profile = UserProfile(user_id="u1")
    monkeypatch.setattr("src.ranker.next_day.embed_text", lambda *_a, **_k: [0.2, 0.3])
    vector = embed_and_store_digest(
        profile,
        headline="Python queues",
        tldr=["Celery"],
        takeaways=["Redis"],
    )
    assert vector == [0.2, 0.3]
    assert profile.learning_path.last_digest_embedding == [0.2, 0.3]

    monkeypatch.setattr("src.ranker.next_day.embed_text", lambda *_a, **_k: [])
    empty = embed_and_store_digest(profile, headline="", tldr=[], takeaways=[])
    assert empty == []


def test_refresh_falls_back_to_profile_embedding_when_query_empty(monkeypatch) -> None:
    profile = UserProfile(
        user_id="u1",
        interests=["python"],
        profile_embedding=[1.0, 2.0],
        learning_path=LearningPath(),
    )
    monkeypatch.setattr("src.ranker.next_day.embed_query", lambda _text: [])
    assert refresh_profile_embedding(profile) == [1.0, 2.0]


def test_hay_off_interest_and_family_helpers() -> None:
    from src.ranker.next_day import (
        canonicalize_topic,
        continuing_same_stack_run,
        family_for_stack_name,
        hay_is_off_yesterday_family,
        stack_curriculum_topics,
        uncovered_stack_topics,
        yesterday_theme_tokens,
    )

    profile = UserProfile(
        user_id="u1",
        interests=["llm", "rag"],
        learning_path=LearningPath(
            last_digest_headline="Building RAG with LLMs",
            last_topics=["rag", "llm"],
        ),
    )
    assert continuing_interest_run(profile) is True
    assert hay_is_off_interest_continuity("Flutter widget rebuilds", profile) is True
    assert hay_is_off_interest_continuity("llm embeddings for rag pipelines", profile) is False

    stack_profile = UserProfile(
        user_id="u2",
        primary_tech_stack=["python", "react"],
        learning_path=LearningPath(
            last_digest_headline="Python asyncio patterns",
            last_topics=["python", "asyncio"],
        ),
    )
    assert continuing_same_stack_run(stack_profile) is True
    assert hay_is_off_yesterday_family("React hooks tutorial", stack_profile) is True
    assert hay_is_off_yesterday_family("Python generators", stack_profile) is False
    assert yesterday_theme_tokens(stack_profile)
    assert canonicalize_topic("Python")
    assert family_for_stack_name("python")
    assert isinstance(stack_curriculum_topics(stack_profile), list)
    assert isinstance(uncovered_stack_topics(stack_profile), list)


def test_devto_tags_and_interest_base_tokens_filter_noise() -> None:
    from src.ranker.next_day import _devto_tags_from_values, interest_base_tokens

    tags = _devto_tags_from_values(["Python", "", "node.js", "want to learn about quantum"])
    assert tags

    profile = UserProfile(
        user_id="u1",
        interests=[
            "LLMs",
            "I want to learn about everything under the sun forever",
            "RAG",
        ],
    )
    tokens = interest_base_tokens(profile)
    assert tokens
    assert all(len(str(t).replace("-", " ").split()) < 5 for t in tokens[:8])


def test_remaining_helper_branches() -> None:
    from datetime import date
    from types import SimpleNamespace

    from src.ranker.next_day import (
        _is_devto_safe_tag,
        continuity_match_terms,
        continuity_scrape_terms,
        hay_is_off_yesterday_family,
        interest_base_tokens,
        stack_curriculum_topics,
        uncovered_interest_topics,
        yesterday_theme_tokens,
    )

    bare = SimpleNamespace(learning_path=None)
    assert profile_has_yesterday(bare) is False
    assert yesterday_theme_tokens(bare) == []
    assert interest_base_tokens(UserProfile(user_id="empty")) == []
    assert uncovered_interest_topics(UserProfile(user_id="empty")) == []
    assert continuity_match_terms(UserProfile(user_id="empty")) == []
    assert continuity_scrape_terms(UserProfile(user_id="empty")) == []
    assert hay_is_off_interest_continuity("anything", UserProfile(user_id="empty")) is False
    assert hay_is_off_yesterday_family(
        "React hooks",
        UserProfile(user_id="int", interests=["python"]),
    ) is False
    assert stack_curriculum_topics(
        UserProfile(user_id="cobol", primary_tech_stack=["cobol"])
    ) == []
    assert _is_devto_safe_tag("") is False
    assert _is_devto_safe_tag("bad:tag") is False
    assert _is_devto_safe_tag("this has four whole words") is False

    noisy = UserProfile(
        user_id="glue",
        interests=["want to learn python", "RAG pipelines"],
    )
    glue_tokens = interest_base_tokens(noisy)
    assert glue_tokens
    assert all("want to learn" not in str(t).lower() for t in glue_tokens)

    covered_interest = UserProfile(
        user_id="covered",
        interests=["python"],
        learning_path=LearningPath(
            last_digest_date=date(2026, 9, 1),
            last_digest_tldr=["Use asyncio queues"],
            stack_run_covered=["python"],
        ),
    )
    assert uncovered_interest_topics(covered_interest) == []
    assert discovery_scrape_terms(covered_interest)
    assert discovery_match_terms(covered_interest)

    unknown_stack = UserProfile(
        user_id="cobol",
        primary_tech_stack=["cobol"],
        learning_path=LearningPath(
            last_digest_headline="Cobol batch jobs",
            last_topics=["cobol"],
            active_stack="cobol",
        ),
    )
    assert hay_is_off_yesterday_family("random hardware launch", unknown_stack) is False
    assert discovery_match_terms(
        UserProfile(user_id="new-cobol", primary_tech_stack=["cobol"])
    )

    mixed = UserProfile(
        user_id="py",
        primary_tech_stack=["python"],
        learning_path=LearningPath(
            last_digest_headline="Python asyncio",
            last_topics=["python"],
            last_digest_tldr=["Use Redis queues"],
            last_digest_takeaways=["Scale workers"],
            active_stack="python",
        ),
    )
    assert continuity_scrape_terms(mixed)
    assert yesterday_theme_tokens(mixed)

    interest_filter = UserProfile(
        user_id="llm",
        interests=["llm", "rag"],
        learning_path=LearningPath(
            last_digest_headline="Building RAG with LLMs",
            last_topics=["rag"],
            last_digest_tldr=["chunk embeddings"],
            last_digest_takeaways=["kubernetes orchestration"],
            last_quiz_outcome=QuizOutcome.FAILED,
            last_quiz_percentage=20,
            weak_topics=["zod"],
        ),
    )
    matched = continuity_match_terms(interest_filter)
    assert matched
    assert all("kubernetes" not in str(t).lower() for t in matched)

    overlap = UserProfile(
        user_id="react-run",
        primary_tech_stack=["react"],
        learning_path=LearningPath(
            last_digest_headline="React hooks tutorial",
            last_topics=["react", "hooks"],
            active_stack="react",
        ),
    )
    assert hay_is_off_yesterday_family("python react hooks bindings", overlap) is False


def test_refresh_after_stack_rotation_reuses_previous_when_embed_empty(
    monkeypatch,
) -> None:
    from src.models.profile import record_stack_run_progress
    from src.ranker.next_day import stack_curriculum_topics

    profile = UserProfile(
        user_id="u-py",
        primary_tech_stack=["python", "react"],
        learning_path=LearningPath(
            active_stack="python",
            last_digest_embedding=[0.4, 0.5],
            last_digest_headline="Python Text Chunking: Overlapping Slices",
            last_topics=["python", "chunks"],
        ),
    )
    record_stack_run_progress(profile, list(stack_curriculum_topics(profile)))
    assert profile.learning_path.active_stack == "react"
    monkeypatch.setattr("src.ranker.next_day.embed_query", lambda _text: [])
    assert refresh_profile_embedding(profile) == [0.4, 0.5]
