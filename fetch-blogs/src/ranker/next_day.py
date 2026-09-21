"""Article selection: interests (with continuity when returning); else stack curriculum."""

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


def _normalized_stacks(profile: UserProfile) -> list[str]:
    raw = [
        *(getattr(profile, "primary_tech_stack", None) or []),
        *(getattr(profile, "secondary_tech_stack", None) or []),
    ]
    return list(
        dict.fromkeys(
            str(item).strip()
            for item in raw
            if item and str(item).strip()
        )
    )


def _devto_tags_from_values(values: list[str]) -> list[str]:
    """Turn profile strings into Dev.to-safe tags without inventing extra topics."""
    ordered: list[str] = []
    for item in values:
        term = str(item or "").strip().lower()
        if not term:
            continue
        candidates = [
            term,
            term.replace(".", "").replace(" ", "-"),
            term.replace(".", "").replace(" ", ""),
        ]
        for candidate in candidates:
            if _is_devto_safe_tag(candidate):
                ordered.append(candidate)
        for token in topic_tokens_from_text(item):
            if _is_devto_safe_tag(token):
                ordered.append(token)
    return list(dict.fromkeys(ordered))[:8]


def profile_has_yesterday(profile: UserProfile) -> bool:
    """True when this is not a first briefing (returning learner)."""
    path = getattr(profile, "learning_path", None)
    if path is None:
        return False
    if getattr(path, "last_digest_embedding", None):
        return True
    if str(getattr(path, "last_digest_headline", "") or "").strip():
        return True
    if getattr(path, "last_digest_date", None) is not None:
        return True
    if getattr(path, "last_topics", None):
        return True
    return False


def quiz_focus_terms(profile: UserProfile) -> list[str]:
    """Dev.to-safe tags from the last quiz: weak topics on fail, next-step on pass."""
    from src.models.profile import ScrapePace, next_scrape_pace

    path = profile.learning_path
    pace = next_scrape_pace(profile)
    if pace in {ScrapePace.REMEDIAL, ScrapePace.SIMPLER, ScrapePace.SIMPLEST}:
        values = list(path.weak_topics or [])
    elif pace in {ScrapePace.ADVANCE, ScrapePace.ADVANCE_HARD}:
        values = list(path.next_step_topics or []) or list(path.last_topics or [])
    else:
        values = []
    return _devto_tags_from_values(values)


def continuing_interest_run(profile: UserProfile) -> bool:
    """Returning learner with an interest list — same continuity idea as stack runs."""
    return profile_has_interests(profile) and profile_has_yesterday(profile)


def interest_base_tokens(profile: UserProfile) -> list[str]:
    """Compact interest tokens used for hard matching (never generic trending)."""
    interests = _normalized_interests(profile)
    if not interests:
        return []
    tags = interest_scrape_terms(profile)
    tokens: list[str] = []
    for item in interests:
        lower_item = str(item).lower()
        for tok in topic_tokens_from_text(item):
            tokens.append(tok)
            plural = f"{tok}s"
            if plural in lower_item or plural in lower_item.replace(".", ""):
                tokens.append(plural)
    short = [
        str(item).strip()
        for item in interests
        if 0 < len(str(item).split()) <= 3 and len(str(item).strip()) <= 40
    ]
    ordered = list(dict.fromkeys([*tags, *tokens, *short]))
    compact: list[str] = []
    for term in ordered:
        raw_term = str(term).strip().lower()
        parts = raw_term.replace("-", " ").split()
        if len(parts) >= 5:
            continue
        if any(
            w in {"want", "learn", "about", "how", "to", "the", "a", "an"}
            for w in parts
        ) and len(parts) >= 3:
            continue
        if any(
            glue in raw_term
            for glue in ("wantto", "learnto", "howto", "learnabout", "want-to", "learn-about")
        ):
            continue
        compact.append(term)
    return (compact or ordered or interests)[:12]


def uncovered_interest_topics(profile: UserProfile) -> list[str]:
    """Interest subtopics not yet recorded on the current interest run."""
    if not profile_has_interests(profile):
        return []
    covered = {
        canonicalize_topic(item)
        for item in (getattr(profile.learning_path, "stack_run_covered", None) or [])
        if item and str(item).strip()
    }
    return [
        topic
        for topic in interest_base_tokens(profile)
        if canonicalize_topic(topic) not in covered
    ][:4]


