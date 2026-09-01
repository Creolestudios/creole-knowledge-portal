"""Gemini digest synthesis for ranked Beanie articles."""

from __future__ import annotations

import json
import re
import time
from datetime import UTC, date, datetime
from typing import Any

import structlog

from src.core.config import get_llm_settings, get_scraping_settings
from src.models.article import Article
from src.models.digest import (
    DailyDigest,
    DigestContent,
    DigestMetrics,
    DigestSection,
    DigestSource,
)
from src.models.profile import UserProfile, next_scrape_pace, pace_teaching_instructions, resolve_active_stack, scrape_focus_terms, topic_tokens_from_text
from src.extractors.topic_filter import is_non_learning

log = structlog.get_logger(__name__)

_WPM = 225
_MIN_READ_MINUTES = 18  # ~4000 words
_MAX_READ_MINUTES = 20  # ~4500 words
_WORD_FLOOR = 4000
_WORD_CEILING = 4500
_ARTICLE_LIMIT = 10
_TEACHING_ARTICLE_LIMIT = 1
# Never paste entire source blogs into the digest — short technical excerpts only.
_SCRAPE_EXCERPT_WORDS = 140
_SCRAPE_EXCERPT_TOTAL = 700
_SCRAPE_EXCERPT_ARTICLES = 1


def _min_words() -> int:
    """Lower bound: config target, floored at 4000 (~18 min)."""
    return max(get_scraping_settings().DIGEST_WORD_TARGET, _WORD_FLOOR)


def _max_words() -> int:
    """Upper bound: keep digests in the 4000–4500 band."""
    return _WORD_CEILING


def _words_in(sections: list[dict[str, Any]]) -> int:
    return len(" ".join(str(section.get("content") or "") for section in sections).split())


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
    r"^##\s+(Brief|Code Snippet|Overview\s*/\s*Summary|Overview|Summary|"
    r"Going deeper|Continuation from yesterday|Why this matters today|"
    r"Today's curated reading)\s*$",
    re.IGNORECASE | re.MULTILINE,
)


def _extract_fenced_blocks(content: str) -> tuple[str, list[str]]:
    """Split markdown into prose vs ``` fenced blocks (code/diagrams)."""
    text = content or ""
    fences: list[str] = []
    prose_parts: list[str] = []
    cursor = 0
    for match in re.finditer(r"```[\w+-]*\n.*?```", text, flags=re.DOTALL):
        before = text[cursor : match.start()].strip()
        if before:
            prose_parts.append(before)
        fences.append(match.group(0).strip())
        cursor = match.end()
    tail = text[cursor:].strip()
    if tail:
        prose_parts.append(tail)
    return "\n\n".join(prose_parts).strip(), fences


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
        parts.append(
            {"title": title, "content": preface, "sources_cited": sources_cited}
        )
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
    return parts or [
        {"title": title, "content": text, "sources_cited": sources_cited}
    ]


