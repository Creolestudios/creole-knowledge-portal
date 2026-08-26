"""Next-day article selection from embeddings + user interests + quiz score."""

from __future__ import annotations

from src.extractors.embedding import embed_query
from src.models.profile import UserProfile, next_scrape_pace, ScrapePace


def build_next_day_query_text(profile: UserProfile) -> str:
    """Text to embed for semantic next-day article search.

    Uses user_id profile interests/stack, last digest continuity, and quiz pace.
    """
    path = profile.learning_path
    pace = next_scrape_pace(profile)
    parts: list[str] = []

    stack = [
        *(profile.primary_tech_stack or []),
        *(profile.interests or []),
        *(profile.secondary_tech_stack or []),
    ]
    stack = [t.strip() for t in stack if t and str(t).strip()]
    if stack:
        parts.append("User tech focus: " + ", ".join(stack[:12]))
    if profile.current_role:
        parts.append(f"Role: {profile.current_role}")

    if path.last_digest_headline:
        parts.append(f"Yesterday's briefing: {path.last_digest_headline}")
    if path.last_digest_tldr:
        parts.append("Yesterday TL;DR: " + "; ".join(path.last_digest_tldr[:4]))
    if path.last_topics:
        parts.append("Recent themes: " + ", ".join(path.last_topics[:8]))
    if path.active_stack:
        parts.append(f"Active stack run: {path.active_stack}")

    # Quiz score steers difficulty of the query (not weak/next-step topic lists)
    pct = path.last_quiz_percentage
    attempt = path.last_quiz_attempt_number
    outcome = path.last_quiz_outcome.value if path.last_quiz_outcome else "unknown"
    parts.append(
        f"Quiz result: {outcome}; score={path.last_quiz_score}/{path.last_quiz_total}; "
        f"percentage={pct}; attempt={attempt}"
    )

    if pace is ScrapePace.REMEDIAL:
        parts.append(
            "Need simpler remedial articles that re-explain the same themes clearly."
        )
    elif pace is ScrapePace.SIMPLER:
        parts.append(
            "Need even simpler beginner-friendly articles on the same themes."
        )
    elif pace is ScrapePace.SIMPLEST:
        parts.append(
            "Need the clearest beginner explanations of the same themes; "
            "step-by-step, minimal jargon."
        )
    elif pace is ScrapePace.ADVANCE_HARD:
        parts.append(
            "Need advanced production-level follow-on articles continuing the series."
        )
    elif pace is ScrapePace.ADVANCE:
        parts.append(
            "Need the next important article continuing the series at normal-to-deeper depth."
        )
    else:
        parts.append(
            "Need the next important technical article continuing the learning series."
        )

    text = "\n".join(parts).strip()
    if not text:
        return "software engineering technical morning briefing"
    return text


def refresh_profile_embedding(profile: UserProfile) -> list[float]:
    """Embed the next-day query and store it on the profile document (in memory)."""
    query = build_next_day_query_text(profile)
    vector = embed_query(query)
    if vector:
        profile.profile_embedding = vector
    return list(profile.profile_embedding or [])


def profile_has_discovery_prefs(profile: UserProfile) -> bool:
    """True when admin/user prefs or learning continuity can steer scrape tags."""
    path = profile.learning_path
    return bool(
        (profile.primary_tech_stack or [])
        or (profile.secondary_tech_stack or [])
        or (profile.interests or [])
        or (path.last_topics or [])
        or (path.active_stack or "").strip()
    )


def interest_scrape_terms(profile: UserProfile) -> list[str]:
    """Keyword terms for discovery scrape: interests/stack + continuity + pace hints.

    Empty admin prefs → [] so the scraper pulls that day's latest (untagged) posts
    instead of inventing default tags.
    """
    path = profile.learning_path
    pace = next_scrape_pace(profile)
    ordered: list[str] = []

    for item in [
        *(profile.primary_tech_stack or []),
        *(profile.interests or []),
        *(profile.secondary_tech_stack or []),
        *(path.last_topics or []),
        path.active_stack or "",
    ]:
        term = str(item or "").strip().lower()
        if term:
            ordered.append(term)

    if not ordered:
        return []

    if pace in {ScrapePace.REMEDIAL, ScrapePace.SIMPLER, ScrapePace.SIMPLEST}:
        ordered.extend(["basics", "fundamentals", "explained", "beginners"])
    elif pace is ScrapePace.ADVANCE_HARD:
        ordered.extend(["advanced", "production", "architecture"])

    # Dedupe preserve order
    return list(dict.fromkeys(t for t in ordered if t))[:8]