def _append_continuity_briefing_parts(parts: list[str], profile: UserProfile, path) -> None:
    """Shared 'yesterday headline / themes / quiz pace / quiz focus' section for a returning-user briefing."""
    headline = str(path.last_digest_headline or "").strip()
    if headline:
        parts.append(f"Yesterday headline: {headline}")
    topics = [str(t).strip() for t in (path.last_topics or []) if str(t).strip()]
    if topics:
        parts.append("Yesterday themes: " + ", ".join(topics[:8]))
    from src.models.profile import next_scrape_pace

    pace = next_scrape_pace(profile)
    parts.append(f"Quiz pace: {pace.value}")
    quiz_terms = quiz_focus_terms(profile)
    if quiz_terms:
        parts.append("Quiz focus topics: " + ", ".join(quiz_terms[:8]))


def build_next_day_query_text(profile: UserProfile) -> str:
    """Text embedded for ranking when we cannot reuse yesterday's digest vector.

    Interests + returning → continue yesterday inside the interest list + quiz.
    Interests + new → those interests only (never generic trending).
    No interests + returning on the same stack → continue yesterday, steered by quiz.
    No interests + stack just rotated → trending tutorials for the new stack.
    No interests + new join → today's trending tutorials for the active stack.
    """
    interests = _normalized_interests(profile)
    if interests:
        if continuing_interest_run(profile):
            path = profile.learning_path
            parts = [
                "Continue yesterday's learning briefing for a returning user.",
                "Stay inside these interests only (reject off-interest posts): "
                + ", ".join(interests[:12]),
            ]
            _append_continuity_briefing_parts(parts, profile, path)
            uncovered = uncovered_interest_topics(profile)
            if uncovered:
                parts.append("Still uncovered in these interests: " + ", ".join(uncovered[:8]))
            return " ".join(parts)
        return (
            "User learning interests (match articles to these topics only): "
            + ", ".join(interests[:12])
        )

    if continuing_same_stack_run(profile):
        path = profile.learning_path
        parts = [
            "Continue yesterday's learning briefing for a returning user with no interest list.",
            "Stay on the SAME stack family until every topic in that stack is covered.",
            "Match the next tutorial on this stack (not a new random language).",
        ]
        _append_continuity_briefing_parts(parts, profile, path)
        uncovered = uncovered_stack_topics(profile)
        if uncovered:
            parts.append("Still uncovered in this stack: " + ", ".join(uncovered[:8]))
        parts.append(
            "Reject consumer hardware, product launches, and topics outside "
            "this stack family."
        )
        return " ".join(parts)

    from src.models.profile import resolve_active_stack

    active = resolve_active_stack(profile)
    stacks = [active] if active else _normalized_stacks(profile)
    if stacks:
        extra = uncovered_stack_topics(profile)
        labels = list(dict.fromkeys([*stacks, *extra]))[:12]
        return (
            "User tech stack (match today's trending tutorials to these stacks only): "
            + ", ".join(labels)
            + ". Prefer recent how-tos, APIs, debugging, and architecture posts "
            "for this stack. Reject consumer hardware, product launches, "
            "and any topic outside this stack."
        )

    return (
        "Today's trending software engineering tutorials from developer blogs"
    )


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
    """Rank query embedding.

    Returning interest or stack run → reuse yesterday's digest embedding.
    New interest join → embed interests only.
    New stack join or rotation → embed tech-stack trending.
    """
    previous = list(getattr(profile.learning_path, "last_digest_embedding", None) or [])
    if continuing_interest_run(profile) and previous:
        profile.profile_embedding = previous
        return previous
    if continuing_same_stack_run(profile) and previous:
        profile.profile_embedding = previous
        return previous

    query = build_next_day_query_text(profile)
    vector = embed_query(query)
    if vector:
        profile.profile_embedding = vector
        return vector

    if previous:
        profile.profile_embedding = previous
        return previous
    return list(profile.profile_embedding or [])


def profile_has_interests(profile: UserProfile) -> bool:
    """True when the user interests field is filled."""
    return bool(_normalized_interests(profile))


def profile_has_stacks(profile: UserProfile) -> bool:
    """True when primary or secondary tech stack is filled."""
    return bool(_normalized_stacks(profile))