def _normalize_digest_sections(sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Force every digest into Brief → Code Snippet → Overview / Summary."""
    brief_parts: list[str] = []
    code_parts: list[str] = []
    overview_parts: list[str] = []
    cited: list[int] = []

    expanded: list[dict[str, Any]] = []
    for sec in sections:
        title = str(sec.get("title") or "").strip() or "Untitled"
        content = str(sec.get("content") or "").strip()
        if not content:
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
        prose, fences = _extract_fenced_blocks(content)
        code_parts.extend(fences)

        if "code" in lower:
            if prose:
                code_parts.append(prose)
            continue

        is_brief = lower in {
            "brief",
            "continuation from yesterday",
            "why this matters today",
        } or lower.startswith("brief")

        if is_brief:
            if prose:
                brief_parts.append(prose)
        elif prose:
            overview_parts.append(prose)

    # Always keep Brief present when we have any narrative
    if not brief_parts and overview_parts:
        brief_parts.append(overview_parts.pop(0))

    sources_cited = list(dict.fromkeys(cited)) or [1]
    out: list[dict[str, Any]] = []
    if brief_parts:
        out.append(_section("Brief", "\n\n".join(brief_parts), sources_cited))
    if code_parts:
        out.append(_section("Code Snippet", "\n\n".join(code_parts), sources_cited))
    if overview_parts:
        out.append(
            _section("Overview / Summary", "\n\n".join(overview_parts), sources_cited)
        )
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
    return "".join(parts).rstrip()


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
    if path.last_digest_headline:
        tokens = topic_tokens_from_text(path.last_digest_headline)
        if tokens:
            return tokens[0]
    last = scrape_focus_terms(profile)
    if last:
        return last[0]
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
        if needle in f"{article.title} {article.summary} {article.body_text[:1200]} {' '.join(article.topics)}".lower()
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


def _payload_from_articles(
    articles: list[Article],
    *,
    max_total_words: int | None = None,
    max_words_each: int | None = None,
    article_limit: int = _ARTICLE_LIMIT,
) -> dict[str, Any]:
    """Build short technical excerpts from scraped bodies (no full-article dump)."""
    from src.extractors.topic_filter import has_tech_learning_signal, is_off_topic_lifestyle

    sections: list[dict[str, Any]] = []
    tldr: list[str] = []
    takeaways: list[str] = []
    further: list[dict[str, str]] = []
    words_left = max_total_words if max_total_words is not None else _SCRAPE_EXCERPT_TOTAL
    per_article = max_words_each if max_words_each is not None else _SCRAPE_EXCERPT_WORDS

    for index, article in enumerate(articles[:article_limit], start=1):
        title = article.title or ""
        body = (article.body_text or article.summary or "").strip()
        # Never dump lifestyle / off-interest article bodies into the digest
        if is_off_topic_lifestyle(title, body[:1500]) or not has_tech_learning_signal(
            title, body[:2000], [*article.topics, *article.tech_stack]
        ):
            continue
        if not body:
            body = (
                f"{article.title} was selected for your stack. "
                f"Read the original: {article.url}"
            )
        tldr.append(article.title)
        takeaways.append(f"Skim the source on {article.title} and apply one idea to your stack today.")
        further.append({"title": article.title, "url": str(article.url)})
        word_count = len(body.split())
        take_n = min(word_count, per_article, words_left) if words_left > 0 else 0
        if take_n <= 0:
            break
        text = _ensure_readable_markdown(_clip_to_words(body, take_n))
        words_left -= take_n
        sections.append(
            _section(
                "Overview / Summary",
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
    if text.startswith("next steps after:") and re.search(
        r"\.(pdf|zip|exe|dmg)\b", text
    ):
        return True
    return False


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
    return "briefing" in lowered and (
        lowered.startswith("your ") or lowered.startswith("morning ")
    )


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


def _previous_briefing_block(profile: UserProfile) -> str:
    """Format yesterday's digest so today can continue the series.

    New users (no prior digest) get a first-day briefing — never invent a fake yesterday.
    """
    path = profile.learning_path
    active = resolve_active_stack(profile)
    pace = next_scrape_pace(profile)
    lines = [
        "ACTIVE STACK RUN (stay on this stack until its important coverage is done): "
        f"{active or '(infer from themes)'}",
        pace_teaching_instructions(pace),
    ]

    if not _has_previous_briefing(profile):
        lines.extend(
            [
                "FIRST BRIEFING for this reader — there is NO yesterday digest.",
                "Do NOT mention yesterday, previous lessons, continuing a series, or prior takeaways.",
                "Open with today's technical hook only — a fresh first lesson.",
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
        "Today: next technical step INSIDE the active stack (deeper API, edge case, "
        "or clearer explanation) — never a random new stack."
    )
    return "\n".join(lines)


def _build_prompt(profile: UserProfile, articles: list[Article]) -> str:
    active = resolve_active_stack(profile)
    pace = next_scrape_pace(profile)
    has_yesterday = _has_previous_briefing(profile)
    stack = (
        f"Role: {profile.current_role}\n"
        f"Experience: {profile.years_of_experience} years ({profile.content_depth.value})\n"
        f"Primary: {', '.join(profile.primary_tech_stack)}\n"
        f"Interests: {', '.join(profile.interests)}\n"
        f"Active stack run: {active}\n"
        f"Quiz marks: {profile.learning_path.last_quiz_score}/"
        f"{profile.learning_path.last_quiz_total} "
        f"({profile.learning_path.last_quiz_percentage}%); "
        f"attempt {profile.learning_path.last_quiz_attempt_number}; "
        f"result {profile.learning_path.last_quiz_outcome}\n"
        f"Pace: {pace.value}\n"
        f"Excluded: {', '.join(profile.excluded_topics)}"
    )
    # Keep source stubs short — long bodies with quotes/code break Gemini JSON
    sources = []
    for index, article in enumerate(articles[: min(4, _ARTICLE_LIMIT)], start=1):
        sources.append(
            f"[Source #{index}] {article.title} ({article.source_domain}) "
            f"topics={', '.join((article.topics or [])[:5])}"
        )
    if has_yesterday:
        headline_hint = "short technical headline continuing yesterday when possible"
        brief_field = (
            '"continuation": "one short sentence linking yesterday to today"'
        )
    else:
        headline_hint = "short technical headline for this FIRST briefing (no yesterday)"
        brief_field = (
            '"continuation": "one short sentence introducing today\'s technical hook '
            '(do NOT mention yesterday)"'
        )
    return f"""
You write ONLY a tiny JSON metadata header for a learning briefing.
Long teaching chapters are written separately in markdown — do NOT put code or long prose here.

HARD RULES for JSON:
- Valid JSON only. No trailing commas. No markdown fences. No raw newlines inside strings.
- Use straight double quotes. Escape any quote inside a string as \\".
- Every string value must be ONE short line (max ~120 characters).
- Do NOT include code blocks, backticks, or multi-paragraph text.

LEARNING ONLY — no news, M&A, career advice.

{_previous_briefing_block(profile)}

Profile:
{stack}

Sources:
{chr(10).join(sources)}

Return exactly this shape (and nothing else):
{{
  "headline": "{headline_hint}",
  "tldr": ["short bullet 1", "short bullet 2", "short bullet 3"],
  {brief_field},
  "key_takeaways": ["short takeaway 1", "short takeaway 2"]
}}
""".strip()


def _overview_from_meta(meta: dict[str, Any]) -> list[dict[str, Any]]:
    """Turn minimal Gemini metadata into the Brief section."""
    continuation = str(meta.get("continuation") or "").strip()
    if not continuation:
        return []
    return [
        {
            "title": "Brief",
            "content": continuation,
            "sources_cited": [1],
            "estimated_read_minutes": 1.0,
        }
    ]


def _teaching_prompt(profile: UserProfile, article: Article, word_target: int) -> str:
    body = (article.body_text or article.summary or "")[:8000]
    active = resolve_active_stack(profile) or (
        ", ".join(profile.primary_tech_stack) or "software engineering"
    )
    stack = ", ".join(profile.primary_tech_stack) or active
    interests = ", ".join(profile.interests) or stack
    has_yesterday = _has_previous_briefing(profile)
    if has_yesterday:
        open_rule = (
            "If yesterday's briefing exists, open with one short paragraph that continues that thread."
        )
        brief_line = (
            "One short paragraph continuing yesterday, then the technical hook for today."
        )
    else:
        open_rule = (
            "FIRST BRIEFING — do NOT mention yesterday, prior lessons, or continuing a series. "
            "Open directly with today's technical hook."
        )
        brief_line = (
            "One short paragraph introducing today's technical hook (no yesterday references)."
        )
    return f"""
You are writing one LEARNING chapter of a {_MIN_READ_MINUTES}-{_MAX_READ_MINUTES} minute morning briefing.
Write about {word_target} words of markdown. No JSON. Do not wrap the whole answer in a code fence.
Stay strictly on the ACTIVE STACK ({active}) and the source article — do not switch stacks.
Teach a technical skill — never report news or business deals.

{_previous_briefing_block(profile)}

HARD RULES — do NOT write about:
- news, acquisitions, funding rounds, earnings, valuations, layoffs, market rumors
- career advice, interviews, portfolios, "what companies expect", soft skills
- generic "learn JavaScript / HTML / CSS" motivational fluff
- unrelated beginner roadmaps
- a different tech stack than {active}
- legal contracts, business law, or non-engineering lifestyle topics

LANGUAGE — critical:
- Write the entire chapter in ENGLISH only.
- Never include Korean, Japanese, Chinese, or other non-English body text.
- If the source is non-English or off-topic, skip it and teach a related {active} pattern in English instead.

OUTPUT FORMAT — critical:
- SINGLE TOPIC ONLY: the entire chapter covers THIS source article ({article.title}) — never introduce React, Kubernetes, Python, etc. unless that IS this article's subject.
- NEVER paste or summarize a second unrelated article mid-chapter.
- NEVER include YAML frontmatter or Dev.to metadata lines (title:, published:, description:, tags:, series:).
- Do not repeat the article title as a markdown H1 — the dashboard already shows the title.
- Start teaching content directly (Brief paragraph or ## Brief section).

MARKDOWN FENCES — critical for the reader UI:
- Use ``` fences ONLY for real source code, shell commands, or ASCII/box diagrams.
- NEVER write a bare language label on its own line (e.g. `python` or `text`) — always use proper ```python / ```text fences.
- NEVER put explanations, bullet lists, markdown tables, or ### headings inside a fence.
- Put teaching prose, bullets, headings, and comparison tables outside fences on normal markdown lines.
- Unfenced paragraphs of prose that belong in a fence will break the UI — fence code tightly.

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
- Do NOT repeat the same decision tree twice. Do NOT use broken +---+ borders.
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

Title: {article.title}
URL: {article.url}
Source:
{body}

Use this structure (prose outside fences; code ONLY inside ``` fences):
## Brief
{brief_line}
## Code Snippet
One fenced code block with a language tag (typescript, python, bash, etc.).
## Overview / Summary
### Technical takeaway
### How it works
### Apply it on {active} today
### Pitfalls
Do not invent other top-level ## headings — only Brief, Code Snippet, and Overview / Summary.
End with one markdown link to the source URL.
""".strip()


def _top_up_prompt(profile: UserProfile, articles: list[Article], needed: int, tail: str) -> str:
    lead = articles[0] if articles else None
    title_line = f"- {lead.title}" if lead else "- (primary source)"
    stack = ", ".join(profile.primary_tech_stack) or "software engineering"
    if _has_previous_briefing(profile):
        add_line = (
            "Add: one worked example, one debugging checklist, one concrete next experiment "
            "that advances yesterday's theme."
        )
    else:
        add_line = (
            "Add: one worked example, one debugging checklist, one concrete next experiment "
            "for today's topic. Do NOT mention yesterday."
        )
    return f"""
Continue the same TECHNICAL morning briefing. Write {needed} more words of markdown.
No JSON. Do not repeat prior chapters.
No news/M&A/funding and no career advice — only learning: code, APIs, debugging, and architecture for {stack}.
Stay on the SAME source article topic — do NOT introduce a second framework or unrelated tutorial.
The full briefing MUST reach {_MIN_READ_MINUTES}-{_MAX_READ_MINUTES} minutes of reading (~{_WORD_FLOOR}-{_WORD_CEILING} words).
Use ``` fences ONLY for real code or simple arrow-flow diagrams — never for prose, bullets, or headings.

{_previous_briefing_block(profile)}

{add_line}

Primary source (only topic allowed):
{title_line}

Last part already written:
{tail[-1500:]}
""".strip()


# Live models only — dead 2.x IDs 404 and flash-latest often hangs for minutes.
_GEMINI_MODEL_FALLBACKS = (
    "gemini-3.6-flash",
)
_GEMINI_REQUEST_TIMEOUT_SEC = 75


class GeminiQuotaExceeded(RuntimeError):
    """Gemini API free-tier / billing quota exhausted (HTTP 429)."""


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
                config: dict[str, Any] = {"max_output_tokens": max_output_tokens}
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
                # Timeout / 5xx — retry same model once, then next
                continue

    if last_error and _is_gemini_quota_error(last_error):
        log.error("generator: gemini quota exceeded (429)", error=str(last_error))
        raise GeminiQuotaExceeded(_quota_error_message(last_error)) from last_error
    raise RuntimeError(str(last_error) if last_error else "All Gemini models failed")


def _continuity_opening(profile: UserProfile, articles: list[Article]) -> dict[str, Any]:
    """Lightweight opening when Gemini JSON fails — still frames the lesson."""
    path = profile.learning_path
    active = resolve_active_stack(profile) or (
        (profile.primary_tech_stack or ["software engineering"])[0]
    )
    has_yesterday = _has_previous_briefing(profile)
    yesterday_raw = (path.last_digest_headline or "").strip()
    yesterday = yesterday_raw if has_yesterday else ""
    theme = pick_daily_theme(profile, articles) or (
        topic_tokens_from_text(yesterday)[0]
        if yesterday and topic_tokens_from_text(yesterday)
        else active
    )
    lead = next(
        (a for a in articles if a.title and not _is_junk_title(a.title)),
        articles[0] if articles else None,
    )
    headline = _pick_technical_headline(
        (lead.title if lead else "") or "",
        articles,
        fallback_theme=str(theme or active),
    )
    if yesterday:
        tldr = [
            f"Continue {yesterday}",
            f"Focus theme: {theme or active}",
            "New technical angles from today's learning sources",
        ]
        body = (
            f"Yesterday covered **{yesterday}**. "
            f"Today advances the same learning path on **{theme or active}** "
            f"using fresh technical sources — not a repeat of yesterday's briefing.\n\n"
        )
    else:
        tldr = [
            f"Start learning {theme or active}",
            f"Focus theme: {theme or active}",
            "Technical angles from today's learning sources",
        ]
        body = (
            f"Today's briefing introduces **{theme or active}** "
            f"using fresh technical sources.\n\n"
        )
    if lead and not _is_junk_title(lead.title):
        body += f"Supporting source for this step: **{lead.title}**.\n"
    return {
        "headline": headline,
        "tldr": tldr[:6],
        "sections": [
            {
                "title": "Brief",
                "content": body,
                "sources_cited": [1] if lead else [],
                "estimated_read_minutes": 2.0,
            }
        ],
        "key_takeaways": [
            f"Apply one new {active} pattern from today's sources",
        ],
        "further_reading": [],
    }


def _generate_teaching_sections(
    profile: UserProfile,
    articles: list[Article],
) -> tuple[list[dict[str, Any]], int]:
    """Ask Gemini for long markdown chapters until we reach the word floor."""
    sections: list[dict[str, Any]] = []
    tokens = 0
    floor = _min_words()
    chosen = articles[:_TEACHING_ARTICLE_LIMIT]
    if not chosen:
        return sections, tokens
    per_chapter = max(650, min(850, floor // max(1, len(chosen))))

    for index, article in enumerate(chosen, start=1):
        if _words_in(sections) >= floor:
            break
        remaining = floor - _words_in(sections)
        ask = min(per_chapter, max(500, remaining))
        try:
            text, used = _call_gemini(
                _teaching_prompt(profile, article, ask),
                as_json=False,
                max_output_tokens=min(8192, max(2048, ask * 3)),
            )
            tokens += used
        except GeminiQuotaExceeded:
            raise
        except Exception as exc:
            log.warning("generator: teaching chapter failed", title=article.title, error=str(exc))
            continue
        content = str(text or "").strip()
        if len(content.split()) < 80:
            continue
        sections.append(_section("Overview / Summary", content, [index]))

    if _words_in(sections) < floor and sections:
        needed = min(_max_words() - _words_in(sections), floor - _words_in(sections))
        if needed >= 400:
            tail = sections[-1]["content"]
            try:
                extra, used = _call_gemini(
                    _top_up_prompt(profile, chosen[:1], needed, tail),
                    as_json=False,
                    max_output_tokens=min(8192, max(2048, needed * 3)),
                )
                tokens += used
                extra_text = str(extra or "").strip()
                if len(extra_text.split()) >= 80:
                    sections.append(_section("Going deeper", extra_text, [1]))
            except GeminiQuotaExceeded:
                raise
            except Exception as exc:
                log.warning("generator: teaching top-up failed", error=str(exc))

    return sections, tokens


def _technical_articles(
    articles: list[Article],
    profile: UserProfile | None = None,
) -> list[Article]:
    """Keep interest-related learning articles only — drop lifestyle / off-stack junk."""
    from src.extractors.topic_filter import has_tech_learning_signal, matches_any_term

    # Interests field only — never invent day-relevance / stack / role terms here
    terms: list[str] = []
    if profile is not None:
        terms = [str(t).strip() for t in (profile.interests or []) if str(t).strip()]

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
        # With interests: must match. Without: any tech learning article (already site-filtered upstream)
        if terms and not matches_any_term(hay, terms):
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
            article_limit=_ARTICLE_LIMIT,
        )
        result = _trim_sections([*result, *long_scrape["sections"]], ceiling)
    return result


def _pad_shortfall_from_articles(
    articles: list[Article],
    working: list[dict[str, Any]],
    *,
    floor: int,
    ceiling: int,
) -> list[dict[str, Any]]:
    """Append leftover source body until we clear a small shortfall under the floor."""
    result = list(working)
    shortfall = floor - _words_in(result)
    if shortfall <= 0:
        return result
    # Leave headroom up to the 25-minute ceiling
    room = max(0, ceiling - _words_in(result))
    need = min(max(shortfall + 50, shortfall), room or shortfall + 50)
    chunks: list[str] = []
    taken = 0
    primary = articles[:1]
    for index, article in enumerate(primary, start=1):
        if taken >= need:
            break
        body = _ensure_readable_markdown(
            _clean_scraped_markdown((article.body_text or article.summary or "").strip())
        )
        if not body:
            continue
        already = " ".join(str(section.get("content") or "") for section in result)
        # Prefer unseen tail of the article so we don't duplicate the short excerpt
        words = body.split()
        if not words:
            continue
        start = max(0, len(words) // 3)
        slice_words = words[start : start + min(800, need - taken + 20)]
        if len(slice_words) < 40:
            slice_words = words[: min(800, need - taken + 20)]
        piece = " ".join(slice_words)
        if piece and piece not in already:
            chunks.append(piece)
            taken += len(slice_words)
    if chunks:
        result.append(_section("Deep dive (source continuation)", "\n\n".join(chunks), [1]))
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
    """Keep expanding until the digest is at least 20 minutes of reading."""
    floor = _min_words()
    ceiling = _max_words()
    working = list(sections)

    if scraped_only:
        working = _expand_from_articles(articles, working, floor=floor, ceiling=ceiling)
        if _words_in(working) < floor:
            working = _pad_shortfall_from_articles(
                articles, working, floor=floor, ceiling=ceiling
            )
        if _words_in(working) < floor:
            raise RuntimeError(
                f"Digest too short ({_words_in(working)} words); "
                f"need at least {floor} words (~{_MIN_READ_MINUTES} min). "
                "Need longer scraped article bodies before offline synthesis."
            )
        return working, tokens

    rounds = 0
    while _words_in(working) < floor and rounds < 6:
        rounds += 1
        needed = min(ceiling - _words_in(working), floor - _words_in(working))
        # Small shortfalls (e.g. 4489/4500) — pad from sources instead of giving up
        if needed < 200:
            working = _pad_shortfall_from_articles(
                articles, working, floor=floor, ceiling=ceiling
            )
            break
        try:
            extra, used = _call_gemini(
                _top_up_prompt(
                    profile,
                    articles[:1],
                    needed,
                    working[-1]["content"] if working else "",
                ),
                as_json=False,
                max_output_tokens=min(8192, max(2048, needed * 3)),
            )
            tokens += used
            extra_text = str(extra or "").strip()
            if len(extra_text.split()) >= 80:
                working.append(_section("Overview / Summary", extra_text, [1]))
                working = _trim_sections(working, ceiling)
                continue
        except GeminiQuotaExceeded:
            raise
        except Exception as exc:
            log.error(
                "generator: min-length top-up failed",
                error=str(exc),
                round=rounds,
            )
            if _is_gemini_quota_error(exc):
                raise GeminiQuotaExceeded(_quota_error_message(exc)) from exc

        # Gemini unavailable — expand technical source bodies (never career fluff).
        working = _expand_from_articles(articles, working, floor=floor, ceiling=ceiling)
        if _words_in(working) >= floor:
            break

    if _words_in(working) < floor:
        working = _pad_shortfall_from_articles(
            articles, working, floor=floor, ceiling=ceiling
        )

    if _words_in(working) < floor:
        raise RuntimeError(
            f"Digest too short ({_words_in(working)} words); "
            f"need at least {floor} words (~{_MIN_READ_MINUTES} min). "
            "Retry synthesize, or fill the user tech stack so Gemini can write longer chapters."
        )
    return working, tokens


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
    theme = pick_daily_theme(profile, articles)
    articles = focus_articles_on_theme(articles, theme)
    scraped = _payload_from_articles(
        articles,
        max_total_words=_SCRAPE_EXCERPT_TOTAL,
        max_words_each=_SCRAPE_EXCERPT_WORDS,
        article_limit=_SCRAPE_EXCERPT_ARTICLES,
    )
    payload = scraped
    tokens = 0
    overview_sections: list[dict[str, Any]] = []
    if articles and not scraped_only:
        try:
            gemini_payload, tokens = _call_gemini(
                _build_prompt(profile, articles),
                max_output_tokens=1024,
            )
            overview_sections = _overview_from_meta(gemini_payload)
            payload = {
                "headline": _pick_technical_headline(
                    str(gemini_payload.get("headline") or ""),
                    articles,
                    fallback_theme=theme or resolve_active_stack(profile) or "tech",
                ),
                "tldr": gemini_payload.get("tldr") or scraped["tldr"],
                "sections": [*overview_sections, *scraped["sections"]],
                "key_takeaways": gemini_payload.get("key_takeaways")
                or scraped["key_takeaways"],
                "further_reading": scraped["further_reading"],
            }
        except GeminiQuotaExceeded:
            raise
        except (json.JSONDecodeError, ValueError, RuntimeError, Exception) as exc:
            if _is_gemini_quota_error(exc):
                log.error("generator: gemini quota exceeded (429)", error=str(exc))
                raise GeminiQuotaExceeded(_quota_error_message(exc)) from exc
            log.warning(
                "generator: opening JSON failed; continuing with teaching chapters",
                error=str(exc),
            )
            # Do NOT dump raw scrapes as the whole briefing — keep continuity framing
            # and rely on markdown teaching chapters (+ short source excerpts).
            continuity = _continuity_opening(profile, articles)
            overview_sections = list(continuity["sections"])
            payload = {
                "headline": continuity["headline"],
                "tldr": continuity["tldr"],
                "sections": [*overview_sections, *scraped["sections"]],
                "key_takeaways": continuity["key_takeaways"],
                "further_reading": scraped["further_reading"],
            }

    teaching: list[dict[str, Any]] = []
    # Always attempt teaching chapters unless explicitly scraped-only — this is the
    # real "next step" content. Markdown path is more reliable than opening JSON.
    if not scraped_only and articles:
        teaching, teaching_tokens = _generate_teaching_sections(profile, articles)
        tokens += teaching_tokens
        if not teaching:
            log.warning(
                "generator: teaching chapters empty; digest may be short",
                user_id=profile.user_id,
            )

    merged = _trim_sections(
        [
            *overview_sections,
            *teaching,
            *(scraped["sections"] if not teaching else []),
        ],
        _max_words(),
    )
    if articles:
        merged, tokens = _enforce_min_length(
            profile, articles, merged, tokens, scraped_only=scraped_only
        )
    payload["sections"] = _normalize_digest_sections(merged)

    cited_ids: set[int] = set()
    for section in payload.get("sections") or []:
        for item in section.get("sources_cited") or []:
            try:
                cited_ids.add(int(item))
            except (TypeError, ValueError):
                continue
    # Always keep the teaching/lead articles that actually shaped the briefing.
    if not cited_ids:
        cited_ids = {1}
    capped = articles[:_ARTICLE_LIMIT]
    chosen = [
        (index, article)
        for index, article in enumerate(capped, start=1)
        if index in cited_ids
    ]
    # If citations were sparse, still prefer interest-related tech articles only.
    if len(chosen) < 2:
        from src.extractors.topic_filter import has_tech_learning_signal

        for index, article in enumerate(capped, start=1):
            if index in {i for i, _ in chosen}:
                continue
            if has_tech_learning_signal(
                article.title,
                f"{article.summary or ''} {article.body_text or ''}"[:1500],
                [*article.topics, *article.tech_stack],
            ):
                chosen.append((index, article))
            if len(chosen) >= min(5, len(capped)):
                break
    if not chosen and capped:
        chosen = [(1, capped[0])]

    sources = [
        DigestSource(
            id=index,
            title=article.title,
            url=article.url,
            author=article.author,
            source_domain=article.source_domain,
            published_at=article.published_at,
        )
        for index, article in chosen
    ]
    sections = [
        DigestSection(
            title=str(section.get("title") or "Untitled"),
            content=str(section.get("content") or ""),
            sources_cited=[int(item) for item in section.get("sources_cited") or []],
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
        article_ids=[str(article.id) for article in articles if article.id is not None],
        reading_time_minutes=reading,
        word_count=word_count,
        content=DigestContent(
            headline=_stored_headline(payload, articles),
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
