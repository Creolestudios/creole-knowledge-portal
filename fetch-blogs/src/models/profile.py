"""User profile document used to personalize article ranking."""

from __future__ import annotations

from datetime import UTC, date, datetime
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


class ScrapePace(StrEnum):
    """How tomorrow's scrape/teaching should move inside the active stack run."""

    CONTINUE = "continue"  # unattempted — next important piece, normal depth
    REMEDIAL = "remedial"  # fail attempt 1
    SIMPLER = "simpler"  # fail attempt 2
    SIMPLEST = "simplest"  # fail attempt 3 — same stack, clearest teaching
    ADVANCE = "advance"  # passed (≥60%)
    ADVANCE_HARD = "advance_hard"  # strong pass (≥80%)


# Pass bar aligned with student UI (3/5 ≈ 60%)
_PASS_RATIO = 0.60
_STRONG_PASS_RATIO = 0.80
# Keep one stack in run until enough digests / covered angles exist
_STACK_RUN_DIGEST_TARGET = 7
_STACK_RUN_COVERED_MIN = 6


class LearningPath(BaseModel):
    """Adaptive learning state embedded in a user profile (Mongo)."""

    last_topics: list[str] = Field(default_factory=list)
    # Kept for backwards compatibility / optional enrichment — NOT used for next scrape
    weak_topics: list[str] = Field(default_factory=list)
    next_step_topics: list[str] = Field(default_factory=list)
    served_urls: list[HttpUrl] = Field(default_factory=list)
    last_quiz_outcome: QuizOutcome | None = None
    last_quiz_date: datetime | None = None
    source_article_url: HttpUrl | None = None
    difficulty_direction: DifficultyDirection = DifficultyDirection.SAME
    last_quiz_blog_id: str | None = None
    last_quiz_percentage: float | None = None
    last_quiz_attempt_number: int | None = None
    last_quiz_score: int | None = None
    last_quiz_total: int | None = None
    # Active stack run — next day stays on this stack until coverage target met
    active_stack: str = ""
    stack_run_covered: list[str] = Field(default_factory=list)
    stack_run_digest_count: int = 0
    # Yesterday's briefing — used so today's digest continues the series
    last_digest_headline: str = ""
    last_digest_tldr: list[str] = Field(default_factory=list)
    last_digest_takeaways: list[str] = Field(default_factory=list)
    last_digest_date: date | None = None


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
        path = self.learning_path
        terms = [
            path.active_stack,
            *path.last_topics,
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
    "asyncio",
    "celery",
)


def topic_tokens_from_text(text: str) -> list[str]:
    """Return known tech topics found in a title or article blob."""
    haystack = text.lower()
    return list(dict.fromkeys(topic for topic in _KNOWN_TOPICS if topic in haystack))


def _normalize_term(term: str) -> str:
    return term.strip().lower()


def _stack_candidates(profile: UserProfile) -> list[str]:
    ordered = [
        *profile.primary_tech_stack,
        *profile.interests,
        *profile.secondary_tech_stack,
    ]
    return list(dict.fromkeys(_normalize_term(t) for t in ordered if t and str(t).strip()))


def resolve_active_stack(profile: UserProfile) -> str:
    """Return the stack currently in run, starting one from profile if needed."""
    path = profile.learning_path
    current = _normalize_term(path.active_stack or "")
    candidates = _stack_candidates(profile)
    if current:
        if not candidates or current in candidates or any(current in c or c in current for c in candidates):
            return current
    # Prefer a last-topic token that matches the user's stack list
    for item in path.last_topics:
        tokens = topic_tokens_from_text(item) or [_normalize_term(item)]
        for token in tokens:
            if token in candidates:
                path.active_stack = token
                return token
    if candidates:
        path.active_stack = candidates[0]
        return candidates[0]
    # No declared stack — fall back to a theme token if any
    for item in path.last_topics:
        tokens = topic_tokens_from_text(item) or [_normalize_term(item)]
        if tokens:
            path.active_stack = tokens[0]
            return tokens[0]
    path.active_stack = ""
    return ""


