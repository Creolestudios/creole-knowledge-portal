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
_TEACHING_ARTICLE_LIMIT = 5
# Never paste entire source blogs into the digest — short technical excerpts only.
_SCRAPE_EXCERPT_WORDS = 140
_SCRAPE_EXCERPT_TOTAL = 700
_SCRAPE_EXCERPT_ARTICLES = 4


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


def _clean_scraped_markdown(text: str) -> str:
    """Drop Dev.to UI chrome and Liquid tags from scraped bodies."""
    without_liquid = _LIQUID.sub("", text)
    kept: list[str] = []
    for line in without_liquid.splitlines():
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
            r"([^\n])(\s*)((?:\|[\s|]*)?)(├──|└──|├─|└─|\+--|\|--)\s*",
            lambda m: f"{m.group(1)}\n{'  ' * min(m.group(3).count('|'), 6)}{m.group(4)} ",
            cleaned,
        )
        cleaned = re.sub(r"([/\w.-]+/)\s+(?=├──|└──|├─|└─|\+--|\|--)", r"\1\n", cleaned)
        cleaned = re.sub(r"\s+\|\s+\|\s+\|\s+", "\n", cleaned)
        cleaned = re.sub(r"\s+\|\s+\|\s+", "\n", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    if cleaned.count("\n\n") < 2 and cleaned.count("\n") >= 2:
        cleaned = re.sub(r"\n+", "\n\n", cleaned)
    return cleaned


def pick_daily_theme(profile: UserProfile, articles: list[Article]) -> str:
    """Keep yesterday's topic when it still appears in today's candidates."""
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
    sections: list[dict[str, Any]] = []
    tldr: list[str] = []
    takeaways: list[str] = []
    further: list[dict[str, str]] = []
    words_left = max_total_words if max_total_words is not None else _SCRAPE_EXCERPT_TOTAL
    per_article = max_words_each if max_words_each is not None else _SCRAPE_EXCERPT_WORDS

    for index, article in enumerate(articles[:article_limit], start=1):
        body = (article.body_text or article.summary or "").strip()
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
    return {
        "headline": articles[0].title,
        "tldr": tldr[:6],
        "sections": sections,
        "key_takeaways": takeaways[:8],
        "further_reading": further,
    }


def _stored_headline(payload: dict[str, Any], articles: list[Article]) -> str:
    """Persist the source article title, not a 'Your Morning X Briefing' template."""
    raw = str(payload.get("headline") or "").strip()
    first = next((article.title.strip() for article in articles if article.title.strip()), "")
    lowered = raw.lower()
    templated = (not raw) or lowered in {
        "morning briefing",
        "your morning briefing",
        "your morning technical briefing",
    } or ("briefing" in lowered and (lowered.startswith("your ") or lowered.startswith("morning ")))
    if templated:
        return first or raw or "Morning Briefing"
    return raw or first or "Morning Briefing"


def _parse_json_object(text: str) -> dict[str, Any]:
    """Parse a JSON object, even if Gemini wraps or truncates it."""
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        raise json.JSONDecodeError("no json object", text, 0)
    return json.loads(text[start : end + 1])


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


def _previous_briefing_block(profile: UserProfile) -> str:
    """Format yesterday's digest so today can continue the series."""
    path = profile.learning_path
    active = resolve_active_stack(profile)
    pace = next_scrape_pace(profile)
    headline = (path.last_digest_headline or "").strip()
    if not headline and not path.last_topics and not active:
        return "No prior briefing — start a fresh technical series for this reader."
    tldr = path.last_digest_tldr or []
    takeaways = path.last_digest_takeaways or []
    topics = path.last_topics or []
    lines = [
        "ACTIVE STACK RUN (stay on this stack until its important coverage is done): "
        f"{active or '(infer from themes)'}",
        pace_teaching_instructions(pace),
        "YESTERDAY'S BRIEFING (continue this series — do not jump to an unrelated stack):",
        f"Headline: {headline or '(unknown)'}",
    ]
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
    sources = []
    for index, article in enumerate(articles[:_ARTICLE_LIMIT], start=1):
        body = (article.body_text or article.summary or "")[:1200]
        sources.append(
            f"[Source #{index}]\n"
            f"Title: {article.title}\n"
            f"URL: {article.url}\n"
            f"Domain: {article.source_domain}\n"
            f"Topics: {', '.join(article.topics)}\n"
            f"Body:\n{body}"
        )
    return f"""
You are writing the OPENING of a {_MIN_READ_MINUTES}-{_MAX_READ_MINUTES} minute personalized LEARNING briefing.
Return strict JSON only. Do not invent URLs.
The opening JSON is short (~300-500 words); longer teaching chapters are attached separately.
The FULL briefing must ultimately be {_MIN_READ_MINUTES}-{_MAX_READ_MINUTES} minutes of reading.
Focus only on LEARNING TOPICS: tutorials, how-tos, architecture, debugging, APIs, and the reader's ACTIVE STACK.
Do NOT write news, M&A, funding, earnings, layoffs, market rumors, or company announcements.
Do NOT write career advice, portfolios, interview tips, or soft skills.
If a source looks like news, ignore it and teach the underlying technical concept from learning sources only.

{_previous_briefing_block(profile)}

Profile:
{stack}

Articles:
{chr(10).join(sources)}

Return this shape:
{{
  "headline": "the exact primary source article title — never a template like Your Morning X Briefing",
  "tldr": ["technical bullet continuing yesterday when possible", "technical bullet", "technical bullet"],
  "sections": [
    {{
      "title": "Continuation from yesterday",
      "content": "2-4 short paragraphs that explicitly pick up from yesterday's briefing and connect today's sources",
      "sources_cited": [1],
      "estimated_read_minutes": 3.0
    }},
    {{
      "title": "Brief",
      "content": "2-4 short paragraphs on today's technical theme for this reader",
      "sources_cited": [1],
      "estimated_read_minutes": 2.0
    }},
    {{
      "title": "Code Snippet",
      "content": "One small fenced code block (8-20 lines max) grounded in the sources, with a one-line caption",
      "sources_cited": [1],
      "estimated_read_minutes": 1.0
    }},
    {{
      "title": "Overview / Summary",
      "content": "Short technical overview of what matters in the sources — no career fluff",
      "sources_cited": [1],
      "estimated_read_minutes": 2.0
    }}
  ],
  "key_takeaways": ["actionable technical takeaway that advances yesterday's learning"],
  "further_reading": []
}}
Prefer those section titles. Longer teaching chapters are attached separately to hit {_MIN_READ_MINUTES}+ minutes.
""".strip()


def _teaching_prompt(profile: UserProfile, article: Article, word_target: int) -> str:
    body = (article.body_text or article.summary or "")[:8000]
    active = resolve_active_stack(profile) or (
        ", ".join(profile.primary_tech_stack) or "software engineering"
    )
    stack = ", ".join(profile.primary_tech_stack) or active
    interests = ", ".join(profile.interests) or stack
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

MARKDOWN FENCES — critical for the reader UI:
- Use ``` fences ONLY for real source code, shell commands, or ASCII/box diagrams.
- NEVER put explanations, bullet lists, or ### headings inside a fence.
- Put teaching prose, bullets, and headings outside fences on normal markdown lines.
- Unfenced paragraphs of prose that belong in a fence will break the UI — fence code tightly.

ONLY write: concrete APIs, code patterns, architecture, debugging, configs, and tradeoffs from the source.
Do not invent APIs, URLs, or library names that are not in the source.
If yesterday's briefing exists, open with one short paragraph that continues that thread.

Reader: {profile.current_role or "developer"}, {profile.years_of_experience} years, stack: {stack} / interests: {interests}.

Title: {article.title}
URL: {article.url}
Source:
{body}

Use this structure:
## {article.title}
### How this continues yesterday (1 short paragraph)
### Technical takeaway
### How it works (with a small code example if the source has one)
### Apply it on {active} today
### Pitfalls
End with one markdown link to the source URL.
""".strip()


def _top_up_prompt(profile: UserProfile, articles: list[Article], needed: int, tail: str) -> str:
    titles = "\n".join(f"- {article.title}" for article in articles[:_TEACHING_ARTICLE_LIMIT])
    stack = ", ".join(profile.primary_tech_stack) or "software engineering"
    return f"""
Continue the same TECHNICAL morning briefing. Write {needed} more words of markdown.
No JSON. Do not repeat prior chapters.
No news/M&A/funding and no career advice — only learning: code, APIs, debugging, and architecture for {stack}.
The full briefing MUST reach {_MIN_READ_MINUTES}-{_MAX_READ_MINUTES} minutes of reading (~{_WORD_FLOOR}-{_WORD_CEILING} words).
Use ``` fences ONLY for real code or ASCII diagrams — never for prose, bullets, or headings.

{_previous_briefing_block(profile)}

Add: one worked example, one debugging checklist, one concrete next experiment that advances yesterday's theme.

Sources still in play:
{titles}

Last part already written:
{tail[-1500:]}
""".strip()


_GEMINI_MODEL_FALLBACKS = (
    "gemini-3.6-flash",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-flash-latest",
)


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
    primary = (settings.GEMINI_MODEL or "").strip()
    models = list(
        dict.fromkeys(
            [primary, *_GEMINI_MODEL_FALLBACKS] if primary else list(_GEMINI_MODEL_FALLBACKS)
        )
    )
    last_error: Exception | None = None
    tokens = len(prompt.split()) * 2

    for model_name in models:
        if not model_name:
            continue
        try:
            model = genai.GenerativeModel(model_name)
            config: dict[str, Any] = {"max_output_tokens": max_output_tokens}
            if as_json:
                config["response_mime_type"] = "application/json"
            response = model.generate_content(prompt, generation_config=config)
            text = getattr(response, "text", "") or ""
            if as_json:
                return _parse_json_object(text), tokens
            stripped = _strip_fences(text)
            if stripped.strip():
                return stripped, tokens
            last_error = RuntimeError(f"empty response from {model_name}")
        except Exception as exc:
            last_error = exc
            log.warning("generator: gemini model failed", model=model_name, error=str(exc))
            continue

    raise RuntimeError(str(last_error) if last_error else "All Gemini models failed")


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
        except Exception as exc:
            log.warning("generator: teaching chapter failed", title=article.title, error=str(exc))
            continue
        content = str(text or "").strip()
        if len(content.split()) < 80:
            continue
        sections.append(_section(article.title, content, [index]))

    if _words_in(sections) < floor and sections:
        needed = min(_max_words() - _words_in(sections), floor - _words_in(sections))
        if needed >= 400:
            tail = sections[-1]["content"]
            try:
                extra, used = _call_gemini(
                    _top_up_prompt(profile, chosen, needed, tail),
                    as_json=False,
                    max_output_tokens=min(8192, max(2048, needed * 3)),
                )
                tokens += used
                extra_text = str(extra or "").strip()
                if len(extra_text.split()) >= 80:
                    sections.append(_section("Going deeper", extra_text, [1]))
            except Exception as exc:
                log.warning("generator: teaching top-up failed", error=str(exc))

    return sections, tokens


def _technical_articles(articles: list[Article]) -> list[Article]:
    """Keep learning articles only — drop career fluff and news/M&A noise."""
    kept = [
        article
        for article in articles
        if not is_non_learning(
            article.title,
            f"{article.summary or ''} {article.body_text or ''}",
            [*article.topics, *article.tech_stack],
            source_domain=str(article.source_domain or ""),
            url=str(article.url or ""),
        )
    ]
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
    for index, article in enumerate(articles[:_ARTICLE_LIMIT], start=1):
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
                    articles,
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
        except Exception as exc:
            log.warning("generator: min-length top-up failed", error=str(exc), round=rounds)

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
    articles = _technical_articles(articles)
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
            gemini_payload, tokens = _call_gemini(_build_prompt(profile, articles))
            overview_sections = [
                section
                for section in (gemini_payload.get("sections") or [])
                if isinstance(section, dict)
                and str(section.get("title") or "") != "Today's curated reading"
            ]
            payload = {
                "headline": gemini_payload.get("headline") or scraped["headline"],
                "tldr": gemini_payload.get("tldr") or scraped["tldr"],
                "sections": [*overview_sections, *scraped["sections"]],
                "key_takeaways": gemini_payload.get("key_takeaways")
                or scraped["key_takeaways"],
                "further_reading": scraped["further_reading"],
            }
        except (json.JSONDecodeError, ValueError, RuntimeError, Exception) as exc:
            log.warning("generator: gemini fallback to scraped articles", error=str(exc))
            payload = scraped

    teaching: list[dict[str, Any]] = []
    if not scraped_only and _words_in([*overview_sections, *scraped["sections"]]) < _min_words():
        teaching, teaching_tokens = _generate_teaching_sections(profile, articles)
        tokens += teaching_tokens

    merged = _trim_sections(
        [*overview_sections, *teaching, *scraped["sections"]],
        _max_words(),
    )
    merged, tokens = _enforce_min_length(
        profile, articles, merged, tokens, scraped_only=scraped_only
    )
    payload["sections"] = merged

    sources = [
        DigestSource(
            id=index,
            title=article.title,
            url=article.url,
            author=article.author,
            source_domain=article.source_domain,
            published_at=article.published_at,
        )
        for index, article in enumerate(articles[:_ARTICLE_LIMIT], start=1)
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
    if word_count < floor:
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
