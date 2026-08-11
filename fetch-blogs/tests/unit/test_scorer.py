from __future__ import annotations

from datetime import UTC, datetime, timedelta

from src.models.article import Article, ComplexityLevel
from src.models.profile import UserProfile
from src.ranker.scorer import (
    complexity_fit_score,
    is_rankable,
    recency_score,
    score_articles_for_profile,
    weighted_composite_score,
)


def _profile() -> UserProfile:
    return UserProfile(
        user_id="user-1",
        years_of_experience=4,
        primary_tech_stack=["Python", "FastAPI"],
        interests=["distributed systems"],
        excluded_topics=["crypto"],
        preferred_sources=["example.com"],
    )


def _article(title: str, **overrides: object) -> Article:
    values = {
        "url": f"https://example.com/{title.lower().replace(' ', '-')}",
        "title": title,
        "source_domain": "example.com",
        "summary": "Python FastAPI distributed systems patterns",
        "body_text": "A practical guide to Python services with FastAPI and queues.",
        "topics": ["python", "backend"],
        "tech_stack": ["FastAPI"],
        "complexity_level": ComplexityLevel.INTERMEDIATE,
        "published_at": datetime(2026, 7, 1, tzinfo=UTC),
        "engagement_score": 50.0,
        "authority_score": 0.7,
    }
    values.update(overrides)
    return Article(**values)


def test_weighted_composite_score_uses_approved_weights() -> None:
    score = weighted_composite_score(
        tfidf_relevance=1.0,
        authority=0.8,
        recency=0.6,
        engagement=0.4,
        complexity_fit=0.2,
    )

    assert score == 0.72


def test_recency_score_decays_inside_freshness_window() -> None:
    now = datetime(2026, 7, 10, tzinfo=UTC)
    published = now - timedelta(days=15)

    assert recency_score(published, freshness_days=30, now=now) == 0.5


def test_complexity_fit_prefers_matching_depth() -> None:
    profile = _profile()

    assert complexity_fit_score(ComplexityLevel.INTERMEDIATE, profile.content_depth) == 1.0
    assert complexity_fit_score(ComplexityLevel.ADVANCED, profile.content_depth) == 0.6
    assert complexity_fit_score(ComplexityLevel.BEGINNER, profile.content_depth) == 0.6


def test_is_rankable_excludes_paywall_robots_and_topics() -> None:
    profile = _profile()

    assert is_rankable(_article("Good"), profile.excluded_topics)
    assert not is_rankable(_article("Paywall", paywalled=True), profile.excluded_topics)
    assert not is_rankable(_article("Robots", robots_allowed=False), profile.excluded_topics)
    assert not is_rankable(_article("Crypto", topics=["crypto"]), profile.excluded_topics)


def test_score_articles_for_profile_sorts_and_filters() -> None:
    profile = _profile()
    now = datetime(2026, 7, 10, tzinfo=UTC)
    preferred = _article("Python FastAPI queues", engagement_score=100.0)
    stale = _article(
        "Generic tooling",
        source_domain="other.example",
        url="https://other.example/generic-tooling",
        summary="Generic tooling overview",
        body_text="Generic tooling overview",
        tech_stack=[],
        engagement_score=10.0,
        authority_score=0.2,
        published_at=now - timedelta(days=29),
    )
    blocked = _article("Crypto backend", topics=["crypto"])

    scored = score_articles_for_profile([stale, blocked, preferred], profile, now=now)

    assert [item.article.title for item in scored] == ["Python FastAPI queues", "Generic tooling"]
    assert scored[0].breakdown.composite_score > scored[1].breakdown.composite_score