def stack_run_is_complete(path: LearningPath) -> bool:
    """True when enough of the active stack has been covered for this user."""
    if path.stack_run_digest_count >= _STACK_RUN_DIGEST_TARGET:
        return True
    covered = [t for t in path.stack_run_covered if t and t.strip()]
    return len(covered) >= _STACK_RUN_COVERED_MIN


def maybe_rotate_stack_run(profile: UserProfile) -> str:
    """If the current stack run is done, move to the next primary stack item."""
    path = profile.learning_path
    active = resolve_active_stack(profile)
    if not active or not stack_run_is_complete(path):
        return active
    candidates = _stack_candidates(profile)
    if not candidates:
        path.stack_run_covered = []
        path.stack_run_digest_count = 0
        return active
    try:
        idx = next(i for i, c in enumerate(candidates) if c == active or active in c or c in active)
        nxt = candidates[(idx + 1) % len(candidates)]
    except StopIteration:
        nxt = candidates[0]
    path.active_stack = nxt
    path.stack_run_covered = []
    path.stack_run_digest_count = 0
    return nxt


def next_scrape_pace(profile: UserProfile) -> ScrapePace:
    """Decide pace from marks + attempt + result only (no weak/next-step topics)."""
    path = profile.learning_path
    if path.last_quiz_outcome is None and path.last_quiz_percentage is None:
        return ScrapePace.CONTINUE

    pct = path.last_quiz_percentage
    ratio = (float(pct) / 100.0) if pct is not None else None
    if ratio is None and path.last_quiz_score is not None and path.last_quiz_total:
        ratio = path.last_quiz_score / max(path.last_quiz_total, 1)

    attempt = int(path.last_quiz_attempt_number or 1)
    attempt = max(1, min(3, attempt))

    passed = path.last_quiz_outcome is QuizOutcome.PASSED
    if path.last_quiz_outcome is None and ratio is not None:
        passed = ratio >= _PASS_RATIO
    if not passed and path.last_quiz_outcome is QuizOutcome.FAILED:
        passed = False
    if path.last_quiz_outcome is QuizOutcome.PASSED:
        passed = True

    if not passed:
        if attempt >= 3:
            return ScrapePace.SIMPLEST
        if attempt == 2:
            return ScrapePace.SIMPLER
        return ScrapePace.REMEDIAL

    if ratio is not None and ratio >= _STRONG_PASS_RATIO:
        return ScrapePace.ADVANCE_HARD
    return ScrapePace.ADVANCE


def scrape_focus_terms(profile: UserProfile) -> list[str]:
    """Focus scrape on the active stack run + continuity themes (not weak/next-step)."""
    resolve_active_stack(profile)
    maybe_rotate_stack_run(profile)
    active = resolve_active_stack(profile)
    path = profile.learning_path
    pace = next_scrape_pace(profile)

    continuity: list[str] = []
    for item in path.last_topics:
        continuity.extend(topic_tokens_from_text(item) or [_normalize_term(item)])
    continuity = [t for t in continuity if t]

    # Prefer continuity terms that stay inside the active stack family
    if active:
        related = [
            t
            for t in continuity
            if active in t or t in active or active.split()[0] in t
        ]
        # Always lead with active stack so we do not leave the run
        ordered = [active, *related, *continuity]
    else:
        ordered = [*continuity, *_stack_candidates(profile)]

    # Pace only tweaks angle keywords — still same stack
    if pace in {ScrapePace.REMEDIAL, ScrapePace.SIMPLER, ScrapePace.SIMPLEST}:
        extras = ["basics", "fundamentals", "explained"]
        if active:
            ordered = [active, *extras, *ordered]
        else:
            ordered = [*extras, *ordered]
    elif pace is ScrapePace.ADVANCE_HARD:
        extras = ["advanced", "production"]
        if active:
            ordered = [active, *extras, *ordered]
        else:
            ordered = [*extras, *ordered]

    normalized = (_normalize_term(term) for term in ordered)
    return list(dict.fromkeys(term for term in normalized if term))[:6]


