"""Gemini digest synthesis for ranked Beanie articles."""

from __future__ import annotations

import json
import re
import time
from datetime import UTC, date, datetime
from typing import Any

import structlog

from src.core.config import get_llm_settings, get_scraping_settings
from src.extractors.topic_filter import is_non_learning
from src.models.article import Article
from src.models.digest import (
    DailyDigest,
    DigestContent,
    DigestMetrics,
    DigestSection,
    DigestSource,
)
from src.models.profile import (
    UserProfile,
    next_scrape_pace,
    pace_teaching_instructions,
    resolve_active_stack,
    scrape_focus_terms,
    topic_tokens_from_text,
)

log = structlog.get_logger(__name__)

# Fewer words, same 18–20 min estimate (3200/180≈18, 3600/180=20).
_WPM = 180
_MIN_READ_MINUTES = 18
_MAX_READ_MINUTES = 20
_WORD_FLOOR = 3200
_WORD_CEILING = 3600
_ARTICLE_LIMIT = 10
_TEACHING_ARTICLE_LIMIT = 1
_INTEREST_TEACHING_ARTICLE_LIMIT = 4
_INTEREST_THIN_SOURCE_WORDS = 1800
# Never paste entire source blogs into the digest — short technical excerpts only.
_SCRAPE_EXCERPT_WORDS = 140
_SCRAPE_EXCERPT_TOTAL = 700
_SCRAPE_EXCERPT_ARTICLES = 1
_INTEREST_SCRAPE_EXCERPT_TOTAL = 1600
_INTEREST_SCRAPE_EXCERPT_WORDS = 220


def _min_words() -> int:
    """Lower bound: config target, floored at 3200 (~18 min at _WPM)."""
    return max(get_scraping_settings().DIGEST_WORD_TARGET, _WORD_FLOOR)


def _max_words() -> int:
    """Upper bound: keep digests in the 3200–3600 band."""
    return _WORD_CEILING


def _words_in(sections: list[dict[str, Any]]) -> int:
    return len(" ".join(str(section.get("content") or "") for section in sections).split())


def _article_body_word_count(article: Article) -> int:
    body = (article.body_text or article.summary or "").strip()
    return len(body.split())


def _cluster_source_words(articles: list[Article]) -> int:
    return sum(_article_body_word_count(article) for article in articles)


def _teaching_article_limit(profile: UserProfile) -> int:
    """Interest learners may teach from several similar posts when one source is thin."""
    from src.ranker.next_day import profile_has_interests

    if profile_has_interests(profile):
        return _INTEREST_TEACHING_ARTICLE_LIMIT
    return _TEACHING_ARTICLE_LIMIT


def _interest_needs_similar_sources(profile: UserProfile, cluster: list[Article]) -> bool:
    from src.ranker.next_day import profile_has_interests

    if not profile_has_interests(profile) or not cluster:
        return False
    return _cluster_source_words(cluster[:1]) < _INTEREST_THIN_SOURCE_WORDS


def _scrape_excerpt_limits(
    profile: UserProfile,
    cluster: list[Article],
    *,
    teaching_failed: bool = False,
) -> tuple[int, int, int]:
    """Return (total_words, per_article_words, article_count) for opening excerpts."""
    from src.ranker.next_day import profile_has_interests

    if profile_has_interests(profile) and cluster:
        if _interest_needs_similar_sources(profile, cluster) or teaching_failed or len(cluster) >= 2:
            return (
                _INTEREST_SCRAPE_EXCERPT_TOTAL,
                _INTEREST_SCRAPE_EXCERPT_WORDS,
                min(len(cluster), _INTEREST_TEACHING_ARTICLE_LIMIT),
            )
        return (_SCRAPE_EXCERPT_TOTAL, _SCRAPE_EXCERPT_WORDS, min(len(cluster), 2))
    return (_SCRAPE_EXCERPT_TOTAL, _SCRAPE_EXCERPT_WORDS, _SCRAPE_EXCERPT_ARTICLES)


def _section(
    title: str,
    content: str,
    sources_cited: list[int],
) -> dict[str, Any]:
    word_count = len(content.split())
    return {
        "title": title,
        "content": content,
        "sources_cited": sources_cited,
        "estimated_read_minutes": round(max(1.0, word_count / _WPM), 1),
    }


_CANONICAL_H2 = re.compile(
    r"^##\s+(Daily Overview|Briefing|Brief|Code Snippet|Key Action|"
    r"Overview\s*/\s*Summary|Overview|Summary|"
    r"Going deeper|Continuation from yesterday|Why this matters today|"
    r"Today's curated reading)\s*$",
    re.IGNORECASE | re.MULTILINE,
)
_TITLE_STOP = frozenset(
    {
        "the",
        "a",
        "an",
        "of",
        "with",
        "for",
        "and",
        "to",
        "in",
        "on",
        "by",
        "from",
        "into",
        "your",
        "this",
        "that",
        "using",
        "use",
        "how",
        "what",
        "why",
        "when",
        "over",
        "about",
        "after",
        "before",
        "between",
        "without",
        "within",
        "text",
        "word",
        "data",
        "code",
        "file",
        "type",
        "into",
        "that",
        "this",
    }
)
_FENCE_RE = re.compile(r"```[\w+-]*\n.*?```", flags=re.DOTALL)


def _iter_markdown_chunks(content: str) -> list[str]:
    """Yield prose and fenced blocks in document order (never split inside a fence)."""
    text = content or ""
    chunks: list[str] = []
    cursor = 0
    for match in _FENCE_RE.finditer(text):
        before = text[cursor : match.start()].strip()
        if before:
            chunks.append(before)
        chunks.append(match.group(0).strip())
        cursor = match.end()
    tail = text[cursor:].strip()
    if tail:
        chunks.append(tail)
    return chunks


def _extract_fenced_blocks(content: str) -> tuple[str, list[str]]:
    """Split markdown into prose vs ``` fenced blocks (code/diagrams)."""
    fences: list[str] = []
    prose_parts: list[str] = []
    for chunk in _iter_markdown_chunks(content):
        if chunk.startswith("```"):
            fences.append(chunk)
        else:
            prose_parts.append(chunk)
    return "\n\n".join(prose_parts).strip(), fences


def _normalize_block_text(text: str) -> str:
    """Collapse whitespace for overlap checks."""
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _blocks_substantially_overlap(left: str, right: str, *, min_chars: int = 160) -> bool:
    """True when two bodies repeat the same passage (exact, substring, or long prefix)."""
    a = _normalize_block_text(left)
    b = _normalize_block_text(right)
    if not a or not b:
        return False
    if a == b:
        return True
    shorter, longer = (a, b) if len(a) <= len(b) else (b, a)
    if len(shorter) >= min_chars and shorter in longer:
        return True
    probe = min(len(a), len(b), 400)
    return probe >= min_chars and a[:probe] == b[:probe]


def dedupe_content_blocks(blocks: list[str]) -> list[str]:
    """Drop briefing chunks that repeat text already kept."""
    kept: list[str] = []
    for raw in blocks:
        text = str(raw or "").strip()
        if not text:
            continue
        if any(_blocks_substantially_overlap(text, prior) for prior in kept):
            continue
        kept.append(text)
    return kept


def _split_by_canonical_h2(
    title: str,
    content: str,
    sources_cited: list[Any],
) -> list[dict[str, Any]]:
    """If body already has ## Brief / ## Code / ## Overview, split into sections."""
    text = (content or "").strip()
    if not text or not _CANONICAL_H2.search(text):
        return [
            {
                "title": title,
                "content": text,
                "sources_cited": sources_cited,
            }
        ]

    matches = list(_CANONICAL_H2.finditer(text))
    parts: list[dict[str, Any]] = []
    # Prose before the first canonical H2 keeps the outer section title
    preface = text[: matches[0].start()].strip()
    if preface:
        parts.append({"title": title, "content": preface, "sources_cited": sources_cited})
    for i, match in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[match.end() : end].strip()
        if not body:
            continue
        parts.append(
            {
                "title": match.group(1).strip(),
                "content": body,
                "sources_cited": sources_cited,
            }
        )
    return parts or [{"title": title, "content": text, "sources_cited": sources_cited}]


def _title_keywords(title: str) -> set[str]:
    """Significant words from an article title — used to detect topic drift."""
    words = re.findall(r"[a-zA-Z]{4,}", (title or "").lower())
    return {word for word in words if word not in _TITLE_STOP}


