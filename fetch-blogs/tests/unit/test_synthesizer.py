"""Digest synthesis should keep scraped article bodies, not the Gemini stub."""

from __future__ import annotations

import json

import pytest

from src.generator import synthesizer
from src.models.article import Article
from src.models.profile import UserProfile


def _article(title: str, body: str, url: str = "https://dev.to/a") -> Article:
    return Article(
        url=url,
        title=title,
        source_domain="dev.to",
        body_text=body,
    )


def test_payload_from_articles_uses_scraped_bodies() -> None:
    article = _article("Real MongoDB indexing guide", "Indexes speed up queries. " * 40)
    payload = synthesizer._payload_from_articles([article])

    assert payload["tldr"] == ["Real MongoDB indexing guide"]
    assert "Indexes speed up" in payload["sections"][0]["content"]
    assert "Personalized articles were ranked" not in str(payload)


def test_payload_from_articles_keeps_title_when_body_is_empty() -> None:
    article = _article("HN story", "")
    payload = synthesizer._payload_from_articles([article])

    assert payload["sections"][0]["title"] == "HN story"
    assert "HN story" in payload["sections"][0]["content"]
    assert "Personalized articles were ranked" not in str(payload)


def test_payload_from_articles_preserves_markdown_structure() -> None:
    body = "## Install uv\n\nRun this:\n\n```bash\nuv sync\n```\n"
    payload = synthesizer._payload_from_articles([_article("Setup", body)])
    content = payload["sections"][0]["content"]

    assert "## Install uv" in content
    assert "```bash" in content
    assert "\n" in content
    assert "uv sync" in content


def test_parse_json_object_unwraps_gemini_fences() -> None:
    parsed = synthesizer._parse_json_object('prefix {"headline": "Hi", "tldr": ["a"]} suffix')
    assert parsed["headline"] == "Hi"


def test_synthesize_digest_uses_scraped_bodies_when_gemini_json_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    profile = UserProfile(user_id="u1", name="Dev", primary_tech_stack=["mongodb"])
    article = _article(
        "Change streams in production",
        "MongoDB change streams let you watch inserts. " * 30,
        url="https://dev.to/change-streams",
    )

    def _boom(_prompt: str) -> tuple[dict, int]:
        raise json.JSONDecodeError("Expecting ',' delimiter", "{", 1)

    monkeypatch.setattr(synthesizer, "_call_gemini", _boom)

    digest = synthesizer.synthesize_digest(profile, [article])

    assert "Personalized articles were ranked" not in " ".join(digest.content.tldr)
    assert digest.content.sections[0].title == "Change streams in production"
    assert "change streams" in digest.content.sections[0].content.lower()
    assert str(digest.content.sources[0].url).rstrip("/") == "https://dev.to/change-streams"


def test_synthesize_digest_appends_scraped_sections_after_gemini_overview(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    profile = UserProfile(user_id="u1", name="Dev")
    article = _article("Redis queues", "Celery workers drain Redis. " * 20)

    monkeypatch.setattr(
        synthesizer,
        "_call_gemini",
        lambda _prompt: (
            {
                "headline": "Queues for your stack",
                "tldr": ["Celery plus Redis"],
                "sections": [
                    {
                        "title": "Why this matters today",
                        "content": "A short overview.",
                        "sources_cited": [1],
                        "estimated_read_minutes": 1.0,
                    }
                ],
                "key_takeaways": ["Watch the worker logs"],
            },
            12,
        ),
    )

    digest = synthesizer.synthesize_digest(profile, [article])

    assert digest.content.headline == "Queues for your stack"
    assert digest.content.tldr == ["Celery plus Redis"]
    assert digest.content.sections[0].title == "Why this matters today"
    assert digest.content.sections[1].title == "Redis queues"
    assert "Celery workers drain Redis" in digest.content.sections[1].content


def test_teaching_markdown_is_kept_in_the_briefing(monkeypatch: pytest.MonkeyPatch) -> None:
    profile = UserProfile(user_id="u1", name="Dev")
    article = _article("Redis queues", "Celery workers drain Redis. " * 20)

    def fake(prompt: str, *, as_json: bool = True, max_output_tokens: int = 2048) -> tuple:
        if as_json:
            return (
                {
                    "headline": "Queues for your stack",
                    "tldr": ["Celery plus Redis"],
                    "sections": [
                        {
                            "title": "Why this matters today",
                            "content": "Overview.",
                            "sources_cited": [1],
                        }
                    ],
                    "key_takeaways": ["Watch logs"],
                },
                12,
            )
        return ("Celery workers process jobs from Redis. " * 120, 40)

    monkeypatch.setattr(synthesizer, "_call_gemini", fake)
    digest = synthesizer.synthesize_digest(profile, [article])
    body = " ".join(section.content for section in digest.content.sections)
    assert "Celery workers process jobs from Redis" in body


def test_briefing_is_capped_at_25_minutes(monkeypatch: pytest.MonkeyPatch) -> None:
    profile = UserProfile(user_id="u1", name="Dev")
    article = _article("Long piece", "source " * 50)

    def fake(prompt: str, *, as_json: bool = True, max_output_tokens: int = 2048) -> tuple:
        if as_json:
            return ({"headline": "H", "tldr": ["t"], "sections": [], "key_takeaways": []}, 1)
        return ("chapter " * 8000, 1)

    monkeypatch.setattr(synthesizer, "_call_gemini", fake)
    digest = synthesizer.synthesize_digest(profile, [article])
    assert digest.word_count <= synthesizer._MAX_READ_MINUTES * synthesizer._WPM
    assert digest.reading_time_minutes <= synthesizer._MAX_READ_MINUTES
    assert digest.reading_time_minutes >= synthesizer._MIN_READ_MINUTES


def test_skips_teaching_when_scraped_bodies_already_cover_20_minutes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    profile = UserProfile(user_id="u1", name="Dev")
    article = _article("Long source", "scraped " * 5000)

    def _no_teaching(*_args: object, **_kwargs: object) -> tuple[list, int]:
        raise AssertionError("teaching should not run when scraped text is already long")

    monkeypatch.setattr(synthesizer, "_generate_teaching_sections", _no_teaching)
    monkeypatch.setattr(
        synthesizer,
        "_call_gemini",
        lambda *_args, **_kwargs: (
            {"headline": "H", "tldr": ["t"], "sections": [], "key_takeaways": []},
            1,
        ),
    )

    digest = synthesizer.synthesize_digest(profile, [article])
    assert "scraped" in digest.content.sections[-1].content
    assert digest.reading_time_minutes >= synthesizer._MIN_READ_MINUTES
    assert digest.reading_time_minutes <= synthesizer._MAX_READ_MINUTES


def test_devto_full_article_ignores_non_devto_urls() -> None:
    from src.extractors.crawl4ai_client import _devto_full_article

    assert _devto_full_article("https://news.ycombinator.com/item?id=1") is None
    assert _devto_full_article("https://dev.to/t/python") is None
