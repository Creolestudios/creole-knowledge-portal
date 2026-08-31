"""Topic and complexity heuristics derived from extracted article text."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path

from src.models.article import ComplexityLevel

# Shared allowlist — edit shared/tech-keywords.json (not duplicated here).
_KEYWORDS_JSON = Path(__file__).resolve().parents[3] / "shared" / "tech-keywords.json"


@lru_cache(maxsize=1)
def _load_keyword_catalog() -> tuple[tuple[str, ...], frozenset[str], tuple[str, ...]]:
    data = json.loads(_KEYWORDS_JSON.read_text(encoding="utf-8"))
    keywords = tuple(str(k).strip().lower() for k in data.get("keywords", []) if str(k).strip())
    short = frozenset(str(t).strip().lower() for t in data.get("shortTokens", []) if str(t).strip())
    junk = tuple(str(j).strip().lower() for j in data.get("sourceJunkMarkers", []) if str(j).strip())
    return keywords, short, junk


def _tech_keywords() -> tuple[str, ...]:
    return _load_keyword_catalog()[0]


def _short_tech_tokens() -> frozenset[str]:
    return _load_keyword_catalog()[1]


def _source_junk_markers() -> tuple[str, ...]:
    return _load_keyword_catalog()[2]


def is_source_title_junk(title: str) -> bool:
    """True for obvious non-tech source titles (small blocklist in shared JSON)."""
    hay = str(title or "").strip().lower()
    if not hay:
        return True
    return any(marker in hay for marker in _source_junk_markers())

_SOFT_LEARNING_WORDS = (
    "tutorial",
    "guide",
    "how to",
    "explained",
)

_CJK_RE = re.compile(r"[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]")

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


def term_matches(haystack: str, term: str) -> bool:
    """Match interest/stack terms without substring false positives (go→golf)."""
    needle = (term or "").strip().lower()
    text = (haystack or "").lower()
    if not needle or not text:
        return False
    if len(needle) <= 3 or needle in _short_tech_tokens():
        return re.search(rf"(?<![a-z0-9]){re.escape(needle)}(?![a-z0-9])", text) is not None
    return needle in text


def matches_any_term(haystack: str, terms: list[str]) -> bool:
    """True when any interest term matches the haystack with safe boundaries."""
    cleaned = [str(t).strip() for t in terms if t and str(t).strip()]
    if not cleaned:
        return True
    return any(term_matches(haystack, term) for term in cleaned)


def infer_topics(text: str, extra: list[str] | None = None) -> list[str]:
    """Return known tech keywords found in the article body."""
    haystack = text.lower()
    found = [keyword for keyword in _tech_keywords() if term_matches(haystack, keyword)]
    # Ambiguous short tokens only when they appear as whole words
    for token in ("go", "ai", "api", "css", "html", "sql", "node", "java", "rust"):
        if term_matches(haystack, token):
            found.append(token)
    extras = [item.strip().lower() for item in extra or [] if item.strip()]
    return list(dict.fromkeys([*extras, *found]))[:15]


def is_non_english_dominant(text: str) -> bool:
    """True when the text is mostly CJK / non-English (not useful for EN digests)."""
    sample = (text or "")[:4000]
    if not sample.strip():
        return False
    cjk = len(_CJK_RE.findall(sample))
    latin = len(re.findall(r"[A-Za-z]", sample))
    if cjk >= 20 and cjk >= max(latin, 1) * 0.25:
        return True
    if cjk >= 12 and latin < 40:
        return True
    return False


def has_tech_learning_signal(
    title: str,
    body: str = "",
    topics: list[str] | None = None,
) -> bool:
    """True when the article has real engineering content (allowlist / tech keywords)."""
    hay = f"{title} {' '.join(topics or [])} {body[:2000]}"
    if is_non_english_dominant(hay):
        return False
    return bool(infer_topics(hay.lower(), topics))


def is_off_topic_lifestyle(title: str, body: str = "") -> bool:
    """True when content is NOT technology learning (allowlist-based, not a junk blacklist)."""
    return not has_tech_learning_signal(title, body)


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
    """True when the item should not enter a learning briefing.

    Gate is allowlist-first: must look like technology learning. Also reject
    binaries, career fluff, news noise, and repo dumps.
    """
    title_l = (title or "").strip().lower()
    url_l = (url or "").strip().lower()
    if title_l.endswith((".pdf", ".zip", ".exe", ".dmg")) or url_l.endswith(
        (".pdf", ".zip", ".exe", ".dmg")
    ):
        return True
    if is_non_english_dominant(f"{title}\n{body[:2000]}"):
        return True
    if is_career_fluff(title, body, topics):
        return True
    if is_news_noise(title, body, source_domain=source_domain, url=url):
        return True
    if is_repo_dump(title, body, source_domain=source_domain, url=url):
        return True
    # Allowlist: no tech signal → do not include
    if not has_tech_learning_signal(title, body, topics):
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
