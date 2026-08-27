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
    "tutorial",
    "guide",
    "how to",
    "explained",
    "architecture",
    "performance",
    "debugging",
    "async",
    "embedding",
    "rag",
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

# Business / breaking-news posts — digests must stay educational, not news.
_NEWS_NOISE_MARKERS = (
    "acquires",
    "acquire ",
    "acquisition",
    "to acquire",
    "buy into",
    "bought ",
    "merger",
    "ipo",
    "raises $",
    "raised $",
    "funding round",
    "series a",
    "series b",
    "series c",
    "valuation",
    "earnings",
    "stock price",
    "shares soar",
    "market cap",
    "layoffs",
    "layoff",
    "breaking:",
    "just announced",
    "in talks to",
    "rumored to",
    "before wednesday",
    "billion deal",
    "billion dollar",
    "wsj",
    "wall street journal",
    "bloomberg",
    "reuters",
    "business insider",
    "times of india",
    "political",
    "election",
    "lawsuit",
    "sues ",
    "sued ",
)

# Repo dump / product landing pages — not teachable learning posts.
_REPO_DUMP_MARKERS = (
    "github - ",
    "show hn:",
    "launch hn:",
    "awesome list",
    "star this repo",
    "clone the repository",
    "getting started with our monorepo",
)

_NEWS_DOMAINS = (
    "wsj.com",
    "bloomberg.com",
    "reuters.com",
    "businessinsider.com",
    "cnn.com",
    "bbc.com",
    "nytimes.com",
    "ft.com",
    "forbes.com",
    "indiatimes.com",
    "timesofindia.indiatimes.com",
    "theguardian.com",
    "cnbc.com",
    "techcrunch.com",
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


def is_news_noise(
    title: str,
    body: str = "",
    *,
    source_domain: str = "",
    url: str = "",
) -> bool:
    """True for M&A / markets / general news that is not a learning article."""
    domain = (source_domain or "").lower().removeprefix("www.")
    host = ""
    if "://" in url:
        host = url.split("/")[2].lower().removeprefix("www.")
    check_host = domain or host
    if any(check_host == d or check_host.endswith("." + d) for d in _NEWS_DOMAINS):
        return True

    hay = f"{title} {body[:1200]}".lower()
    hits = sum(1 for marker in _NEWS_NOISE_MARKERS if marker in hay)
    if hits >= 1:
        # Allow true tutorials that merely mention funding once
        learning_signals = (
            "how to",
            "tutorial",
            "guide",
            "explained",
            "deep dive",
            "deep-dive",
            "walkthrough",
            "implement",
            "debugging",
            "architecture",
            "from scratch",
            "step by step",
            "step-by-step",
        )
        if any(sig in hay for sig in learning_signals) and hits == 1:
            return False
        return True
    return False


def is_repo_dump(
    title: str,
    body: str = "",
    *,
    source_domain: str = "",
    url: str = "",
) -> bool:
    """True for GitHub README / Show HN product dumps (folder trees, not lessons)."""
    domain = (source_domain or "").lower().removeprefix("www.")
    host = ""
    if "://" in url:
        host = url.split("/")[2].lower().removeprefix("www.")
    check_host = domain or host
    hay = f"{title} {body[:1500]}".lower()

    if any(marker in hay for marker in _REPO_DUMP_MARKERS):
        return True

    # Bare github.com/org/repo landing pages without tutorial framing
    if check_host in {"github.com", "www.github.com"} or hay.startswith("github - "):
        learning_signals = (
            "how to",
            "tutorial",
            "guide",
            "explained",
            "walkthrough",
            "debugging",
            "implement",
            "from scratch",
            "step by step",
            "lesson",
        )
        if not any(sig in hay for sig in learning_signals):
            tree_hits = hay.count("├──") + hay.count("└──") + hay.count("+--")
            if tree_hits >= 3 or "packages/" in hay or "monorepo" in hay:
                return True
            if title.strip().lower().startswith("github -"):
                return True
    return False


def is_non_learning(
    title: str,
    body: str = "",
    topics: list[str] | None = None,
    *,
    source_domain: str = "",
    url: str = "",
) -> bool:
    """True when the item should not enter a learning briefing (career fluff or news)."""
    if is_career_fluff(title, body, topics):
        return True
    if is_news_noise(title, body, source_domain=source_domain, url=url):
        return True
    return is_repo_dump(title, body, source_domain=source_domain, url=url)


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