def _tech_terms(text: str, extra: list[str] | None = None) -> set[str]:
    """Tech tokens found in text — from the shared allowlist, not a hardcoded stack map."""
    from src.extractors.topic_filter import infer_topics

    return {
        str(term).strip().lower()
        for term in infer_topics(text or "", extra=extra)
        if term and str(term).strip()
    }


def _terms_conflict(left: set[str], right: set[str]) -> bool:
    """True when both sides named tech topics and they share none."""
    return bool(left and right and left.isdisjoint(right))


def _article_terms(article: Article) -> set[str]:
    extra = [*(article.topics or []), *(article.tech_stack or [])]
    hay = f"{article.title or ''} {article.summary or ''} {(article.body_text or '')[:2000]}"
    return _tech_terms(hay, extra=extra)


def _title_mentioned(title: str, blob: str) -> bool:
    """True when the blob still talks about the headline's tech or title words."""
    from src.extractors.topic_filter import term_matches

    hay = (blob or "").lower()
    if not hay.strip():
        return False
    title_terms = _tech_terms(title)
    if any(term_matches(hay, term) for term in title_terms):
        return True
    keys = {word for word in _title_keywords(title) if len(word) >= 4}
    if not keys:
        return True
    words = set(re.findall(r"[a-z]{4,}", hay))
    for key in keys:
        if key in hay:
            return True
        stem = key[:4]
        if any(word.startswith(stem) or key.startswith(word[:4]) for word in words):
            return True
    return False


def _title_body_consistent(article: Article) -> bool:
    """False when the scraped body is a different tech topic than the title."""
    title = article.title or ""
    body = (article.body_text or article.summary or "")[:2500]
    extra = [*(article.topics or []), *(article.tech_stack or [])]
    if _terms_conflict(_tech_terms(title, extra=extra), _tech_terms(body, extra=extra)):
        return _title_mentioned(title, body)
    return True


def text_matches_headline(text: str, headline: str) -> bool:
    """True when a digest block stays on the headline's tech topics."""
    blob = (text or "").strip()
    title = (headline or "").strip()
    if not blob or not title:
        return True
    extra: list[str] = []
    if blob.startswith("```"):
        lang = blob.split("\n", 1)[0].replace("`", "").strip().lower()
        if lang and _tech_terms(lang):
            extra.append(lang)
    title_terms = _tech_terms(title)
    blob_terms = _tech_terms(blob, extra=extra or None)
    if _terms_conflict(title_terms, blob_terms):
        return _title_mentioned(title, blob)
    return True


def _digest_topic_headline(
    profile: UserProfile | None,
    lead: Article | None,
    *,
    fallback: str = "",
) -> str:
    """Headline used for on-topic filters — widen with interest terms when needed."""
    from src.ranker.next_day import discovery_match_terms, profile_has_interests

    base = (lead.title if lead is not None else "") or fallback or "Morning Briefing"
    if profile is not None and profile_has_interests(profile):
        terms = discovery_match_terms(profile)
        if terms:
            return f"{base} {' '.join(terms[:8])}"
    return base


def _content_matches_source(
    content: str,
    article: Article,
    profile: UserProfile | None = None,
) -> bool:
    """False when generated prose is a different stack/topic than the source title."""
    from src.extractors.topic_filter import matches_any_term
    from src.ranker.next_day import discovery_match_terms, profile_has_interests

    if profile is not None and profile_has_interests(profile):
        terms = discovery_match_terms(profile)
        if terms and matches_any_term(content, terms):
            return True
    return text_matches_headline(content, article.title or "")


def _keep_on_topic_text(text: str, headline: str) -> str:
    """Drop paragraphs that drifted onto a different stack than the headline.

    Fenced code/diagrams are kept whole — blank lines inside a fence must not
    split it into prose fragments that then get dropped.
    """
    raw = (text or "").strip()
    if not raw:
        return ""
    kept: list[str] = []
    for chunk in _iter_markdown_chunks(raw):
        if chunk.startswith("```"):
            if text_matches_headline(chunk, headline):
                kept.append(chunk)
            continue
        for part in re.split(r"\n{2,}", chunk):
            bit = part.strip()
            if bit and text_matches_headline(bit, headline):
                kept.append(bit)
    return "\n\n".join(kept)


def _select_lead_article(
    articles: list[Article],
    profile: UserProfile | None = None,
) -> Article | None:
    """Prefer a source whose body matches its title and the user's stack."""
    from src.extractors.topic_filter import is_non_english_dominant, matches_any_term

    def _english_enough(item: Article) -> bool:
        hay = f"{item.title} {item.summary or ''} {(item.body_text or '')[:2000]}"
        return not is_non_english_dominant(hay)

    usable = [
        item
        for item in articles
        if item.title
        and not _is_junk_title(item.title)
        and _title_body_consistent(item)
        and _english_enough(item)
    ]
    pool = usable or [
        item
        for item in articles
        if item.title and not _is_junk_title(item.title) and _english_enough(item)
    ]
    terms: list[str] = []
    if profile is not None:
        from src.ranker.next_day import (
            discovery_match_terms,
            hay_is_off_yesterday_family,
        )

        terms = discovery_match_terms(profile)
        pool = [
            item
            for item in pool
            if not hay_is_off_yesterday_family(
                f"{item.title} {item.summary or ''} {' '.join(item.topics)}",
                profile,
            )
        ]
    if terms:
        stacked = [
            item
            for item in pool
            if matches_any_term(
                f"{item.title} {item.summary or ''} {' '.join(item.topics)} {' '.join(item.tech_stack)} {(item.body_text or '')[:800]}",
                terms,
            )
        ]
        if stacked:
            return stacked[0]
        return None
    if pool:
        return pool[0]
    return articles[0] if articles else None


def _related_cluster(
    lead: Article | None,
    articles: list[Article],
    *,
    limit: int = 8,
) -> list[Article]:
    """Same language/topic as the headline — used when one post is too thin."""
    if lead is None:
        return []

    def matches(article: Article) -> bool:
        if not article.title or _is_junk_title(article.title):
            return False
        if not _title_body_consistent(article):
            return False
        lead_terms = _article_terms(lead)
        other_terms = _article_terms(article)
        if lead_terms and other_terms:
            return bool(lead_terms & other_terms)
        lead_keys = _title_keywords(lead.title or "")
        other_keys = _title_keywords(article.title or "")
        return bool(lead_keys and other_keys and lead_keys & other_keys)

    cluster: list[Article] = []
    seen: set[str] = set()
    for article in [lead, *articles]:
        url = str(article.url or "").rstrip("/")
        if url and url in seen:
            continue
        if url:
            seen.add(url)
        if not matches(article):
            continue
        cluster.append(article)
        if len(cluster) >= limit:
            break
    return cluster or [lead]


def _short_actions(items: list[Any], article: Article | None) -> list[str]:
    """Key Action must stay as short bullets about THIS article — never a second essay."""
    headline = article.title if article is not None else ""
    out: list[str] = []
    for item in _bullets_for_source(items, article):
        text = re.sub(r"^#+\s+", "", str(item).strip())
        if "\n## " in text or text.lower().startswith("how to use "):
            text = text.split("\n", 1)[0]
        text = _clip_to_words(text, 40)
        if not text:
            continue
        if headline and not text_matches_headline(text, headline):
            continue
        out.append(text)
        if len(out) >= 8:
            break
    return out


def _yesterday_relates_to_article(profile: UserProfile, article: Article) -> bool:
    """True when yesterday's digest is the same topic family as today's source."""
    if not _has_previous_briefing(profile):
        return False
    yesterday = profile.learning_path.last_digest_headline or ""
    today = article.title or ""
    y_terms = _tech_terms(yesterday)
    a_terms = _tech_terms(today)
    if y_terms and a_terms:
        return bool(y_terms & a_terms)
    y_keys = _title_keywords(yesterday)
    a_keys = _title_keywords(today)
    return bool(y_keys and a_keys and y_keys & a_keys)