def profile_has_discovery_prefs(profile: UserProfile) -> bool:
    """Discovery is driven by interests, else by tech stack."""
    return profile_has_interests(profile) or profile_has_stacks(profile)


def interest_scrape_terms(profile: UserProfile) -> list[str]:
    """Dev.to tags from the interests field only."""
    return _devto_tags_from_values(_normalized_interests(profile))


def stack_scrape_terms(profile: UserProfile) -> list[str]:
    """Dev.to tags for the *active* stack family — used when interests are empty."""
    if profile_has_interests(profile):
        return []
    from src.models.profile import resolve_active_stack

    active = resolve_active_stack(profile)
    values = [active] if active else _normalized_stacks(profile)
    values.extend(uncovered_stack_topics(profile)[:6])
    return _devto_tags_from_values(values)


def _continuity_raw_terms(profile: UserProfile) -> list[str]:
    """Yesterday headline/topics/TLDR + quiz focus — shared by stack and interest runs."""
    path = profile.learning_path
    raw: list[str] = []
    raw.extend(str(t).strip() for t in (path.last_topics or []) if str(t).strip())
    raw.extend(quiz_focus_terms(profile))
    headline = str(path.last_digest_headline or "").strip()
    if headline:
        raw.extend(topic_tokens_from_text(headline))
        raw.append(headline)
    for item in path.last_digest_tldr or []:
        raw.extend(topic_tokens_from_text(str(item)))
    for item in path.last_digest_takeaways or []:
        raw.extend(topic_tokens_from_text(str(item)))
    return raw


def continuity_match_terms(profile: UserProfile) -> list[str]:
    """Hard filter for returning users: yesterday's theme + quiz, not the whole profile.

    Interest users: same continuity signal, but terms must stay inside the interest list.
    """
    if not profile_has_yesterday(profile):
        return []

    path = profile.learning_path
    raw = _continuity_raw_terms(profile)
    interest_allowed = (
        {t.lower() for t in interest_base_tokens(profile)}
        if profile_has_interests(profile)
        else set()
    )

    ordered: list[str] = []
    for item in raw:
        term = str(item or "").strip()
        if not term:
            continue
        lower = term.lower()
        if lower in ordered:
            continue
        if profile_has_interests(profile):
            term_tokens = {t.lower() for t in topic_tokens_from_text(term)} | {lower}
            yesterday_tokens = set(yesterday_theme_tokens(profile))
            quiz_tokens = {t.lower() for t in quiz_focus_terms(profile)}
            if not (
                term_tokens & interest_allowed
                or term_tokens & yesterday_tokens
                or lower in quiz_tokens
            ):
                continue
        if topic_tokens_from_text(term) or lower in {t.lower() for t in (path.last_topics or [])}:
            ordered.append(term)
        elif _is_devto_safe_tag(lower) and lower in {
            *(quiz_focus_terms(profile)),
            *(_yesterday_scrape_tokens(profile)),
        }:
            ordered.append(term)
    specific = [t for t in ordered if t.lower() not in {"ai", "api"}]
    return (specific or ordered)[:12]


def _headline_and_tldr_tokens(path) -> list[str]:
    """Tokenized candidates from yesterday's headline + TL;DR (shared by both scrape-term paths)."""
    candidates: list[str] = []
    headline = str(getattr(path, "last_digest_headline", "") or "").strip()
    if headline:
        candidates.extend(topic_tokens_from_text(headline))
    for item in getattr(path, "last_digest_tldr", None) or []:
        text = str(item or "").strip()
        if text:
            candidates.extend(topic_tokens_from_text(text))
    return candidates


def _dedup_devto_safe_tags(candidates: list[str], limit: int = 6) -> list[str]:
    ordered: list[str] = []
    for item in candidates:
        term = str(item or "").strip().lower()
        if _is_devto_safe_tag(term):
            ordered.append(term)
    return list(dict.fromkeys(ordered))[:limit]


def _yesterday_scrape_tokens(profile: UserProfile) -> list[str]:
    """Dev.to-safe tags extracted from yesterday's briefing (no stack filter)."""
    path = profile.learning_path
    candidates: list[str] = []
    for topic in getattr(path, "last_topics", None) or []:
        text = str(topic or "").strip()
        if text:
            candidates.extend(topic_tokens_from_text(text))
            candidates.append(text)
    candidates.extend(_headline_and_tldr_tokens(path))
    return _dedup_devto_safe_tags(candidates)


