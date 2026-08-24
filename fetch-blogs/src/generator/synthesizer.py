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
from src.models.profile import UserProfile, scrape_focus_terms, topic_tokens_from_text
from src.extractors.topic_filter import is_career_fluff

log = structlog.get_logger(__name__)

_WPM = 225
_MIN_READ_MINUTES = 20
_MAX_READ_MINUTES = 25
_ARTICLE_LIMIT = 10
_TEACHING_ARTICLE_LIMIT = 5
# Never paste entire source blogs into the digest — short technical excerpts only.
_SCRAPE_EXCERPT_WORDS = 140
_SCRAPE_EXCERPT_TOTAL = 700
_SCRAPE_EXCERPT_ARTICLES = 4


def _min_words() -> int:
    return max(get_scraping_settings().DIGEST_WORD_TARGET, _MIN_READ_MINUTES * _WPM)


def _max_words() -> int:
    return _MAX_READ_MINUTES * _WPM


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
                f"**From [{article.title}]({article.url}):**\n\n{text}",
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


def _build_prompt(profile: UserProfile, articles: list[Article]) -> str:
    stack = (
        f"Role: {profile.current_role}\n"
        f"Experience: {profile.years_of_experience} years ({profile.content_depth.value})\n"
        f"Primary: {', '.join(profile.primary_tech_stack)}\n"
        f"Interests: {', '.join(profile.interests)}\n"
        f"Next-step topics: {', '.join(profile.learning_path.next_step_topics)}\n"
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
You are writing a short personalized intro for a morning TECH briefing.
Return strict JSON only. Do not invent URLs. Keep total under 400 words.
Focus only on the reader's stack and the cited articles' technical ideas.
Do NOT write career advice, portfolios, interview tips, or soft skills.

Profile:
{stack}

Articles:
{chr(10).join(sources)}

Return this shape:
{{
  "headline": "the exact primary source article title — never a template like Your Morning X Briefing",
  "tldr": ["technical bullet", "technical bullet", "technical bullet"],
  "sections": [
    {{
      "title": "Brief",
      "content": "2-4 short paragraphs on the technical theme for today's reader",
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
  "key_takeaways": ["actionable technical takeaway"],
  "further_reading": []
}}
Use exactly those three section titles when possible. Longer teaching chapters are attached separately.
""".strip()


def _teaching_prompt(profile: UserProfile, article: Article, word_target: int) -> str:
    body = (article.body_text or article.summary or "")[:8000]
    stack = ", ".join(profile.primary_tech_stack) or "software engineering"
    interests = ", ".join(profile.interests) or stack
    return f"""
You are writing one TECHNICAL chapter of a { _MIN_READ_MINUTES }-{ _MAX_READ_MINUTES } minute morning briefing.
Write about {word_target} words of markdown. No JSON. Do not wrap the whole answer in a code fence.
Stay strictly on the source article's technical content as it relates to: {stack} / {interests}.

HARD RULES — do NOT write about:
- career advice, interviews, portfolios, "what companies expect", soft skills
- generic "learn JavaScript / HTML / CSS" motivational fluff
- unrelated beginner roadmaps

ONLY write: concrete APIs, code patterns, architecture, debugging, configs, and tradeoffs from the source.
Do not invent APIs, URLs, or library names that are not in the source.

Reader: {profile.current_role or "developer"}, {profile.years_of_experience} years, stack: {stack}.

Title: {article.title}
URL: {article.url}
Source:
{body}

Use this structure:
## {article.title}
### Technical takeaway
### How it works (with a small code example if the source has one)
### Apply it on {stack} today
### Pitfalls
End with one markdown link to the source URL.
""".strip()


def _top_up_prompt(profile: UserProfile, articles: list[Article], needed: int, tail: str) -> str:
    titles = "\n".join(f"- {article.title}" for article in articles[:_TEACHING_ARTICLE_LIMIT])
    stack = ", ".join(profile.primary_tech_stack) or "software engineering"
    return f"""
Continue the same TECHNICAL morning briefing. Write {needed} more words of markdown.
No JSON. Do not repeat prior chapters.
No career advice, portfolios, interviews, or soft skills — only code, APIs, debugging, and architecture for {stack}.

Add: one worked example, one debugging checklist, one concrete next experiment.

Sources still in play:
{titles}

Last part already written:
{tail[-1500:]}
""".strip()


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
    model = genai.GenerativeModel(settings.GEMINI_MODEL)
    config: dict[str, Any] = {"max_output_tokens": max_output_tokens}
    if as_json:
        config["response_mime_type"] = "application/json"
    response = model.generate_content(prompt, generation_config=config)
    text = getattr(response, "text", "") or ""
    tokens = len(prompt.split()) * 2
    if as_json:
        return _parse_json_object(text), tokens
    return _strip_fences(text), tokens


def _generate_teaching_sections(
    profile: UserProfile,
    articles: list[Article],
) -> tuple[list[dict[str, Any]], int]:
    """Ask Gemini for long markdown chapters until we reach a 20 minute floor."""
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
    """Drop career / soft-skill posts before synthesis."""
    kept = [
        article
        for article in articles
        if not is_career_fluff(
            article.title,
            f"{article.summary or ''} {article.body_text or ''}",
            [*article.topics, *article.tech_stack],
        )
    ]
    return kept or articles


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
        if _words_in(working) < floor:
            # Last resort for offline mode: use longer technical source excerpts.
            long_scrape = _payload_from_articles(
                articles,
                max_total_words=ceiling,
                max_words_each=1200,
                article_limit=_ARTICLE_LIMIT,
            )
            working = _trim_sections([*working, *long_scrape["sections"]], ceiling)
        return working, tokens

    rounds = 0
    while _words_in(working) < floor and rounds < 4:
        rounds += 1
        needed = min(ceiling - _words_in(working), floor - _words_in(working))
        if needed < 300:
            break
        try:
            extra, used = _call_gemini(
                _top_up_prompt(profile, articles, needed, working[-1]["content"] if working else ""),
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
        long_scrape = _payload_from_articles(
            articles,
            max_total_words=ceiling,
            max_words_each=1000,
            article_limit=_ARTICLE_LIMIT,
        )
        working = _trim_sections([*working, *long_scrape["sections"]], ceiling)
        break

    if _words_in(working) < floor:
        raise RuntimeError(
            f"Digest too short ({_words_in(working)} words); "
            f"need at least {floor} words (~{_MIN_READ_MINUTES} min). "
            "Fill the user tech stack and retry when Gemini quota is available."
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
