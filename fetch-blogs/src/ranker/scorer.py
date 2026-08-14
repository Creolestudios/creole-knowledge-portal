"""Deterministic article scoring for Strategy A and hybrid ranking."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Iterable

from pydantic import BaseModel, Field
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity as sklearn_cosine_similarity

from src.models.article import Article, ComplexityLevel, RankingBreakdown
from src.models.profile import ContentDepth, UserProfile

_SCORE_WEIGHTS = {
    "tfidf_relevance": 0.35,
    "authority": 0.25,
    "recency": 0.15,
    "engagement": 0.15,
    "complexity_fit": 0.10,
}


class ScoredArticle(BaseModel):
    """Article plus deterministic ranking details."""

    article: Article
    breakdown: RankingBreakdown


class ArticleScoreInput(BaseModel):
    """Small test-friendly score input independent from persistence."""

    article_id: str
    title: str
    summary: str = ""
    body_text: str = ""
    topics: list[str] = Field(default_factory=list)
    tech_stack: list[str] = Field(default_factory=list)
    source_domain: str = ""
    complexity_level: ComplexityLevel = ComplexityLevel.INTERMEDIATE
    published_at: datetime | None = None
    engagement_score: float = 0.0
    authority_score: float = 0.5
    paywalled: bool = False
    robots_allowed: bool = True


def clamp_score(value: float) -> float:
    """Clamp a score into the normalized 0..1 range."""
    return max(0.0, min(1.0, value))


def normalize_terms(terms: Iterable[str]) -> list[str]:
    """Normalize non-empty search/profile terms."""
    return [term.strip().lower() for term in terms if term.strip()]


def article_text(article: Article | ArticleScoreInput) -> str:
    """Return the weighted free-text representation used by TF-IDF."""
    terms = [
        article.title,
        article.summary,
        article.body_text[:5_000],
        " ".join(article.topics),
        " ".join(article.tech_stack),
        article.source_domain,
    ]
    return "\n".join(term for term in terms if term)


def is_rankable(article: Article | ArticleScoreInput, excluded_topics: Iterable[str]) -> bool:
    """Return whether an article is allowed into ranking."""
    if article.paywalled or not article.robots_allowed:
        return False
    normalized_exclusions = set(normalize_terms(excluded_topics))
    article_topics = set(normalize_terms([*article.topics, *article.tech_stack, article.title]))
    return normalized_exclusions.isdisjoint(article_topics)


def tfidf_relevance_scores(
    articles: list[Article | ArticleScoreInput], profile_terms: list[str]
) -> dict[int, float]:
    """Score article text against the profile query using TF-IDF cosine similarity."""
    if not articles or not profile_terms:
        return dict.fromkeys(range(len(articles)), 0.0)

    query = " ".join(profile_terms)
    documents = [query, *[article_text(article) for article in articles]]
    if not any(document.strip() for document in documents):
        return dict.fromkeys(range(len(articles)), 0.0)

    vectorizer = TfidfVectorizer(stop_words="english", ngram_range=(1, 2))
    matrix = vectorizer.fit_transform(documents)
    similarities = sklearn_cosine_similarity(matrix[0:1], matrix[1:]).flatten()
    return {index: clamp_score(float(score)) for index, score in enumerate(similarities)}


def authority_score(article: Article | ArticleScoreInput, preferred_sources: Iterable[str]) -> float:
    """Score source authority with a preferred-source bonus."""
    preferred = set(normalize_terms(preferred_sources))
    base = clamp_score(float(article.authority_score))
    if article.source_domain.strip().lower() in preferred:
        base += 0.15
    return clamp_score(base)


def recency_score(
    published_at: datetime | None, freshness_days: int, now: datetime | None = None
) -> float:
    """Return a linear freshness score inside the configured freshness window."""
    if published_at is None:
        return 0.25
    reference = now or datetime.now(UTC)
    published = published_at if published_at.tzinfo is not None else published_at.replace(tzinfo=UTC)
    age_days = max(0.0, (reference - published).total_seconds() / 86_400)
    if age_days >= freshness_days:
        return 0.0
    return clamp_score(1.0 - (age_days / freshness_days))


def engagement_score(article: Article | ArticleScoreInput, max_engagement: float) -> float:
    """Normalize engagement against the strongest candidate in the batch."""
    if max_engagement <= 0:
        return 0.0
    return clamp_score(float(article.engagement_score) / max_engagement)


def complexity_fit_score(
    article_level: ComplexityLevel, profile_depth: ContentDepth | ComplexityLevel
) -> float:
    """Score how well content complexity matches the user's preferred depth."""
    order = {
        "beginner": 0,
        "intermediate": 1,
        "advanced": 2,
    }
    distance = abs(order[article_level.value] - order[profile_depth.value])
    if distance == 0:
        return 1.0
    if distance == 1:
        return 0.6
    return 0.25


def weighted_composite_score(
    tfidf_relevance: float,
    authority: float,
    recency: float,
    engagement: float,
    complexity_fit: float,
) -> float:
    """Calculate the approved Strategy A weighted score."""
    return clamp_score(
        (_SCORE_WEIGHTS["tfidf_relevance"] * tfidf_relevance)
        + (_SCORE_WEIGHTS["authority"] * authority)
        + (_SCORE_WEIGHTS["recency"] * recency)
        + (_SCORE_WEIGHTS["engagement"] * engagement)
        + (_SCORE_WEIGHTS["complexity_fit"] * complexity_fit)
    )


def score_articles_for_profile(
    articles: list[Article], profile: UserProfile, now: datetime | None = None
) -> list[ScoredArticle]:
    """Return articles sorted by deterministic composite score."""
    rankable_articles = [article for article in articles if is_rankable(article, profile.excluded_topics)]
    tfidf_scores = tfidf_relevance_scores(rankable_articles, profile.ranking_terms)
    max_engagement = max((article.engagement_score for article in rankable_articles), default=0.0)

    scored: list[ScoredArticle] = []
    for index, article in enumerate(rankable_articles):
        tfidf = tfidf_scores[index]
        authority = authority_score(article, profile.preferred_sources)
        recency = recency_score(article.published_at, profile.content_freshness_days, now)
        engagement = engagement_score(article, max_engagement)
        complexity = complexity_fit_score(article.complexity_level, profile.content_depth)
        composite = weighted_composite_score(tfidf, authority, recency, engagement, complexity)
        scored.append(
            ScoredArticle(
                article=article,
                breakdown=RankingBreakdown(
                    tfidf_relevance=tfidf,
                    authority=authority,
                    recency=recency,
                    engagement=engagement,
                    complexity_fit=complexity,
                    composite_score=composite,
                    final_score=composite,
                ),
            )
        )

    return sorted(scored, key=lambda item: item.breakdown.composite_score, reverse=True)
