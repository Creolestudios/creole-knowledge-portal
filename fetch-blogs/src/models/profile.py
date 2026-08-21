"""User profile document used to personalize article ranking."""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum

from beanie import Document, Indexed
from pydantic import BaseModel, Field, HttpUrl


class ContentDepth(StrEnum):
    """Preferred technical depth derived from years of experience."""

    BEGINNER = "beginner"
    INTERMEDIATE = "intermediate"
    ADVANCED = "advanced"


class QuizOutcome(StrEnum):
    """Result of the latest learning-path quiz."""

    PASSED = "passed"
    FAILED = "failed"


class DifficultyDirection(StrEnum):
    """Direction in which subsequent learning content should move."""

    EASIER = "easier"
    SAME = "same"
    HARDER = "harder"


class LearningPath(BaseModel):
    """Adaptive learning state embedded in a user profile."""

    last_topics: list[str] = Field(default_factory=list)
    weak_topics: list[str] = Field(default_factory=list)
    next_step_topics: list[str] = Field(default_factory=list)
    served_urls: list[HttpUrl] = Field(default_factory=list)
    last_quiz_outcome: QuizOutcome | None = None
    last_quiz_date: datetime | None = None
    source_article_url: HttpUrl | None = None
    difficulty_direction: DifficultyDirection = DifficultyDirection.SAME


class UserProfile(Document):
    """Profile signals used by ranking and digest generation."""

    user_id: Indexed(str, unique=True)
    name: str = ""
    years_of_experience: int = Field(default=0, ge=0)
    primary_tech_stack: list[str] = Field(default_factory=list)
    secondary_tech_stack: list[str] = Field(default_factory=list)
    interests: list[str] = Field(default_factory=list)
    current_role: str = ""
    preferred_content_depth: ContentDepth | None = None
    excluded_topics: list[str] = Field(default_factory=list)
    preferred_sources: list[str] = Field(default_factory=list)
    content_freshness_days: int = Field(default=30, ge=1)
    profile_embedding: list[float] = Field(default_factory=list)
    learning_path: LearningPath = Field(default_factory=LearningPath)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @property
    def content_depth(self) -> ContentDepth:
        """Return explicit depth or derive one from experience."""
        if self.preferred_content_depth is not None:
            return self.preferred_content_depth
        if self.years_of_experience <= 1:
            return ContentDepth.BEGINNER
        if self.years_of_experience <= 5:
            return ContentDepth.INTERMEDIATE
        return ContentDepth.ADVANCED

    @property
    def ranking_terms(self) -> list[str]:
        """Return normalized profile terms for content relevance scoring."""
        terms = [
            *self.learning_path.last_topics,
            *self.learning_path.next_step_topics,
            *self.learning_path.weak_topics,
            *self.primary_tech_stack,
            *self.secondary_tech_stack,
            *self.interests,
            self.current_role,
            self.content_depth.value,
        ]
        normalized = (term.strip().lower() for term in terms)
        return list(dict.fromkeys(term for term in normalized if term))

    class Settings:
        """Beanie collection settings."""

        name = "user_profiles"
        indexes = [
            "user_id",
            "primary_tech_stack",
            "interests",
        ]


_KNOWN_TOPICS = (
    "python",
    "javascript",
    "typescript",
    "react",
    "next.js",
    "nextjs",
    "node",
    "fastapi",
    "django",
    "flask",
    "docker",
    "kubernetes",
    "mongodb",
    "redis",
    "graphql",
    "aws",
    "llm",
    "ai",
)


def topic_tokens_from_text(text: str) -> list[str]:
    """Return known tech topics found in a title or article blob."""
    haystack = text.lower()
    return list(dict.fromkeys(topic for topic in _KNOWN_TOPICS if topic in haystack))


def scrape_focus_terms(profile: UserProfile) -> list[str]:
    """Prefer yesterday's topics, then quiz follow-ups, then the user's stack."""
    last: list[str] = []
    for item in profile.learning_path.last_topics:
        last.extend(topic_tokens_from_text(item) or [item.strip().lower()])
    last = [term for term in last if term]

    if profile.learning_path.last_quiz_outcome is QuizOutcome.FAILED:
        quiz_terms = list(profile.learning_path.weak_topics)
    else:
        quiz_terms = list(profile.learning_path.next_step_topics)

    stack = [
        *profile.primary_tech_stack,
        *profile.interests,
        *profile.secondary_tech_stack,
    ]
    ordered = [*last, *quiz_terms, *stack]
    normalized = (term.strip().lower() for term in ordered)
    return list(dict.fromkeys(term for term in normalized if term))[:6]


def apply_quiz_result(profile: UserProfile, score: int, total: int) -> UserProfile:
    """Update learning-path difficulty from a quiz score without wiping topics."""
    total = max(int(total), 1)
    ratio = max(0.0, min(1.0, int(score) / total))
    now = datetime.now(UTC)
    path = profile.learning_path
    path.last_quiz_date = now
    themes = list(path.last_topics)
    if ratio < 0.5:
        path.last_quiz_outcome = QuizOutcome.FAILED
        path.difficulty_direction = DifficultyDirection.EASIER
        path.weak_topics = themes or path.weak_topics
    elif ratio >= 0.8:
        path.last_quiz_outcome = QuizOutcome.PASSED
        path.difficulty_direction = DifficultyDirection.HARDER
        path.next_step_topics = themes or path.next_step_topics
    else:
        path.last_quiz_outcome = QuizOutcome.PASSED
        path.difficulty_direction = DifficultyDirection.SAME
    profile.updated_at = now
    return profile


def effective_content_depth(profile: UserProfile) -> ContentDepth:
    """Shift preferred depth one step based on the last quiz outcome."""
    order = [ContentDepth.BEGINNER, ContentDepth.INTERMEDIATE, ContentDepth.ADVANCED]
    current = profile.content_depth
    index = order.index(current)
    if profile.learning_path.difficulty_direction is DifficultyDirection.EASIER:
        return order[max(0, index - 1)]
    if profile.learning_path.difficulty_direction is DifficultyDirection.HARDER:
        return order[min(len(order) - 1, index + 1)]
    return current