def _normalize_digest_sections(sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Force every digest into Briefing (prose + fenced code) → Summary."""
    from src.extractors.topic_filter import is_non_english_dominant

    briefing_parts: list[str] = []
    summary_parts: list[str] = []
    cited: list[int] = []

    expanded: list[dict[str, Any]] = []
    for sec in sections:
        title = str(sec.get("title") or "").strip() or "Untitled"
        content = str(sec.get("content") or "").strip()
        if not content:
            continue
        if is_non_english_dominant(content):
            continue
        raw_cited = list(sec.get("sources_cited") or [])
        expanded.extend(_split_by_canonical_h2(title, content, raw_cited))

    for sec in expanded:
        title = str(sec.get("title") or "").strip()
        content = str(sec.get("content") or "").strip()
        if not content:
            continue
        for item in sec.get("sources_cited") or []:
            try:
                cited.append(int(item))
            except (TypeError, ValueError):
                continue

        lower = title.lower()
        is_summary = "summary" in lower or lower.startswith("overview")
        if is_summary:
            prose, fences = _extract_fenced_blocks(content)
            if prose:
                summary_parts.append(prose)
            if fences:
                briefing_parts.extend(fences)
            continue
        briefing_parts.append(content)

    if not briefing_parts and summary_parts:
        briefing_parts.append(summary_parts.pop(0))

    sources_cited = list(dict.fromkeys(cited)) or [1]
    out: list[dict[str, Any]] = []
    if briefing_parts:
        briefing_parts = dedupe_content_blocks(briefing_parts)
        out.append(_section("Briefing", "\n\n".join(briefing_parts), sources_cited))
    if summary_parts:
        summary_parts = dedupe_content_blocks(summary_parts)
        out.append(_section("Summary", "\n\n".join(summary_parts), sources_cited))
    return out or sections


def _clip_to_words(text: str, max_words: int) -> str:
    """Keep the first max_words tokens without flattening newlines or markdown."""
    if max_words <= 0:
        return ""
    if len(text.split()) <= max_words:
        return text.strip()
    count = 0
    parts: list[str] = []
    for token in re.finditer(r"\S+|\s+", text):
        piece = token.group(0)
        if piece.isspace():
            if count:
                parts.append(piece)
            continue
        if count >= max_words:
            break
        parts.append(piece)
        count += 1
    clipped = "".join(parts).rstrip()
    if clipped.count("```") % 2 == 1:
        clipped += "\n```"
    return clipped


_DEVTO_CHROME = (
    "enter fullscreen mode",
    "exit fullscreen mode",
    "report abuse",
    "copy link",
    "like",
    "comment",
    "bookmark",
)
_LIQUID = re.compile(r"\{%.{0,500}%\}", re.DOTALL)
_FRONTMATTER_KEY = re.compile(
    r"^(title|published|description|tags|series|cover_image|canonical_url|date|author|slug|layout|"
    r"cover_image_url|reading_time_minutes|organization_id|crossposted|edited_at|created_at|"
    r"updated_at|published_at|social_image|meta_title|meta_description|subtitle|excerpt|summary|"
    r"headline|locale|lang|language|category|type|url|id|uuid|path|source|source_url|source_domain|"
    r"tag_list|topic|topics|collection_id|body_markdown|body_html|markdown|content|version|revision|"
    r"license|copyright|seo_title|seo_description|seo_keywords|og_image|og_title|og_description|"
    r"twitter_image|twitter_card|twitter_site|twitter_creator|featured|featured_image|image|"
    r"thumbnail|status|visibility|name):",
    re.IGNORECASE,
)


def _strip_blog_frontmatter(text: str) -> str:
    """Remove Dev.to / Hugo YAML headers scraped into article bodies."""
    raw = (text or "").strip()
    if not raw:
        return raw
    if raw.startswith("---"):
        end = raw.find("\n---", 4)
        if end >= 0:
            raw = raw[end + 4 :].lstrip()
    lines = raw.splitlines()
    i = 0
    meta_count = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            if meta_count > 0:
                i += 1
                continue
            break
        if _FRONTMATTER_KEY.match(line):
            meta_count += 1
            i += 1
            continue
        break
    if meta_count >= 2 and i < len(lines):
        return "\n".join(lines[i:]).strip()
    return raw


def _clean_scraped_markdown(text: str) -> str:
    """Drop Dev.to UI chrome, Liquid tags, and YAML frontmatter from scraped bodies."""
    without_liquid = _LIQUID.sub("", text)
    without_frontmatter = _strip_blog_frontmatter(without_liquid)
    kept: list[str] = []
    for line in without_frontmatter.splitlines():
        lowered = line.strip().lower()
        if lowered and lowered in _DEVTO_CHROME:
            continue
        kept.append(line)
    return "\n".join(kept)


def _ensure_readable_markdown(text: str) -> str:
    """Put inlined markdown structure back onto its own lines."""
    cleaned = _clean_scraped_markdown(text.replace("\r\n", "\n").replace("\r", "\n")).strip()
    cleaned = re.sub(r"(?<=[^\n#])(#{1,6} )", r"\n\n\1", cleaned)
    cleaned = re.sub(r"(?<=[^\n`])(```)", r"\n\n\1", cleaned)
    # Flattened directory trees → one branch per line
    if cleaned.count("├──") + cleaned.count("└──") + cleaned.count("+--") >= 2:
        cleaned = re.sub(r"\*\*", "", cleaned)
        cleaned = re.sub(
            r"([^\n])([ \t|]*)(├─{1,2}|└─{1,2}|\+--|\|--)[ \t]*",
            lambda m: f"{m.group(1)}\n{'  ' * min(str(m.group(2)).count('|'), 6)}{m.group(3)} ",
            cleaned,
        )
        # Match only the trailing "/" + spaces: capturing the whole path token
        # (e.g. r"(\S*/)") makes the engine backtrack super-linearly, since "/"
        # is itself part of \S.
        cleaned = re.sub(r"/[ \t]+(?=[├└]─|\+--|\|--)", "/\n", cleaned)
        cleaned = re.sub(r"\|([ \t]*\|)+", "\n", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    if cleaned.count("\n\n") < 2 and cleaned.count("\n") >= 2:
        cleaned = re.sub(r"\n+", "\n\n", cleaned)
    return cleaned


def pick_daily_theme(profile: UserProfile, articles: list[Article]) -> str:
    """Theme hint for teaching — empty when previous embedding already selected sources."""
    path = profile.learning_path
    if path.last_digest_embedding:
        return ""
    focus = scrape_focus_terms(profile)
    if path.last_digest_headline:
        tokens = topic_tokens_from_text(path.last_digest_headline)
        if focus:
            from src.extractors.topic_filter import term_matches

            for token in tokens:
                if any(term_matches(token, term) or term_matches(term, token) for term in focus):
                    return token
            return focus[0]
        if tokens:
            return tokens[0]
    if focus:
        return focus[0]
    blob = " ".join(
        f"{article.title} {' '.join(article.topics)} {' '.join(article.tech_stack)}"
        for article in articles
    )
    found = topic_tokens_from_text(blob)
    if found:
        return found[0]
    if profile.primary_tech_stack:
        return profile.primary_tech_stack[0].strip().lower()
    return "tech"


def focus_articles_on_theme(articles: list[Article], theme: str) -> list[Article]:
    """Prefer articles that mention the selected theme; fall back to the full list."""
    needle = theme.strip().lower()
    if not needle:
        return articles
    matched = [
        article
        for article in articles
        if needle
        in f"{article.title} {article.summary} {article.body_text[:1200]} {' '.join(article.topics)}".lower()
    ]
    return matched or articles


def _fallback_payload() -> dict[str, Any]:
    return {
        "headline": "Your Morning Technical Briefing",
        "tldr": ["Personalized articles were ranked for your stack."],
        "sections": [
            {
                "title": "Today's curated reading",
                "content": (
                    "The ranking pipeline selected the sources below. "
                    "AI synthesis was unavailable, so this is a structured fallback briefing."
                ),
                "sources_cited": [1],
                "estimated_read_minutes": 2.0,
            }
        ],
        "key_takeaways": ["Open the cited sources for the full write-ups."],
        "further_reading": [],
    }


def _source_excerpt_for_teaching(article: Article, *, limit: int = 8000) -> str:
    """Use the scraped body only when it matches the headline's language/stack."""
    raw = (article.body_text or article.summary or "").strip()[:limit]
    if _title_body_consistent(article):
        return raw
    kept = _keep_on_topic_text(raw, article.title or "")
    return kept or (article.title or "")


def _payload_from_articles(
    articles: list[Article],
    *,
    max_total_words: int | None = None,
    max_words_each: int | None = None,
    article_limit: int = _ARTICLE_LIMIT,
) -> dict[str, Any]:
    """Build short technical excerpts from scraped bodies (no full-article dump)."""
    from src.extractors.topic_filter import (
        has_tech_learning_signal,
        is_non_english_dominant,
        is_off_topic_lifestyle,
    )

    sections: list[dict[str, Any]] = []
    tldr: list[str] = []
    takeaways: list[str] = []
    further: list[dict[str, str]] = []
    words_left = max_total_words if max_total_words is not None else _SCRAPE_EXCERPT_TOTAL
    per_article = max_words_each if max_words_each is not None else _SCRAPE_EXCERPT_WORDS

    for index, article in enumerate(articles[:article_limit], start=1):
        title = article.title or ""
        body = (article.body_text or article.summary or "").strip()
        if is_non_english_dominant(f"{title}\n{body[:2000]}"):
            continue
        # Never dump lifestyle / off-interest article bodies into the digest
        if is_off_topic_lifestyle(title, body[:1500]) or not has_tech_learning_signal(
            title, body[:2000], [*article.topics, *article.tech_stack]
        ):
            continue
        if body and not _title_body_consistent(article):
            body = _keep_on_topic_text(body, title)
        if not body:
            body = f"{article.title} was selected for your stack. Read the original: {article.url}"
        tldr.append(article.title)
        takeaways.append(
            f"Skim the source on {article.title} and apply one idea to your stack today."
        )
        further.append({"title": article.title, "url": str(article.url)})
        word_count = len(body.split())
        take_n = min(word_count, per_article, words_left) if words_left > 0 else 0
        if take_n <= 0:
            break
        text = _ensure_readable_markdown(_clip_to_words(body, take_n))
        words_left -= take_n
        sections.append(
            _section(
                "Briefing",
                text,
                [index],
            )
        )

    if not sections:
        return _fallback_payload()
    good_titles = [a.title for a in articles if a.title and not _is_junk_title(a.title)]
    return {
        "headline": good_titles[0] if good_titles else "Morning Briefing",
        "tldr": tldr[:6],
        "sections": sections,
        "key_takeaways": takeaways[:8],
        "further_reading": further,
    }


def _is_junk_title(title: str) -> bool:
    """True for file dumps / binary names that must never be a briefing headline."""
    text = (title or "").strip().lower()
    if not text:
        return True
    if re.search(r"\.(pdf|zip|exe|dmg|tar|gz|rar|7z)\b", text):
        return True
    if text.startswith("next steps after:") and re.search(r"\.(pdf|zip|exe|dmg)\b", text):
        return True
    from src.extractors.topic_filter import is_non_english_dominant

    return is_non_english_dominant(title)


def _is_templated_headline(title: str) -> bool:
    lowered = (title or "").strip().lower()
    if not lowered:
        return True
    if lowered in {
        "morning briefing",
        "your morning briefing",
        "your morning technical briefing",
    }:
        return True
    return "briefing" in lowered and (lowered.startswith("your ") or lowered.startswith("morning "))


def _pick_technical_headline(
    preferred: str,
    articles: list[Article],
    *,
    fallback_theme: str = "software engineering",
) -> str:
    """Prefer a real technical article title — never PDF/binary junk."""
    for candidate in [preferred, *(a.title for a in articles if a.title)]:
        text = str(candidate or "").strip()
        if not text or _is_junk_title(text) or _is_templated_headline(text):
            continue
        if text.lower().startswith("next steps after:"):
            rest = text.split(":", 1)[-1].strip()
            if _is_junk_title(rest):
                continue
        return text[:160]
    theme = (fallback_theme or "software engineering").strip()
    return f"Continuing {theme} learning"[:160]


def _stored_headline(payload: dict[str, Any], articles: list[Article]) -> str:
    """Persist a technical source title — never PDF dumps or morning templates."""
    raw = str(payload.get("headline") or "").strip()
    return _pick_technical_headline(raw, articles)


def _parse_json_object(text: str) -> dict[str, Any]:
    """Parse a JSON object, even if Gemini wraps, fences, or lightly breaks it."""
    stripped = _strip_fences(text).strip()
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start < 0 or end <= start:
        raise json.JSONDecodeError("no json object", text, 0)
    candidate = stripped[start : end + 1]
    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError:
        repaired = _repair_json_text(candidate)
        parsed = json.loads(repaired)
    if not isinstance(parsed, dict):
        raise json.JSONDecodeError("json root is not an object", text, 0)
    return parsed


def _repair_json_text(text: str) -> str:
    """Best-effort fixes for common Gemini JSON glitches."""
    repaired = text
    # Trailing commas before } or ]
    repaired = re.sub(r",(\s*[}\]])", r"\1", repaired)
    # Smart quotes → ASCII
    repaired = (
        repaired.replace("\u201c", '"')
        .replace("\u201d", '"')
        .replace("\u2018", "'")
        .replace("\u2019", "'")
    )
    # Unescaped control chars inside JSON strings → valid escapes
    repaired = _escape_controls_in_json_strings(repaired)
    return repaired


def _escape_controls_in_json_strings(text: str) -> str:
    """Escape raw newlines/tabs/controls that appear inside JSON string values."""
    out: list[str] = []
    in_string = False
    escape = False
    for ch in text:
        if escape:
            out.append(ch)
            escape = False
            continue
        if ch == "\\" and in_string:
            out.append(ch)
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            out.append(ch)
            continue
        if in_string and ord(ch) < 32:
            if ch == "\n":
                out.append("\\n")
            elif ch == "\r":
                out.append("\\r")
            elif ch == "\t":
                out.append("\\t")
            else:
                out.append(" ")
            continue
        out.append(ch)
    return "".join(out)


def _strip_fences(text: str) -> str:
    stripped = text.strip()
    if not stripped.startswith("```"):
        return stripped
    without_open = stripped.split("\n", 1)[-1]
    if without_open.rstrip().endswith("```"):
        without_open = without_open[: without_open.rfind("```")]
    return without_open.strip()


def _trim_sections(sections: list[dict[str, Any]], max_words: int) -> list[dict[str, Any]]:
    kept: list[dict[str, Any]] = []
    used = 0
    for section in sections:
        if used >= max_words:
            break
        raw = str(section.get("content") or "")
        available = max_words - used
        content = _ensure_readable_markdown(_clip_to_words(raw, available))
        if not content:
            break
        kept.append(
            _section(
                str(section.get("title") or "Untitled"),
                content,
                [int(item) for item in section.get("sources_cited") or []],
            )
        )
        used += len(content.split())
    return kept


def _has_previous_briefing(profile: UserProfile) -> bool:
    """True only when a real prior digest exists — not just stack/interests."""
    path = profile.learning_path
    headline = (path.last_digest_headline or "").strip()
    if not headline or _is_junk_title(headline):
        return False
    return True


def _previous_briefing_block(
    profile: UserProfile,
    article: Article | None = None,
) -> str:
    """Format yesterday's digest so today can continue the series.

    New users (no prior digest) get a first-day briefing — never invent a fake yesterday.
    Unrelated yesterday (e.g. Dart) must not leak into a different source article (e.g. Python).
    """
    path = profile.learning_path
    active = resolve_active_stack(profile)
    pace = next_scrape_pace(profile)
    lines = [
        "SOURCE ARTICLE IS THE ONLY TOPIC. Do not rewrite it into another language/stack.",
        pace_teaching_instructions(pace),
    ]
    if article is not None:
        lines.append(f"Today's source title: {article.title}")
        lines.append(f"Reader stack (context only, NOT the lesson topic): {active or '(none)'}")
    else:
        lines.append(
            "ACTIVE STACK RUN (stay on this stack until its important coverage is done): "
            f"{active or '(infer from themes)'}"
        )

    related = article is None or _yesterday_relates_to_article(profile, article)
    if not _has_previous_briefing(profile) or not related:
        lines.extend(
            [
                "FIRST BRIEFING for this source article — do not continue an unrelated yesterday topic.",
                "Do NOT mention yesterday, previous lessons, continuing a series, or prior takeaways.",
                "Open with today's technical hook only — a fresh first lesson on THIS article.",
            ]
        )
        return "\n".join(lines)

    headline = (path.last_digest_headline or "").strip()
    tldr = path.last_digest_tldr or []
    takeaways = path.last_digest_takeaways or []
    topics = path.last_topics or []
    lines.extend(
        [
            "YESTERDAY'S BRIEFING (continue this series — do not jump to an unrelated stack):",
            f"Headline: {headline}",
        ]
    )
    if path.last_digest_date:
        lines.append(f"Date: {path.last_digest_date}")
    if topics:
        lines.append(f"Themes: {', '.join(topics[:8])}")
    if tldr:
        lines.append("TL;DR:")
        lines.extend(f"- {item}" for item in tldr[:6])
    if takeaways:
        lines.append("Key takeaways to build on:")
        lines.extend(f"- {item}" for item in takeaways[:8])
    lines.append(
        "Today: next technical step on THIS SAME source-article topic "
        "(deeper API, edge case, or clearer explanation) — never switch languages."
    )
    return "\n".join(lines)


def _build_prompt(profile: UserProfile, articles: list[Article]) -> str:
    lead = articles[0] if articles else None
    active = resolve_active_stack(profile)
    pace = next_scrape_pace(profile)
    has_yesterday = bool(lead) and _yesterday_relates_to_article(profile, lead)
    stack = (
        f"Role: {profile.current_role}\n"
        f"Experience: {profile.years_of_experience} years ({profile.content_depth.value})\n"
        f"Primary: {', '.join(profile.primary_tech_stack)}\n"
        f"Interests: {', '.join(profile.interests)}\n"
        f"Reader stack (context only): {active}\n"
        f"Quiz marks: {profile.learning_path.last_quiz_score}/"
        f"{profile.learning_path.last_quiz_total} "
        f"({profile.learning_path.last_quiz_percentage}%); "
        f"attempt {profile.learning_path.last_quiz_attempt_number}; "
        f"result {profile.learning_path.last_quiz_outcome}\n"
        f"Pace: {pace.value}\n"
        f"Excluded: {', '.join(profile.excluded_topics)}"
    )
    title = (lead.title if lead else "today's article").replace('"', "'")
    source_line = (
        f"[Source #1] {lead.title} ({lead.source_domain})" if lead else "[Source #1] (none)"
    )
    if has_yesterday:
        headline_hint = title
        brief_field = (
            '"continuation": "one short sentence linking yesterday to this same article topic"'
        )
    else:
        headline_hint = title
        brief_field = (
            '"continuation": "one short sentence introducing this article '
            '(do NOT mention yesterday or a different language/stack)"'
        )
    return f"""
You write ONLY a tiny JSON metadata header for ONE source article.
Long teaching chapters are written separately in markdown — do NOT put code or long prose here.

HARD RULES for JSON:
- Valid JSON only. No trailing commas. No markdown fences. No raw newlines inside strings.
- Use straight double quotes. Escape any quote inside a string as \\".
- Every string value must be ONE short line (max ~120 characters).
- Do NOT include code blocks, backticks, or multi-paragraph text.
- headline MUST be the source article title (or a tight paraphrase of it).
- tldr and key_takeaways MUST be about THIS article only — never another language/stack.

LEARNING ONLY — no news, M&A, career advice.

{_previous_briefing_block(profile, lead)}

Profile:
{stack}

Source article (the ONLY topic allowed):
{source_line}

Return exactly this shape (and nothing else):
{{
  "headline": "{headline_hint}",
  "tldr": ["short overview bullet about this article", "second bullet", "third bullet"],
  {brief_field},
  "key_takeaways": ["most learnable action from this article", "second action"]
}}
""".strip()


def _overview_from_meta(meta: dict[str, Any]) -> list[dict[str, Any]]:
    """Turn minimal Gemini metadata into the opening of Briefing."""
    continuation = str(meta.get("continuation") or "").strip()
    if not continuation:
        return []
    return [
        {
            "title": "Briefing",
            "content": continuation,
            "sources_cited": [1],
            "estimated_read_minutes": 1.0,
        }
    ]


def _teaching_prompt(profile: UserProfile, article: Article, word_target: int) -> str:
    """Single full-digest prompt — one Gemini call covers the whole briefing."""
    body = _source_excerpt_for_teaching(article)
    active = resolve_active_stack(profile) or (
        ", ".join(profile.primary_tech_stack) or "software engineering"
    )
    stack = ", ".join(profile.primary_tech_stack) or active
    interests = ", ".join(profile.interests) or stack
    related = _yesterday_relates_to_article(profile, article)
    if related:
        open_rule = (
            "Yesterday was the SAME topic family. Open Daily Overview by continuing "
            "that thread, then teach THIS article in Briefing."
        )
        brief_line = "Teach the source article in depth. Put diagrams and code in fenced blocks inside Briefing."
    else:
        open_rule = (
            "Do NOT mention yesterday, prior lessons, Dart/Flutter, or any stack that is not "
            "this article's subject. Open Daily Overview directly with this article."
        )
        brief_line = "Teach THIS source article only. Put diagrams and code in fenced blocks inside Briefing."
    return f"""
You are writing the COMPLETE {_MIN_READ_MINUTES}-{_MAX_READ_MINUTES} minute morning briefing in ONE response.
Write about {word_target} words of markdown (target {_WORD_FLOOR}-{_WORD_CEILING} total). No JSON.
Do not wrap the whole answer in a code fence.
The SOURCE ARTICLE is the only topic. Teach that article's language, APIs, and examples.
Do NOT rewrite it into the reader's stack ({active}) if the article is about something else.
Teach a technical skill — never report news or business deals.

{_previous_briefing_block(profile, article)}

HARD RULES — do NOT write about:
- news, acquisitions, funding rounds, earnings, valuations, layoffs, market rumors
- career advice, interviews, portfolios, "what companies expect", soft skills
- generic "learn JavaScript / HTML / CSS" motivational fluff
- unrelated beginner roadmaps
- a different language or framework than this article (example: no Dart/Flutter when the article is Python)
- legal contracts, business law, or non-engineering lifestyle topics

LANGUAGE — critical:
- Write the entire briefing in ENGLISH only (overview, briefing, takeaways, labels).
- Never paste Portuguese, Spanish, French, German, Korean, Japanese, Chinese, or any other non-English prose.
- If the source article is not English, skip it — do not translate it and do not copy it.

OUTPUT FORMAT — critical:
- SINGLE TOPIC ONLY: the entire briefing covers THIS source article ({article.title}).
- NEVER paste or summarize a second unrelated article mid-briefing.
- NEVER include YAML frontmatter or Dev.to metadata lines (title:, published:, description:, tags:, series:).
- Do not repeat the article title as a markdown H1 — the dashboard already shows the title.

MARKDOWN FENCES — critical for the reader UI:
- Use ``` fences ONLY for real source code, shell commands, or ASCII/box diagrams.
- NEVER write a bare language label on its own line (e.g. `python` or `text`) — always use proper ```python / ```text fences.
- NEVER put explanations, bullet lists, markdown tables, or ### headings inside a fence.
- NEVER fence ordinary teaching prose (even if it mentions while/for/if in English sentences).
- Put teaching prose, bullets, headings, and comparison tables outside fences on normal markdown lines.
- Unfenced paragraphs of prose that belong in a fence will break the UI — fence code tightly.
- Code and diagrams MUST be fenced so they render inside a black box.
- Do not repeat the same paragraph, bullet list, or section twice.

ASCII DIAGRAMS — critical:
- Prefer SIMPLE vertical arrow flows (not wide boxes). Use plain text labels with | and v only:
```
Input Text Document
        |
        v
Try split by "\\n\\n"
        |
        v
Fragment <= max_size --> Keep Fragment
        |
        v
Fragment > max_size --> Try split by "\\n"
```
- Max width 48 characters per line. One step per line. Use --> only for a branch label on the same line.
- Do NOT repeat the same diagram twice (no tree + arrow copy of the same architecture).
- Do NOT put "For example:" or use-case narration inside a diagram fence — put examples in prose outside fences.
- For architecture: one vertical spine only (User → Agent → LLM → Tools). List sibling tools on ONE line with commas, never as a wide multi-column fan-out.
- Do NOT use broken +---+ borders or floating orphan connectors.
- NEVER insert | or v between lines of source code — those markers are for diagrams only.
- NEVER use Unicode box-drawing characters (┌ ─ ┐ │ └ ┘ ├ ┤).
- NEVER put a markdown table inside a diagram fence.
- Comparison tables must be OUTSIDE fences as GitHub-flavored markdown:
  | Capability | Option A | Option B |
  | :--- | :--- | :--- |
  | Row | value | value |

ONLY write: concrete APIs, code patterns, architecture, debugging, configs, and tradeoffs from the source.
Do not invent APIs, URLs, or library names that are not in the source.
{open_rule}

Reader: {profile.current_role or "developer"}, {profile.years_of_experience} years, stack: {stack} / interests: {interests}.
The reader stack is CONTEXT ONLY — never switch the lesson to it.

Title: {article.title}
URL: {article.url}
Source (may be empty — if so, teach the Title topic only; never invent a different language):
{body}

Use exactly this structure (prose outside fences; code AND diagrams ONLY inside ``` fences):
## Daily Overview
2-4 short sentences: what this article teaches and why it matters today.
## Briefing
{brief_line}
A {_MIN_READ_MINUTES}-{_MAX_READ_MINUTES} minute Briefing is teaching, not an essay. Alternate short explanation with fenced examples.
This Briefing must carry most of the {word_target} words.
Include at least 5 fenced code samples in THIS article's language (setup, naive/wrong, correct, edge case, full working snippet) and at least 2 fenced diagrams for the process.
Do NOT fill the word count with prose only. Do NOT add a separate ## Code Snippet heading — keep fences inside Briefing.
## Key Action
3-5 short bullets — the most learnable actions from THIS article only.
## Summary
A tight recap of the overall knowledge from THIS article only (what to remember).
Do not invent other top-level ## headings — only Daily Overview, Briefing, Key Action, and Summary.
End with one markdown link to the source URL.
""".strip()


def _top_up_prompt(profile: UserProfile, articles: list[Article], needed: int, tail: str) -> str:
    lead = articles[0] if articles else None
    title_line = f"- {lead.title}" if lead else "- (primary source)"
    related = bool(lead) and _yesterday_relates_to_article(profile, lead)
    if related:
        add_line = (
            "Add: one worked example, one debugging checklist, one concrete next experiment "
            "that stays on this same article."
        )
    else:
        add_line = (
            "Add: one worked example, one debugging checklist, one concrete next experiment "
            "for THIS article. Do NOT mention yesterday or a different language/stack."
        )
    return f"""
Continue the same TECHNICAL morning briefing. Write {needed} more words of markdown.
No JSON. Do not repeat prior chapters.
No news/M&A/funding and no career advice — only learning: code, APIs, debugging, and architecture
from the source article below.
Stay on the SAME source article topic and language — do NOT introduce a second framework.
The full briefing MUST reach {_MIN_READ_MINUTES}-{_MAX_READ_MINUTES} minutes of reading (~{_WORD_FLOOR}-{_WORD_CEILING} words).
Use ``` fences ONLY for real code or simple arrow-flow diagrams — never for prose, bullets, or headings.
Include at least 2 more fenced code examples and 1 fenced diagram. Do not pad with prose only.

{_previous_briefing_block(profile, lead)}

{add_line}

Primary source (only topic allowed):
{title_line}

Last part already written:
{tail[-1500:]}
""".strip()


# Live models only — dead 2.x IDs 404 and flash-latest often hangs for minutes.
_GEMINI_MODEL_FALLBACKS = ("gemini-3.6-flash",)
_GEMINI_REQUEST_TIMEOUT_SEC = 90
# One full 3k-word briefing needs headroom; keep a hard cap to avoid runaway bills.
_GEMINI_MAX_OUTPUT_TOKENS = 8192
# Digest generation budget: 1 full write + at most 1 length top-up.
_MAX_DIGEST_GEMINI_CALLS = 2


class GeminiQuotaExceeded(RuntimeError):
    """Gemini API free-tier / billing quota exhausted (HTTP 429)."""


def _is_gemini_timeout_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return (
        "504" in msg
        or "deadline expired" in msg
        or "deadlineexceeded" in msg.replace(" ", "")
        or "timed out" in msg
        or "timeout" in msg
    )


def _is_gemini_quota_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return (
        "429" in msg
        or "quota" in msg
        or "resource_exhausted" in msg
        or "resourceexhausted" in msg.replace(" ", "")
    )


def _quota_error_message(exc: BaseException | None = None) -> str:
    detail = str(exc).strip() if exc else ""
    base = (
        "Gemini API quota exceeded (429). "
        "Daily free-tier limit reached — wait for reset or upgrade the API plan, "
        "then retry synthesize."
    )
    if detail and "429" in detail:
        return f"{base} Details: {detail[:300]}"
    return base


def _call_gemini(
    prompt: str,
    *,
    as_json: bool = True,
    max_output_tokens: int = 2048,
) -> tuple[Any, int]:
    settings = get_llm_settings()
    if not settings.GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not configured")

    import google.generativeai as genai

    genai.configure(api_key=settings.GEMINI_API_KEY)
    primary = (settings.GEMINI_MODEL or "").strip() or "gemini-3.6-flash"
    # Never waste time on known-dead model names
    dead = {"gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"}
    models = [
        name
        for name in dict.fromkeys([primary, *_GEMINI_MODEL_FALLBACKS])
        if name and name not in dead
    ]
    if not models:
        models = ["gemini-3.6-flash"]
    last_error: Exception | None = None
    tokens = len(prompt.split()) * 2

    for model_name in models:
        attempts = 2
        for attempt in range(attempts):
            try:
                model = genai.GenerativeModel(model_name)
                config: dict[str, Any] = {
                    "max_output_tokens": min(max_output_tokens, _GEMINI_MAX_OUTPUT_TOKENS)
                }
                if as_json:
                    config["response_mime_type"] = "application/json"
                try:
                    response = model.generate_content(
                        prompt,
                        generation_config=config,
                        request_options={"timeout": _GEMINI_REQUEST_TIMEOUT_SEC},
                    )
                except TypeError:
                    response = model.generate_content(prompt, generation_config=config)
                text = getattr(response, "text", "") or ""
                if as_json:
                    return _parse_json_object(text), tokens
                stripped = _strip_fences(text)
                if stripped.strip():
                    return stripped, tokens
                last_error = RuntimeError(f"empty response from {model_name}")
            except json.JSONDecodeError as exc:
                last_error = exc
                log.warning(
                    "generator: gemini json parse failed",
                    model=model_name,
                    attempt=attempt + 1,
                    error=str(exc),
                )
                continue
            except Exception as exc:
                if _is_gemini_quota_error(exc):
                    log.error(
                        "generator: gemini quota exceeded (429)",
                        model=model_name,
                        attempt=attempt + 1,
                        error=str(exc),
                    )
                    raise GeminiQuotaExceeded(_quota_error_message(exc)) from exc
                last_error = exc
                log.warning(
                    "generator: gemini model failed",
                    model=model_name,
                    attempt=attempt + 1,
                    error=str(exc),
                )
                if _is_gemini_timeout_error(exc):
                    break
                continue

    if last_error and _is_gemini_quota_error(last_error):
        log.error("generator: gemini quota exceeded (429)", error=str(last_error))
        raise GeminiQuotaExceeded(_quota_error_message(last_error)) from last_error
    raise RuntimeError(str(last_error) if last_error else "All Gemini models failed")


def _continuity_opening(profile: UserProfile, articles: list[Article]) -> dict[str, Any]:
    """Lightweight opening when Gemini JSON fails — still frames THIS article."""
    path = profile.learning_path
    lead = next(
        (a for a in articles if a.title and not _is_junk_title(a.title)),
        articles[0] if articles else None,
    )
    headline = _pick_technical_headline(
        (lead.title if lead else "") or "",
        [lead] if lead else articles,
        fallback_theme="software engineering",
    )
    related = bool(lead) and _yesterday_relates_to_article(profile, lead)
    yesterday = (path.last_digest_headline or "").strip() if related else ""
    if yesterday and lead:
        tldr = [
            f"Overview of {headline}",
            f"Continues yesterday's {yesterday}",
            "Stay on this article's language and APIs",
        ]
        body = (
            f"Yesterday covered **{yesterday}**. "
            f"Today stays on the same topic using **{headline}**.\n\n"
        )
    else:
        tldr = [
            f"Overview of {headline}",
            "What this article teaches and why it matters",
            "Code patterns and diagrams from the source",
        ]
        body = f"Today's briefing covers **{headline}** from the source article.\n\n"
    if lead and not _is_junk_title(lead.title):
        body += f"Source article: **{lead.title}**.\n"
    return {
        "headline": headline,
        "tldr": tldr[:6],
        "sections": [
            {
                "title": "Briefing",
                "content": body,
                "sources_cited": [1] if lead else [],
                "estimated_read_minutes": 2.0,
            }
        ],
        "key_takeaways": [
            f"Apply one concrete idea from {headline}"
            if headline
            else "Apply one idea from today's article",
        ],
        "further_reading": [],
    }


def _generate_teaching_sections(
    profile: UserProfile,
    articles: list[Article],
) -> tuple[list[dict[str, Any]], int]:
    """Ask Gemini for the full briefing in at most two calls (write + optional top-up)."""
    sections: list[dict[str, Any]] = []
    tokens = 0
    floor = _min_words()
    # One lead article only — multi-chapter loops burned 3–8 Gemini calls.
    chosen = articles[:1]
    if not chosen:
        return sections, tokens
    if _interest_needs_similar_sources(profile, articles):
        log.info(
            "generator: thin interest source; one full Gemini write + scrape pad for length",
            user_id=profile.user_id,
            lead=(chosen[0].title or "")[:80],
            similar=len(articles),
            lead_words=_article_body_word_count(chosen[0]),
        )

    gemini_calls = 0
    article = chosen[0]
    ask = max(floor, _WORD_FLOOR)
    try:
        text, used = _call_gemini(
            _teaching_prompt(profile, article, ask),
            as_json=False,
            max_output_tokens=min(_GEMINI_MAX_OUTPUT_TOKENS, max(4096, ask * 2)),
        )
        tokens += used
        gemini_calls += 1
    except GeminiQuotaExceeded:
        raise
    except Exception as exc:
        log.warning("generator: teaching chapter failed", title=article.title, error=str(exc))
        return sections, tokens

    content = str(text or "").strip()
    if len(content.split()) < 80:
        log.warning(
            "generator: teaching chapter too short",
            title=article.title,
            words=len(content.split()),
        )
        return sections, tokens
    if not _content_matches_source(content, article, profile):
        log.warning(
            "generator: teaching drifted off source article",
            title=article.title,
        )
        return sections, tokens
    sections.append(_section("Briefing", content, [1]))

    # At most one top-up if still under the 18–20 minute floor.
    if gemini_calls < _MAX_DIGEST_GEMINI_CALLS and _words_in(sections) < floor:
        needed = min(_max_words() - _words_in(sections), floor - _words_in(sections))
        if needed >= 200:
            tail = sections[-1]["content"]
            try:
                extra, used = _call_gemini(
                    _top_up_prompt(profile, chosen, needed, tail),
                    as_json=False,
                    max_output_tokens=min(_GEMINI_MAX_OUTPUT_TOKENS, max(2048, needed * 2)),
                )
                tokens += used
                gemini_calls += 1
                extra_text = str(extra or "").strip()
                if len(extra_text.split()) >= 80 and _content_matches_source(
                    extra_text, article, profile
                ):
                    sections.append(_section("Briefing", extra_text, [1]))
                elif extra_text and not _content_matches_source(extra_text, article, profile):
                    log.warning(
                        "generator: top-up drifted off source article",
                        title=article.title,
                    )
            except GeminiQuotaExceeded:
                raise
            except Exception as exc:
                log.warning("generator: teaching top-up failed", error=str(exc))

    log.info(
        "generator: digest gemini calls",
        calls=gemini_calls,
        max_allowed=_MAX_DIGEST_GEMINI_CALLS,
        words=_words_in(sections),
        floor=floor,
    )
    return sections, tokens


def _technical_articles(
    articles: list[Article],
    profile: UserProfile | None = None,
) -> list[Article]:
    """Keep interest articles, else stack articles — never an off-topic filler."""
    from src.extractors.topic_filter import has_tech_learning_signal, matches_any_term
    from src.ranker.next_day import discovery_match_terms

    match_terms: list[str] = []
    if profile is not None:
        match_terms = discovery_match_terms(profile)

    kept: list[Article] = []
    for article in articles:
        title = article.title or ""
        body = f"{article.summary or ''} {article.body_text or ''}"
        topics = [*article.topics, *article.tech_stack]
        if is_non_learning(
            title,
            body,
            topics,
            source_domain=str(article.source_domain or ""),
            url=str(article.url or ""),
        ):
            continue
        if not has_tech_learning_signal(title, body[:2000], topics):
            continue
        hay = f"{title} {article.summary or ''} {' '.join(topics)} {body[:800]}"
        if match_terms and not matches_any_term(hay, match_terms):
            continue
        kept.append(article)
    return kept


def _expand_from_articles(
    articles: list[Article],
    working: list[dict[str, Any]],
    *,
    floor: int,
    ceiling: int,
) -> list[dict[str, Any]]:
    """Keep appending longer technical excerpts until we hit the word floor."""
    result = list(working)
    for each in (1400, 2000, 2800, 4000):
        if _words_in(result) >= floor:
            break
        long_scrape = _payload_from_articles(
            articles,
            max_total_words=ceiling,
            max_words_each=each,
            article_limit=max(1, len(articles)),
        )
        existing = [str(section.get("content") or "") for section in result]
        fresh_sections: list[dict[str, Any]] = []
        for section in long_scrape["sections"]:
            content = str(section.get("content") or "")
            if not content:
                continue
            if any(_blocks_substantially_overlap(content, prior) for prior in existing):
                continue
            fresh_sections.append(section)
            existing.append(content)
        if fresh_sections:
            result = _trim_sections([*result, *fresh_sections], ceiling)
    return result


def _pad_shortfall_from_articles(
    articles: list[Article],
    working: list[dict[str, Any]],
    *,
    floor: int,
    ceiling: int,
    profile: UserProfile | None = None,
    topic_headline: str = "",
) -> list[dict[str, Any]]:
    """Append leftover source body until we clear a small shortfall under the floor."""
    result = list(working)
    shortfall = floor - _words_in(result)
    if shortfall <= 0:
        return result
    # Leave headroom up to the 25-minute ceiling
    room = max(0, ceiling - _words_in(result))
    need = min(max(shortfall + 50, shortfall), room or shortfall + 50)
    chunks: list[tuple[int, str]] = []
    taken = 0
    for index, article in enumerate(articles, start=1):
        if taken >= need:
            break
        filter_headline = topic_headline or _digest_topic_headline(profile, article)
        body = _keep_on_topic_text(
            _ensure_readable_markdown(
                _clean_scraped_markdown((article.body_text or article.summary or "").strip())
            ),
            filter_headline,
        )
        if not body:
            continue
        existing = [str(section.get("content") or "") for section in result]
        piece = _clip_to_words(body, min(len(body.split()), need - taken + 20))
        if piece and not any(_blocks_substantially_overlap(piece, prior) for prior in existing):
            chunks.append((index, piece))
            existing.append(piece)
            taken += len(piece.split())
    for index, piece in chunks:
        result.append(_section("Briefing", piece, [index]))
    if chunks:
        result = _trim_sections(result, max(ceiling, floor + 100))
    return result


def _enforce_min_length(
    profile: UserProfile,
    articles: list[Article],
    sections: list[dict[str, Any]],
    tokens: int,
    *,
    scraped_only: bool,
) -> tuple[list[dict[str, Any]], int]:
    """Reach the 18–20 minute floor without extra Gemini calls.

    Length after the digest write(+optional top-up) is filled from scraped
    source bodies only — keeps total Gemini usage at most `_MAX_DIGEST_GEMINI_CALLS`.
    """
    if not articles:
        return list(sections), tokens
    floor = _min_words()
    ceiling = _max_words()
    working = list(sections)

    working = _expand_from_articles(articles, working, floor=floor, ceiling=ceiling)
    if _words_in(working) < floor:
        working = _pad_shortfall_from_articles(
            articles,
            working,
            floor=floor,
            ceiling=ceiling,
            profile=profile,
        )

    if _words_in(working) < floor:
        from src.ranker.next_day import profile_has_interests

        if scraped_only:
            hint = "Need longer scraped article bodies before offline synthesis."
        elif profile_has_interests(profile):
            hint = (
                "Retry synthesize — the pipeline will pull similar interest-matched articles when "
                "the lead post is too thin."
            )
        else:
            hint = (
                "Retry synthesize, or fill the user tech stack so Gemini can write a longer briefing."
            )
        raise RuntimeError(
            f"Digest too short ({_words_in(working)} words); "
            f"need at least {floor} words (~{_MIN_READ_MINUTES} min). "
            f"{hint}"
        )
    return working, tokens


def _bullets_for_source(items: list[Any], article: Article | None) -> list[str]:
    """Drop bullets that drifted onto a different language/stack than the source."""
    out: list[str] = []
    source_terms = _tech_terms(article.title or "") if article is not None else set()
    for item in items:
        text = str(item or "").strip()
        if not text:
            continue
        bullet_terms = _tech_terms(text)
        if _terms_conflict(source_terms, bullet_terms):
            continue
        out.append(text)
    return out


def synthesize_digest(
    profile: UserProfile,
    articles: list[Article],
    *,
    digest_date: date | None = None,
    scraped_only: bool = False,
) -> DailyDigest:
    """Build a DailyDigest document from ranked articles. Does not insert."""
    started = time.monotonic()
    articles = _technical_articles(articles, profile)
    if not articles:
        payload = _fallback_payload()
        saved_on = digest_date or date.today()
        saved_at = datetime.now(UTC)
        sections = [
            DigestSection(
                title=str(section.get("title") or "Untitled"),
                content=str(section.get("content") or ""),
                sources_cited=[],
                estimated_read_minutes=float(
                    section.get("estimated_read_minutes") or 1.0
                ),
            )
            for section in payload["sections"]
        ]
        word_count = len(" ".join(section.content for section in sections).split())
        return DailyDigest(
            user_id=profile.user_id,
            digest_date=saved_on,
            article_ids=[],
            reading_time_minutes=1.0,
            word_count=word_count,
            content=DigestContent(
                headline=str(payload.get("headline") or "Your Morning Technical Briefing"),
                tldr=[str(item) for item in payload.get("tldr") or []],
                sections=sections,
                key_takeaways=[str(item) for item in payload.get("key_takeaways") or []],
                sources=[],
                further_reading=[],
            ),
            metrics=DigestMetrics(
                articles_evaluated=0,
                articles_used=0,
                llm_tokens_used=0,
                generation_latency_seconds=round(time.monotonic() - started, 2),
            ),
            generated_at=saved_at,
            updated_at=saved_at,
        )
    theme = pick_daily_theme(profile, articles)
    articles = focus_articles_on_theme(articles, theme)
    lead = _select_lead_article(articles, profile)
    cluster = _related_cluster(lead, articles)
    if lead is not None and len(cluster) > 1:
        log.info(
            "generator: continuing from related same-stack articles",
            lead=(lead.title or "")[:80],
            related=len(cluster),
        )
    lead_list = [lead] if lead is not None else []
    excerpt_total, excerpt_each, excerpt_count = _scrape_excerpt_limits(profile, cluster)
    scraped = _payload_from_articles(
        cluster[:excerpt_count] or lead_list,
        max_total_words=excerpt_total,
        max_words_each=excerpt_each,
        article_limit=excerpt_count,
    )
    # Start from scraped metadata; one Gemini write (+ optional top-up) fills the body.
    payload = {
        "headline": _pick_technical_headline(
            lead.title if lead else "",
            lead_list,
            fallback_theme=theme or "tech",
        ),
        "tldr": list(scraped.get("tldr") or []),
        "sections": list(scraped.get("sections") or []),
        "key_takeaways": list(scraped.get("key_takeaways") or []),
        "further_reading": list(scraped.get("further_reading") or []),
    }
    tokens = 0
    if lead_list and not scraped_only and (not payload["tldr"] or not payload["key_takeaways"]):
        continuity = _continuity_opening(profile, lead_list)
        if not payload["tldr"]:
            payload["tldr"] = list(continuity.get("tldr") or [])
        if not payload["key_takeaways"]:
            payload["key_takeaways"] = list(continuity.get("key_takeaways") or [])

    teaching: list[dict[str, Any]] = []
    if not scraped_only and cluster:
        teaching, teaching_tokens = _generate_teaching_sections(profile, cluster)
        tokens += teaching_tokens
        if not teaching:
            raise RuntimeError(
                "Gemini teaching produced no chapters. "
                "Retry synthesize when the Gemini API quota is available."
            )

    merged = _trim_sections(
        [
            *teaching,
            *(scraped["sections"] if not teaching else []),
        ],
        _max_words(),
    )
    merged, tokens = _enforce_min_length(
        profile, cluster or lead_list, merged, tokens, scraped_only=scraped_only
    )
    normalized = _normalize_digest_sections(merged)
    if not any(str(sec.get("title") or "") == "Summary" for sec in normalized):
        takeaways = [
            str(item).strip() for item in (payload.get("key_takeaways") or []) if str(item).strip()
        ]
        if takeaways:
            normalized.append(
                _section(
                    "Summary",
                    "Overall knowledge from this article:\n\n"
                    + "\n".join(f"- {item}" for item in takeaways[:6]),
                    [1],
                )
            )
    payload["sections"] = _trim_sections(normalized, _max_words())
    if lead is None and not (cluster or articles):
        headline = str(payload.get("headline") or "Your Morning Technical Briefing")
    else:
        headline = _stored_headline(
            {"headline": lead.title if lead is not None else str(payload.get("headline") or "")},
            lead_list or articles,
        )
    payload["headline"] = headline
    filter_headline = _digest_topic_headline(profile, lead, fallback=headline)
    filtered_sections: list[dict[str, Any]] = []
    for sec in payload["sections"]:
        kept = _keep_on_topic_text(str(sec.get("content") or ""), filter_headline)
        if not kept:
            continue
        filtered_sections.append({**sec, "content": kept})
    payload["sections"] = filtered_sections
    if _words_in(payload["sections"]) < _min_words() and (cluster or lead_list):
        refill = _expand_from_articles(
            cluster or lead_list,
            payload["sections"],
            floor=_min_words(),
            ceiling=_max_words(),
        )
        refill = _pad_shortfall_from_articles(
            cluster or lead_list,
            refill,
            floor=_min_words(),
            ceiling=_max_words(),
            profile=profile,
            topic_headline=filter_headline,
        )
        refill = _normalize_digest_sections(refill)
        kept_refill: list[dict[str, Any]] = []
        for sec in refill:
            kept = _keep_on_topic_text(str(sec.get("content") or ""), headline)
            if not kept:
                continue
            kept_refill.append({**sec, "content": kept})
        payload["sections"] = _trim_sections(kept_refill, _max_words())
    payload["tldr"] = _short_actions(list(payload.get("tldr") or []), lead)
    payload["key_takeaways"] = _short_actions(list(payload.get("key_takeaways") or []), lead)

    sources = [
        DigestSource(
            id=index,
            title=article.title,
            url=article.url,
            author=article.author,
            source_domain=article.source_domain,
            published_at=article.published_at,
        )
        for index, article in enumerate(cluster or lead_list, start=1)
    ]
    sections = [
        DigestSection(
            title=str(section.get("title") or "Untitled"),
            content=str(section.get("content") or ""),
            sources_cited=[1] if sources else [],
            estimated_read_minutes=float(section.get("estimated_read_minutes") or 1.0),
        )
        for section in payload.get("sections") or []
    ]
    word_count = len(" ".join(section.content for section in sections).split())
    reading = round(max(1.0, word_count / _WPM), 1)
    floor = _min_words()
    if articles and word_count < floor:
        raise RuntimeError(
            f"Digest too short for the {_MIN_READ_MINUTES}-{_MAX_READ_MINUTES} minute target "
            f"({word_count} words; need at least {floor})."
        )
    further = payload.get("further_reading") or []
    further_reading = [
        {"title": str(item.get("title") or ""), "url": str(item.get("url") or "")}
        for item in further
        if isinstance(item, dict)
    ]

    saved_on = digest_date or date.today()
    saved_at = datetime.now(UTC)

    return DailyDigest(
        user_id=profile.user_id,
        digest_date=saved_on,
        article_ids=[str(article.id) for article in (cluster or lead_list) if article.id is not None],
        reading_time_minutes=reading,
        word_count=word_count,
        content=DigestContent(
            headline=str(payload.get("headline") or "Morning Briefing"),
            tldr=[str(item) for item in payload.get("tldr") or []],
            sections=sections,
            key_takeaways=[str(item) for item in payload.get("key_takeaways") or []],
            sources=sources,
            further_reading=further_reading,
        ),
        metrics=DigestMetrics(
            articles_evaluated=len(articles),
            articles_used=len(sources),
            llm_tokens_used=tokens,
            generation_latency_seconds=round(time.monotonic() - started, 2),
        ),
        generated_at=saved_at,
        updated_at=saved_at,
    )