def apply_quiz_result(
    profile: UserProfile,
    score: int,
    total: int,
    *,
    weak_topics: list[str] | None = None,
    next_step_topics: list[str] | None = None,
    percentage: float | None = None,
    passed: bool | None = None,
    attempt_number: int | None = None,
    blog_id: str | None = None,
) -> UserProfile:
    """Store marks/attempt/result and set difficulty for the next stack-run digest."""
    total = max(int(total), 1)
    ratio = max(0.0, min(1.0, int(score) / total))
    if percentage is not None:
        ratio = max(0.0, min(1.0, float(percentage) / 100.0))
    now = datetime.now(UTC)
    path = profile.learning_path
    path.last_quiz_date = now
    path.last_quiz_score = int(score)
    path.last_quiz_total = int(total)
    if blog_id:
        path.last_quiz_blog_id = blog_id
    path.last_quiz_percentage = (
        float(percentage) if percentage is not None else round(ratio * 100, 2)
    )
    if attempt_number is not None:
        path.last_quiz_attempt_number = max(1, min(3, int(attempt_number)))
    else:
        path.last_quiz_attempt_number = path.last_quiz_attempt_number or 1

    # Align with student UI: ≥60% = pass
    failed = (passed is False) if passed is not None else ratio < _PASS_RATIO
    if passed is True:
        failed = False
    strong = (not failed) and ratio >= _STRONG_PASS_RATIO
    attempt = int(path.last_quiz_attempt_number or 1)

    # Optional storage only — scrape ignores these
    weak = list(dict.fromkeys(_normalize_term(t) for t in (weak_topics or []) if t and t.strip()))
    nxt = list(dict.fromkeys(_normalize_term(t) for t in (next_step_topics or []) if t and t.strip()))
    if weak:
        path.weak_topics = weak
    if nxt:
        path.next_step_topics = nxt

    resolve_active_stack(profile)

    if failed:
        path.last_quiz_outcome = QuizOutcome.FAILED
        path.difficulty_direction = DifficultyDirection.EASIER
        # Attempt 3 still stays on stack — simplest teaching only
        if attempt >= 3:
            path.difficulty_direction = DifficultyDirection.EASIER
    elif strong:
        path.last_quiz_outcome = QuizOutcome.PASSED
        path.difficulty_direction = DifficultyDirection.HARDER
    else:
        path.last_quiz_outcome = QuizOutcome.PASSED
        path.difficulty_direction = DifficultyDirection.SAME

    profile.updated_at = now
    return profile


def record_stack_run_progress(profile: UserProfile, theme_terms: list[str]) -> None:
    """After publish: count this digest toward the active stack run coverage."""
    resolve_active_stack(profile)
    path = profile.learning_path
    if not path.active_stack:
        return
    path.stack_run_digest_count = int(path.stack_run_digest_count or 0) + 1
    covered = list(path.stack_run_covered)
    for term in theme_terms:
        t = _normalize_term(term)
        if t and t not in covered:
            covered.append(t)
    path.stack_run_covered = covered[:40]
    maybe_rotate_stack_run(profile)


def pace_teaching_instructions(pace: ScrapePace) -> str:
    """Prompt fragment for synthesizer based on quiz marks/attempts."""
    if pace is ScrapePace.REMEDIAL:
        return (
            "QUIZ PACE: reader failed attempt 1. Stay on the ACTIVE STACK. "
            "Re-teach the current idea more simply with concrete examples."
        )
    if pace is ScrapePace.SIMPLER:
        return (
            "QUIZ PACE: reader failed attempt 2. Stay on the ACTIVE STACK. "
            "Use an even narrower angle and very plain language."
        )
    if pace is ScrapePace.SIMPLEST:
        return (
            "QUIZ PACE: reader failed attempt 3. Stay on the SAME STACK — do not switch topics. "
            "Change only the teaching style: beginner-friendly steps, analogies, minimal jargon."
        )
    if pace is ScrapePace.ADVANCE_HARD:
        return (
            "QUIZ PACE: strong pass. Stay on the ACTIVE STACK and advance to the next "
            "important production-level piece in this stack series."
        )
    if pace is ScrapePace.ADVANCE:
        return (
            "QUIZ PACE: passed. Stay on the ACTIVE STACK and continue to the next "
            "important concept in this stack series."
        )
    return (
        "QUIZ PACE: no quiz yet / continue. Stay on the ACTIVE STACK and cover the next "
        "important piece in the series at normal depth."
    )


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
