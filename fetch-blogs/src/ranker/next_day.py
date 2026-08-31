"""Article selection: interests-only, or yesterday continuity + trending until interests are set."""

from __future__ import annotations

from src.extractors.embedding import embed_query, embed_text
from src.models.profile import UserProfile, topic_tokens_from_text


def _normalized_interests(profile: UserProfile) -> list[str]:
    raw = getattr(profile, "interests", None) or []
    return list(
        dict.fromkeys(
            str(item).strip()
            for item in raw
            if item and str(item).strip()
        )
    )


def build_next_day_query_text(profile: UserProfile) -> str:
    """Text embedded for ranking.

    Interests set → rank by those interests only.
    Interests empty → yesterday's theme + today's trending tech (until user fills interests).
    """
    interests = _normalized_interests(profile)
    if interests:
        return (
            "User learning interests (match articles to these topics only): "
            + ", ".join(interests[:12])
        )

    path = profile.learning_path
    parts: list[str] = []

    if path.last_digest_headline:
        parts.append(f"Yesterday's briefing: {path.last_digest_headline}")
    if path.last_digest_tldr:
        parts.append("Yesterday TL;DR: " + "; ".join(path.last_digest_tldr[:4]))
    if path.last_digest_takeaways:
        parts.append(
            "Yesterday takeaways: " + "; ".join(path.last_digest_takeaways[:4])
        )

    continuity = continuity_scrape_terms(profile)
    if continuity:
        parts.append(
            "Continue the same learning themes with the next technical step: "
            + ", ".join(continuity[:8])
        )

    parts.append(
        "Also include today's trending software engineering tutorials "
        "from developer blogs: programming, frameworks, cloud, databases, AI/ML"
    )

    return "\n".join(parts).strip()


def digest_embedding_text(
    *,
    headline: str,
    tldr: list[str],
    takeaways: list[str],
    section_snippets: list[str] | None = None,
) -> str:
    """Build the text blob embedded and stored as yesterday's digest vector."""
    parts: list[str] = []
    if headline.strip():
        parts.append(headline.strip())
    parts.extend(item.strip() for item in tldr if item and str(item).strip())
    parts.extend(item.strip() for item in takeaways if item and str(item).strip())
    for snippet in section_snippets or []:
        cleaned = str(snippet or "").strip()
        if cleaned:
            parts.append(cleaned[:800])
    return "\n".join(parts).strip()


def embed_and_store_digest(
    profile: UserProfile,
    *,
    headline: str,
    tldr: list[str],
    takeaways: list[str],
    section_snippets: list[str] | None = None,
) -> list[float]:
    """Embed today's digest and store it for tomorrow's continuity query."""
    text = digest_embedding_text(
        headline=headline,
        tldr=tldr,
        takeaways=takeaways,
        section_snippets=section_snippets,
    )
    vector = embed_text(text, task_type="retrieval_document") if text else []
    if vector:
        profile.learning_path.last_digest_embedding = vector
    return list(vector)


def refresh_profile_embedding(profile: UserProfile) -> list[float]:
    """Rank query = embed(interests) or continuity+trending query."""
    query = build_next_day_query_text(profile)
    vector = embed_query(query)
    if vector:
        profile.profile_embedding = vector
        return vector

    previous = list(profile.learning_path.last_digest_embedding or [])
    if previous:
        profile.profile_embedding = previous
        return previous
    return list(profile.profile_embedding or [])


def profile_has_interests(profile: UserProfile) -> bool:
    """True when the user interests field is filled."""
    return bool(_normalized_interests(profile))


def profile_has_discovery_prefs(profile: UserProfile) -> bool:
    """Alias: discovery is driven by the interests field only."""
    return profile_has_interests(profile)


def interest_scrape_terms(profile: UserProfile) -> list[str]:
    """Dev.to / match tags = user interests field only (never stack / pace / yesterday)."""
    ordered: list[str] = []
    for item in _normalized_interests(profile):
        term = str(item or "").strip().lower()
        if _is_devto_safe_tag(term):
            ordered.append(term)
    return list(dict.fromkeys(ordered))[:8]


def continuity_scrape_terms(profile: UserProfile) -> list[str]:
    """Yesterday's tech theme tags for users without interests (until they fill interests)."""
    if profile_has_interests(profile):
        return []

    path = profile.learning_path
    candidates: list[str] = []

    active = str(getattr(path, "active_stack", "") or "").strip()
    if active:
        candidates.append(active)

    for topic in getattr(path, "last_topics", None) or []:
        text = str(topic or "").strip()
        if text:
            candidates.extend(topic_tokens_from_text(text))
            candidates.append(text)

    headline = str(getattr(path, "last_digest_headline", "") or "").strip()
    if headline:
        candidates.extend(topic_tokens_from_text(headline))

    for item in getattr(path, "last_digest_tldr", None) or []:
        text = str(item or "").strip()
        if text:
            candidates.extend(topic_tokens_from_text(text))

    ordered: list[str] = []
    for item in candidates:
        term = str(item or "").strip().lower()
        if _is_devto_safe_tag(term):
            ordered.append(term)
    return list(dict.fromkeys(ordered))[:6]


def _is_devto_safe_tag(term: str) -> bool:
    """Dev.to tags are short slugs — not article titles."""
    t = term.strip().lower()
    if not t or len(t) > 32:
        return False
    if any(ch in t for ch in ":()[]{}\"'"):
        return False
    if len(t.split()) > 3:
        return False
    return True