def discovery_scrape_terms(profile: UserProfile) -> list[str]:
    """Tags to fetch: interest-only (day 1) or yesterday+quiz (same shape as stack); else stack."""
    if profile_has_interests(profile):
        if continuing_interest_run(profile):
            # Same order as non-interest returning: yesterday → quiz → uncovered.
            # Interests remain the hard lane via discovery_match_terms / off-interest filter.
            ordered = [
                *continuity_scrape_terms(profile),
                *quiz_focus_terms(profile),
                *uncovered_interest_topics(profile),
            ]
            unique = list(dict.fromkeys(t for t in ordered if t))
            if unique:
                return unique[:8]
            return interest_scrape_terms(profile)
        return interest_scrape_terms(profile)
    if continuing_same_stack_run(profile):
        ordered = [
            *continuity_scrape_terms(profile),
            *quiz_focus_terms(profile),
            *uncovered_stack_topics(profile),
        ]
        unique = list(dict.fromkeys(t for t in ordered if t))
        if unique:
            return unique[:8]
    return stack_scrape_terms(profile)


def discovery_match_terms(profile: UserProfile) -> list[str]:
    """Hard filter: interests day 1; returning = yesterday+quiz (same as stack), inside interests."""
    if profile_has_interests(profile):
        base = interest_base_tokens(profile)
        if continuing_interest_run(profile):
            focused = continuity_match_terms(profile)
            next_topics = uncovered_interest_topics(profile)[:4]
            ordered = list(dict.fromkeys([*focused, *next_topics]))
            if ordered:
                return ordered[:12]
            return base[:12]
        return base[:12]

    if continuing_same_stack_run(profile):
        focused = continuity_match_terms(profile)
        next_topics = uncovered_stack_topics(profile)[:4]
        ordered = list(dict.fromkeys([*focused, *next_topics]))
        if ordered:
            return ordered[:12]

    from src.models.profile import resolve_active_stack

    active = resolve_active_stack(profile)
    fam = family_for_stack_name(active) if active else _family_for_tokens(
        yesterday_theme_tokens(profile)
    )
    if fam:
        return list(fam)
    return _normalized_stacks(profile)


def continuity_scrape_terms(profile: UserProfile) -> list[str]:
    """Yesterday's tech themes for returning users (interest-scoped when interests are set)."""
    if not profile_has_yesterday(profile):
        return []
    if profile_has_interests(profile):
        return _yesterday_scrape_tokens(profile)

    path = profile.learning_path
    allowed = set(_normalized_stacks(profile))
    candidates: list[str] = []

    active = str(getattr(path, "active_stack", "") or "").strip().lower()
    if active and (active in allowed or topic_tokens_from_text(active)):
        candidates.append(active)

    for topic in getattr(path, "last_topics", None) or []:
        text = str(topic or "").strip()
        if text:
            candidates.extend(topic_tokens_from_text(text))
            if text.lower() in allowed or topic_tokens_from_text(text):
                candidates.append(text)

    candidates.extend(_headline_and_tldr_tokens(path))
    return _dedup_devto_safe_tags(candidates)


def hay_is_off_interest_continuity(haystack: str, profile: UserProfile) -> bool:
    """True when text is outside the user's interest list (never generic/off-interest)."""
    if not profile_has_interests(profile):
        return False
    from src.extractors.topic_filter import matches_any_term

    return not matches_any_term(haystack, interest_base_tokens(profile))


_STACK_FAMILIES: tuple[frozenset[str], ...] = (
    frozenset(
        {
            "python",
            "django",
            "flask",
            "fastapi",
            "asyncio",
            "celery",
            "pytorch",
            "pandas",
            "numpy",
            "chunk",
            "chunks",
            "chunking",
            "langchain",
            "rag",
            "embedding",
            "embeddings",
        }
    ),
    frozenset({"react", "reactjs", "nextjs", "next.js", "redux", "jsx", "remix", "hooks"}),
    frozenset({"flutter", "dart"}),
    frozenset({"vue", "nuxt", "vuejs"}),
    frozenset({"angular"}),
    frozenset({"go", "golang"}),
    frozenset({"rust"}),
    frozenset({"java", "spring"}),
    frozenset({"swift", "swiftui", "uikit"}),
    frozenset({"kotlin", "android"}),
)


