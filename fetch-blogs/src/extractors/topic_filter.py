"""Topic and complexity heuristics derived from extracted article text."""

from __future__ import annotations

from src.models.article import ComplexityLevel

_TECH_KEYWORDS = (
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
    "go",
    "rust",
    "java",
    "kotlin",
    "swift",
    "docker",
    "kubernetes",
    "aws",
    "gcp",
    "azure",
    "postgres",
    "mongodb",
    "redis",
    "graphql",
    "llm",
    "ai",
    "machine learning",
    "devops",
    "css",
    "html",
    "celery",
    "api",
    "hooks",
    "sql",
)

# Soft-skill / job-hunt posts that should never enter the morning briefing.
_CAREER_FLUFF_MARKERS = (
    "linkedin",
    "job interview",
    "job hunting",
    "first job",
    "your portfolio",
    "build a portfolio",
    "career advice",
    "resume",
    "feel ready",
    "applying for jobs",
    "apply for jobs",
    "online presence",
    "soft skill",
    "what companies expect",
    "day of learning",
    "learning javascript",
    "hire me",
    "job description",
    "github and linkedin",
    "pin your best",
    "real-world experience before",
    "progress updates",
    "don't wait until you feel",
    "do things in the right order",
)


def infer_topics(text: str, extra: list[str] | None = None) -> list[str]:
    """Return known tech keywords found in the article body."""
    haystack = text.lower()
    found = [keyword for keyword in _TECH_KEYWORDS if keyword in haystack]
    extras = [item.strip().lower() for item in extra or [] if item.strip()]
    return list(dict.fromkeys([*extras, *found]))[:15]


def is_career_fluff(
    title: str,
    body: str = "",
    topics: list[str] | None = None,
) -> bool:
    """True for job-hunt / soft-skill posts that must not enter digests."""
    hay = f"{title} {' '.join(topics or [])} {body[:2500]}".lower()
    hits = sum(1 for marker in _CAREER_FLUFF_MARKERS if marker in hay)
    tech = infer_topics(hay)
    if hits >= 2:
        return True
    if hits >= 1 and len(tech) < 3:
        return True
    return False


def infer_tech_stack(text: str, topics: list[str]) -> list[str]:
    """Return stack-like topics, preferring explicit topic tags."""
    if topics:
        return topics[:10]
    return infer_topics(text)[:10]


def infer_complexity(text: str) -> ComplexityLevel:
    """Heuristic complexity from length and jargon density."""
    words = text.split()
    jargon = infer_topics(text)
    if len(words) < 400 and len(jargon) <= 2:
        return ComplexityLevel.BEGINNER
    if len(words) > 1800 or len(jargon) >= 8:
        return ComplexityLevel.ADVANCED
    return ComplexityLevel.INTERMEDIATE