def _family_for_tokens(tokens: list[str]) -> frozenset[str] | None:
    lowered = {str(t).strip().lower() for t in tokens if str(t).strip()}
    for family in _STACK_FAMILIES:
        if lowered & family:
            return family
    return None


def yesterday_theme_tokens(profile: UserProfile) -> list[str]:
    """Tech tokens that define yesterday's briefing family."""
    path = getattr(profile, "learning_path", None)
    if path is None:
        return []
    raw: list[str] = []
    for item in getattr(path, "last_topics", None) or []:
        raw.append(str(item))
        raw.extend(topic_tokens_from_text(str(item)))
    headline = str(getattr(path, "last_digest_headline", "") or "")
    raw.extend(topic_tokens_from_text(headline))
    for item in getattr(path, "last_digest_tldr", None) or []:
        raw.extend(topic_tokens_from_text(str(item)))
    return list(dict.fromkeys(t.lower() for t in raw if str(t).strip()))


_TOPIC_ALIASES: dict[str, str] = {
    "chunk": "chunking",
    "chunks": "chunking",
    "embedding": "embeddings",
    "reactjs": "react",
    "next.js": "nextjs",
    "vuejs": "vue",
    "golang": "go",
}


def canonicalize_topic(term: str) -> str:
    """Collapse aliases so one lesson (chunk/chunks/chunking) is one covered topic."""
    t = str(term or "").strip().lower()
    return _TOPIC_ALIASES.get(t, t)


def family_for_stack_name(name: str) -> frozenset[str] | None:
    """Language/framework family for a stack label (python vs react vs flutter)."""
    return _family_for_tokens([name])


def continuing_same_stack_run(profile: UserProfile) -> bool:
    """True when yesterday's briefing is still the active stack (run not rotated)."""
    if profile_has_interests(profile) or not profile_has_yesterday(profile):
        return False
    from src.models.profile import resolve_active_stack

    active = resolve_active_stack(profile)
    y_fam = _family_for_tokens(yesterday_theme_tokens(profile))
    a_fam = _family_for_tokens([active]) if active else None
    if y_fam is None or a_fam is None:
        return True
    return y_fam == a_fam


def stack_curriculum_topics(profile: UserProfile) -> list[str]:
    """Topics that must be taught before leaving the active stack.

    If the profile lists several items in this family (python, django, fastapi),
    those items are the curriculum. If it only lists the language (python) plus
    other families (react), every other topic in the python family must be covered.
    """
    from src.models.profile import resolve_active_stack

    active = canonicalize_topic(resolve_active_stack(profile))
    family = _family_for_tokens([active]) if active else None
    if family is None:
        return []
    canon_family = {canonicalize_topic(item) for item in family}
    profile_in_family: list[str] = []
    for item in _normalized_stacks(profile):
        token = canonicalize_topic(item)
        if _family_for_tokens([item]) == family:
            profile_in_family.append(token)
    profile_in_family = list(dict.fromkeys(profile_in_family))
    specific = [token for token in profile_in_family if token != active]
    if specific:
        return specific
    return sorted(token for token in canon_family if token != active)


def uncovered_stack_topics(profile: UserProfile) -> list[str]:
    """Curriculum topics not yet recorded on this stack run."""
    covered = {
        canonicalize_topic(item)
        for item in (getattr(profile.learning_path, "stack_run_covered", None) or [])
        if item and str(item).strip()
    }
    return [topic for topic in stack_curriculum_topics(profile) if topic not in covered]


def hay_is_off_yesterday_family(haystack: str, profile: UserProfile) -> bool:
    """True when the text is a different language/stack than the *active* run."""
    if profile_has_interests(profile):
        return False
    from src.models.profile import resolve_active_stack

    active = resolve_active_stack(profile)
    tokens = [active] if active else yesterday_theme_tokens(profile)
    y_fam = _family_for_tokens(tokens)
    if y_fam is None:
        y_fam = _family_for_tokens(yesterday_theme_tokens(profile))
    if y_fam is None:
        return False
    a_tokens = topic_tokens_from_text(haystack)
    a_fam = _family_for_tokens(a_tokens)
    if a_fam is None or a_fam == y_fam:
        return False
    if set(a_tokens) & y_fam:
        return False
    return True


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
