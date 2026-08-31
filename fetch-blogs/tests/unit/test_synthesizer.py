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
    assert payload["headline"] == "Real MongoDB indexing guide"
    assert "Indexes speed up" in payload["sections"][0]["content"]
    assert "Personalized articles were ranked" not in str(payload)


def test_payload_from_articles_keeps_title_when_body_is_empty() -> None:
    article = _article("HN story about Python asyncio", "")
    payload = synthesizer._payload_from_articles([article])

    assert payload["sections"][0]["title"] == "Overview / Summary"
    assert "Python asyncio" in payload["sections"][0]["content"]
    assert "Personalized articles were ranked" not in str(payload)


def test_payload_from_articles_preserves_markdown_structure() -> None:
    body = "## Install uv\n\nRun this:\n\n```bash\nuv sync\n```\n"
    payload = synthesizer._payload_from_articles([_article("Python setup with uv", body)])
    content = payload["sections"][0]["content"]

    assert "## Install uv" in content
    assert "```bash" in content
    assert "\n" in content
    assert "uv sync" in content


def test_parse_json_object_unwraps_gemini_fences() -> None:
    parsed = synthesizer._parse_json_object('prefix {"headline": "Hi", "tldr": ["a"]} suffix')
    assert parsed["headline"] == "Hi"


def test_parse_json_object_repairs_trailing_commas() -> None:
    raw = '{"headline": "Hi", "tldr": ["a",], "sections": [],}'
    parsed = synthesizer._parse_json_object(raw)
    assert parsed["headline"] == "Hi"
    assert parsed["tldr"] == ["a"]


def test_synthesize_digest_uses_continuity_when_gemini_json_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    profile = UserProfile(
        user_id="u1",
        name="Dev",
        interests=["mongodb"],
        primary_tech_stack=["mongodb"],
    )
    profile.learning_path.last_digest_headline = "Yesterday Mongo streams"
    article = _article(
        "Change streams in production",
        "MongoDB change streams let you watch inserts. " * 30,
        url="https://dev.to/change-streams",
    )

    def _boom(_prompt: str, **_kwargs: object) -> tuple[dict, int]:
        raise json.JSONDecodeError("Expecting ',' delimiter", "{", 1)

    monkeypatch.setattr(synthesizer, "_call_gemini", _boom)
    monkeypatch.setattr(synthesizer, "_min_words", lambda: 40)
    monkeypatch.setattr(synthesizer, "_max_words", lambda: 200)

    digest = synthesizer.synthesize_digest(profile, [article])

    assert digest.content.sections[0].title == "Brief"
    assert any("change streams" in s.content.lower() for s in digest.content.sections)
    assert str(digest.content.sources[0].url).rstrip("/") == "https://dev.to/change-streams"


def test_parse_json_object_repairs_raw_newlines_in_strings() -> None:
    raw = '{"headline": "Hi\nthere", "tldr": ["a"], "sections": []}'
    parsed = synthesizer._parse_json_object(raw)
    assert parsed["headline"] == "Hi\nthere"


def test_synthesize_digest_appends_scraped_sections_after_gemini_overview(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    profile = UserProfile(user_id="u1", name="Dev")
    article = _article("Redis queues", "Celery workers drain Redis. " * 20)

    monkeypatch.setattr(
        synthesizer,
        "_call_gemini",
        lambda _prompt, **_kwargs: (
            {
                "headline": "Queues for your stack",
                "tldr": ["Celery plus Redis"],
                "continuation": "Yesterday's Redis basics lead into Celery workers today.",
                "key_takeaways": ["Watch the worker logs"],
            },
            12,
        ),
    )
    monkeypatch.setattr(synthesizer, "_generate_teaching_sections", lambda *_: ([], 0))
    monkeypatch.setattr(synthesizer, "_min_words", lambda: 20)
    monkeypatch.setattr(synthesizer, "_max_words", lambda: 400)

    digest = synthesizer.synthesize_digest(profile, [article])

    assert digest.content.headline == "Queues for your stack"
    assert digest.content.tldr == ["Celery plus Redis"]
    assert digest.content.sections[0].title == "Brief"
    assert "Celery workers today" in digest.content.sections[0].content
    overview = next(s for s in digest.content.sections if s.title == "Overview / Summary")
    assert "Celery workers drain Redis" in overview.content


def test_call_gemini_raises_clear_quota_error(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Boom:
        def generate_content(self, *_a, **_k):
            raise RuntimeError(
                "429 You exceeded your current quota, please check your plan and billing details."
            )

    monkeypatch.setattr(
        synthesizer,
        "get_llm_settings",
        lambda: type("S", (), {"GEMINI_API_KEY": "k", "GEMINI_MODEL": "gemini-3.6-flash"})(),
    )

    import sys
    import types

    fake_genai = types.ModuleType("google.generativeai")
    fake_genai.configure = lambda **_: None
    fake_genai.GenerativeModel = lambda *_a, **_k: _Boom()
    monkeypatch.setitem(sys.modules, "google.generativeai", fake_genai)
    monkeypatch.setitem(sys.modules, "google", types.ModuleType("google"))

    with pytest.raises(synthesizer.GeminiQuotaExceeded, match="quota exceeded \\(429\\)"):
        synthesizer._call_gemini("hello", as_json=False)


def test_junk_pdf_headline_is_replaced_with_article_title(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    profile = UserProfile(user_id="u1", name="Dev", primary_tech_stack=["python"])
    profile.learning_path.last_digest_headline = "Eight_Worlds_Planetary_Archive.pdf"
    article = _article("Python asyncio patterns", "await gather tasks. " * 40)

    monkeypatch.setattr(
        synthesizer,
        "_call_gemini",
        lambda *_a, **_k: (_ for _ in ()).throw(
            __import__("json").JSONDecodeError("boom", "{", 0)
        ),
    )
    monkeypatch.setattr(synthesizer, "_generate_teaching_sections", lambda *_: ([], 0))
    monkeypatch.setattr(synthesizer, "_min_words", lambda: 10)
    monkeypatch.setattr(synthesizer, "_max_words", lambda: 400)

    digest = synthesizer.synthesize_digest(profile, [article])
    assert ".pdf" not in digest.content.headline.lower()
    assert "Next steps after:" not in digest.content.headline
    assert "Python asyncio" in digest.content.headline


def test_templated_gemini_headline_is_replaced_with_article_title(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    profile = UserProfile(user_id="u1", name="Dev")
    article = _article("Redis queues", "Celery workers drain Redis. " * 40)

    monkeypatch.setattr(
        synthesizer,
        "_call_gemini",
        lambda _prompt, **_: (
            {
                "headline": "Your Morning Python & AI Briefing",
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
        ),
    )
    monkeypatch.setattr(synthesizer, "_generate_teaching_sections", lambda *_: ([], 0))
    monkeypatch.setattr(synthesizer, "_min_words", lambda: 10)
    monkeypatch.setattr(synthesizer, "_max_words", lambda: 400)

    digest = synthesizer.synthesize_digest(profile, [article])
    assert digest.content.headline == "Redis queues"


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
    monkeypatch.setattr(synthesizer, "_min_words", lambda: 400)
    monkeypatch.setattr(synthesizer, "_max_words", lambda: 2000)
    monkeypatch.setattr(synthesizer, "_SCRAPE_EXCERPT_WORDS", 20)
    monkeypatch.setattr(synthesizer, "_SCRAPE_EXCERPT_TOTAL", 40)
    digest = synthesizer.synthesize_digest(profile, [article])
    body = " ".join(section.content for section in digest.content.sections)
    assert "Celery workers process jobs from Redis" in body


def test_briefing_is_capped_at_word_ceiling(monkeypatch: pytest.MonkeyPatch) -> None:
    profile = UserProfile(user_id="u1", name="Dev")
    article = _article("Long Python piece", "python asyncio source " * 50)

    def fake(prompt: str, *, as_json: bool = True, max_output_tokens: int = 2048) -> tuple:
        if as_json:
            return ({"headline": "H", "tldr": ["t"], "sections": [], "key_takeaways": []}, 1)
        return ("chapter " * 8000, 1)

    monkeypatch.setattr(synthesizer, "_call_gemini", fake)
    digest = synthesizer.synthesize_digest(profile, [article])
    assert digest.word_count <= synthesizer._WORD_CEILING
    assert digest.word_count >= synthesizer._WORD_FLOOR
    assert digest.reading_time_minutes <= synthesizer._MAX_READ_MINUTES
    assert digest.reading_time_minutes >= synthesizer._MIN_READ_MINUTES - 0.5


def test_teaching_still_runs_when_scraped_bodies_are_long(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Teaching chapters are the primary briefing; long scrapes stay as excerpts."""
    profile = UserProfile(user_id="u1", name="Dev")
    article = _article("Long Python source", "python asyncio scraped " * 5000)
    calls = {"teaching": 0}

    def _teaching(*_args: object, **_kwargs: object) -> tuple[list, int]:
        calls["teaching"] += 1
        return (
            [
                {
                    "title": "Deep dive",
                    "content": "teach " * 80,
                    "sources_cited": [1],
                    "estimated_read_minutes": 2.0,
                }
            ],
            1,
        )

    monkeypatch.setattr(synthesizer, "_generate_teaching_sections", _teaching)
    monkeypatch.setattr(synthesizer, "_SCRAPE_EXCERPT_WORDS", 10_000)
    monkeypatch.setattr(synthesizer, "_SCRAPE_EXCERPT_TOTAL", 10_000)
    monkeypatch.setattr(
        synthesizer,
        "_call_gemini",
        lambda *_args, **_kwargs: (
            {"headline": "H", "tldr": ["t"], "continuation": "c", "key_takeaways": []},
            1,
        ),
    )

    digest = synthesizer.synthesize_digest(profile, [article])
    assert calls["teaching"] == 1
    # Canonical normalize maps teaching into Brief / Code / Overview
    assert any(s.title in {"Brief", "Deep dive", "Overview / Summary"} for s in digest.content.sections)
    assert digest.word_count >= synthesizer._WORD_FLOOR
    assert digest.word_count <= synthesizer._WORD_CEILING


def test_pick_daily_theme_keeps_yesterday_python() -> None:
    profile = UserProfile(user_id="u1", primary_tech_stack=["react", "python"])
    profile.learning_path.last_topics = ["python"]
    articles = [
        _article("React hooks in 2026", "hooks", "https://dev.to/react"),
        _article("Python iterators", "yield", "https://dev.to/py"),
    ]
    assert synthesizer.pick_daily_theme(profile, articles) == "python"
    focused = synthesizer.focus_articles_on_theme(articles, "python")
    assert focused[0].title == "Python iterators"


def test_clip_to_words_and_markdown_helpers() -> None:
    assert synthesizer._clip_to_words("one two three", 0) == ""
    assert synthesizer._clip_to_words("one two three", 2) == "one two"

    cleaned = synthesizer._clean_scraped_markdown(
        "Intro {% include foo %} \nenter fullscreen mode\nBody"
    )
    assert "enter fullscreen mode" not in cleaned
    assert "{%" not in cleaned
    assert "Body" in cleaned

    assert synthesizer._strip_fences("```json\n{\"a\": 1}\n```") == '{"a": 1}'

    frontmatter = (
        "title: Kubeflow Without Kubernetes\n"
        "published: true\n"
        "description: Run JupyterLab and MLflow\n"
        "tags: #docker\n"
        "series: gubernator\n\n"
        "The Kubernetes Tax on ML\n"
    )
    stripped = synthesizer._strip_blog_frontmatter(frontmatter)
    assert "published:" not in stripped
    assert "tags:" not in stripped
    assert "Kubernetes Tax" in stripped


def test_theme_helpers_and_fallback_payload() -> None:
    profile = UserProfile(user_id="u1", primary_tech_stack=["Rust"])
    assert synthesizer.pick_daily_theme(profile, []) == "rust"
    assert synthesizer.pick_daily_theme(UserProfile(user_id="u2"), []) == "tech"
    # Whitespace-only stack terms are dropped by scrape_focus_terms, but the
    # primary_tech_stack fallback branch still runs and strips them.
    assert synthesizer.pick_daily_theme(
        UserProfile(user_id="u3", primary_tech_stack=["  "]),
        [],
    ) == ""

    articles = [_article("Title", "body")]
    assert synthesizer.focus_articles_on_theme(articles, "  ") == articles

    fallback = synthesizer._fallback_payload()
    assert fallback["headline"] == "Your Morning Technical Briefing"
    assert synthesizer._payload_from_articles([])["headline"] == "Your Morning Technical Briefing"

    long_first = _article("First", "word " * 5000)
    short_second = _article("Second", "more words")
    payload = synthesizer._payload_from_articles([long_first, short_second], max_total_words=10)
    assert len(payload["sections"]) == 1


def test_parse_json_object_and_trim_sections_edge_cases() -> None:
    with pytest.raises(json.JSONDecodeError):
        synthesizer._parse_json_object("no json object here")

    assert synthesizer._strip_fences("plain markdown") == "plain markdown"
    assert synthesizer._strip_fences("```json\npartial without closing fence") == (
        "partial without closing fence"
    )

    assert (
        synthesizer._trim_sections(
            [{"title": "Full", "content": "word " * 20, "sources_cited": [1]}],
            max_words=0,
        )
        == []
    )
    assert (
        synthesizer._trim_sections(
            [{"title": "Empty", "content": "   ", "sources_cited": [1]}],
            max_words=100,
        )
        == []
    )
    # Second section when the word budget was already exhausted by rounding.
    kept = synthesizer._trim_sections(
        [
            {"title": "A", "content": "one two three", "sources_cited": [1]},
            {"title": "B", "content": "four five", "sources_cited": [2]},
        ],
        max_words=3,
    )
    assert len(kept) == 1
    assert kept[0]["title"] == "A"


def test_call_gemini_requires_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeLLM:
        GEMINI_API_KEY = None
        GEMINI_MODEL = "gemini"

    monkeypatch.setattr(synthesizer, "get_llm_settings", lambda: FakeLLM())

    with pytest.raises(RuntimeError, match="GEMINI_API_KEY"):
        synthesizer._call_gemini("prompt")


def test_call_gemini_json_and_markdown_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    import google.generativeai as genai

    class FakeLLM:
        GEMINI_API_KEY = "test-key"
        GEMINI_MODEL = "gemini"

    class FakeResponse:
        text = '{"headline": "From Gemini"}'

    class FakeModel:
        def generate_content(self, prompt: str, generation_config: dict[str, object]) -> FakeResponse:
            assert generation_config["response_mime_type"] == "application/json"
            return FakeResponse()

    monkeypatch.setattr(synthesizer, "get_llm_settings", lambda: FakeLLM())
    monkeypatch.setattr(genai, "configure", lambda **_: None)
    monkeypatch.setattr(genai, "GenerativeModel", lambda _name: FakeModel())

    parsed, tokens = synthesizer._call_gemini("one two")
    assert parsed["headline"] == "From Gemini"
    assert tokens == 4

    FakeResponse.text = "```\nplain markdown\n```"

    class MarkdownModel:
        def generate_content(self, prompt: str, generation_config: dict[str, object]) -> FakeResponse:
            assert "response_mime_type" not in generation_config
            return FakeResponse()

    monkeypatch.setattr(genai, "GenerativeModel", lambda _name: MarkdownModel())
    text, _ = synthesizer._call_gemini("prompt", as_json=False)
    assert text == "plain markdown"


def test_generate_teaching_sections_handles_empty_short_and_failed_top_up(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    profile = UserProfile(user_id="u1")

    sections, tokens = synthesizer._generate_teaching_sections(profile, [])
    assert sections == []
    assert tokens == 0

    article = _article("Short chapter", "body")
    monkeypatch.setattr(synthesizer, "_call_gemini", lambda *_a, **_k: ("too short", 1))
    sections, tokens = synthesizer._generate_teaching_sections(profile, [article])
    assert sections == []
    assert tokens == 1

    long_article = _article("Long chapter", "word " * 120)

    def fake_call(prompt: str, *, as_json: bool = True, max_output_tokens: int = 2048) -> tuple:
        if as_json:
            return ({}, 0)
        if "Continue the same morning technical briefing" in prompt:
            raise RuntimeError("top-up failed")
        return ("chapter " * 120, 20)

    monkeypatch.setattr(synthesizer, "_call_gemini", fake_call)
    monkeypatch.setattr(synthesizer, "_min_words", lambda: 50)
    sections, tokens = synthesizer._generate_teaching_sections(profile, [long_article])
    assert sections
    assert tokens == 20


def test_generate_teaching_sections_stops_when_floor_is_reached(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    profile = UserProfile(user_id="u1")
    articles = [
        _article("First", "body"),
        _article("Second", "body"),
    ]

    def fake_call(prompt: str, *, as_json: bool = True, max_output_tokens: int = 2048) -> tuple:
        return ("chapter " * 120, 10)

    monkeypatch.setattr(synthesizer, "_call_gemini", fake_call)
    monkeypatch.setattr(synthesizer, "_min_words", lambda: 100)
    sections, tokens = synthesizer._generate_teaching_sections(profile, articles)
    assert len(sections) == 1
    assert tokens == 10


def test_generate_teaching_top_up_failure_is_logged_not_fatal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    profile = UserProfile(user_id="u1")
    article = _article("Chapter", "body")

    def fake_call(prompt: str, *, as_json: bool = True, max_output_tokens: int = 2048) -> tuple:
        if "Continue the same TECHNICAL morning briefing" in prompt:
            raise RuntimeError("top-up failed")
        return ("chapter " * 120, 20)

    monkeypatch.setattr(synthesizer, "_call_gemini", fake_call)
    monkeypatch.setattr(synthesizer, "_min_words", lambda: 700)
    monkeypatch.setattr(synthesizer, "_max_words", lambda: 6000)
    sections, tokens = synthesizer._generate_teaching_sections(profile, [article])
    assert len(sections) == 1
    assert tokens == 20


def test_synthesize_digest_with_scraped_only_and_custom_date(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from datetime import date

    profile = UserProfile(user_id="u1", name="Dev")
    article = _article("Redis queues", "Celery workers drain Redis. " * 200)
    monkeypatch.setattr(synthesizer, "_min_words", lambda: 50)
    monkeypatch.setattr(synthesizer, "_max_words", lambda: 5000)

    digest = synthesizer.synthesize_digest(
        profile,
        [article],
        digest_date=date(2026, 1, 2),
        scraped_only=True,
    )

    assert digest.digest_date == date(2026, 1, 2)
    assert digest.content.sections[0].title == "Brief"
    assert digest.metrics.llm_tokens_used == 0


def test_devto_full_article_ignores_non_devto_urls() -> None:
    from src.extractors.article_body import _devto_full_article

    assert _devto_full_article("https://news.ycombinator.com/item?id=1") is None
    assert _devto_full_article("https://dev.to/t/python") is None


def test_extract_body_returns_long_devto_article(monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx

    from src.extractors.article_body import extract_body

    body = "word " * 250

    class _Resp:
        status_code = 200

        def json(self) -> dict[str, object]:
            return {
                "title": "Dev post",
                "body_markdown": body,
                "tag_list": "python",
                "user": {"name": "Ada"},
            }

    class _Client:
        def __init__(self, **_: object) -> None:
            pass

        def __enter__(self) -> _Client:
            return self

        def __exit__(self, *_: object) -> None:
            return None

        def get(self, *_: object, **__: object) -> _Resp:
            return _Resp()

    monkeypatch.setattr(httpx, "Client", _Client)
    result = extract_body("https://www.dev.to/ada/my-post")
    assert result["title"] == "Dev post"
    assert result["author"] == "Ada"
    assert result["tags"] == ["python"]
    assert result["word_count"] >= 200


def test_extract_body_falls_back_to_newspaper_then_jina(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import httpx

    from src.extractors import article_body as extract_mod

    class _Resp:
        status_code = 200

        def json(self) -> dict[str, object]:
            return {"title": "Thin", "body_markdown": "short body", "tag_list": ["ai"], "user": {}}

    class _Client:
        def __init__(self, **_: object) -> None:
            pass

        def __enter__(self) -> _Client:
            return self

        def __exit__(self, *_: object) -> None:
            return None

        def get(self, *_: object, **__: object) -> _Resp:
            return _Resp()

    monkeypatch.setattr(httpx, "Client", _Client)
    monkeypatch.setattr(
        extract_mod,
        "extract_article_content",
        lambda _url: {"body_text": "newspaper " * 40, "title": "NP"},
    )
    result = extract_mod.extract_body("https://dev.to/ada/thin-post")
    assert "newspaper" in result["body_text"]

    monkeypatch.setattr(extract_mod, "extract_article_content", lambda _url: {"body_text": ""})
    monkeypatch.setattr(
        extract_mod,
        "fetch_via_jina",
        lambda _url: {"body_text": "jina " * 40, "title": "Jina"},
    )
    jina_result = extract_mod.extract_body("https://dev.to/ada/thin-post")
    assert "jina" in jina_result["body_text"]


def test_extract_body_returns_empty_when_all_sources_fail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.extractors import article_body as extract_mod

    monkeypatch.setattr(extract_mod, "_devto_full_article", lambda _url: None)
    monkeypatch.setattr(extract_mod, "extract_article_content", lambda _url: {"body_text": ""})
    monkeypatch.setattr(extract_mod, "fetch_via_jina", lambda _url: None)
    result = extract_mod.extract_body("https://example.com/none")
    assert result["body_text"] == ""


def test_devto_full_article_handles_http_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx

    from src.extractors.article_body import _devto_full_article

    class _Bad:
        status_code = 404

        def json(self) -> dict[str, object]:
            return {}

    class _Client:
        def __init__(self, **_: object) -> None:
            pass

        def __enter__(self) -> _Client:
            return self

        def __exit__(self, *_: object) -> None:
            return None

        def get(self, *_: object, **__: object) -> _Bad:
            return _Bad()

    monkeypatch.setattr(httpx, "Client", _Client)
    assert _devto_full_article("https://dev.to/ada/missing") is None

    class _BoomClient(_Client):
        def get(self, *_: object, **__: object) -> _Bad:
            raise RuntimeError("timeout")

    monkeypatch.setattr(httpx, "Client", _BoomClient)
    assert _devto_full_article("https://dev.to/ada/missing") is None


def test_devto_full_article_ignores_empty_markdown(monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx

    from src.extractors.article_body import _devto_full_article

    class _Resp:
        status_code = 200

        def json(self) -> dict[str, object]:
            return {"title": "T", "body_markdown": "  ", "tag_list": [], "user": "not-a-dict"}

    class _Client:
        def __init__(self, **_: object) -> None:
            pass

        def __enter__(self) -> _Client:
            return self

        def __exit__(self, *_: object) -> None:
            return None

        def get(self, *_: object, **__: object) -> _Resp:
            return _Resp()

    monkeypatch.setattr(httpx, "Client", _Client)
    assert _devto_full_article("https://dev.to/ada/empty") is None


def test_previous_briefing_block_includes_yesterday_headline() -> None:
    from src.models.profile import LearningPath

    profile = UserProfile(
        user_id="u1",
        learning_path=LearningPath(
            last_digest_headline="Redis queues in production",
            last_digest_tldr=["Use Celery with Redis"],
            last_digest_takeaways=["Watch worker backlog"],
            last_topics=["redis", "celery"],
        ),
    )
    block = synthesizer._previous_briefing_block(profile)
    assert "Redis queues in production" in block
    assert "ACTIVE STACK RUN" in block
    assert "Celery with Redis" in block
    assert "YESTERDAY'S BRIEFING" in block


def test_previous_briefing_block_first_day_has_no_fake_yesterday() -> None:
    profile = UserProfile(user_id="u-new", primary_tech_stack=["python"])
    block = synthesizer._previous_briefing_block(profile)
    assert "FIRST BRIEFING" in block
    assert "YESTERDAY'S BRIEFING" not in block
    assert "Do NOT mention yesterday" in block
    assert synthesizer._has_previous_briefing(profile) is False

    opening = synthesizer._continuity_opening(profile, [_article("Python asyncio", "body")])
    brief = opening["sections"][0]["content"]
    assert "Yesterday covered" not in brief
    assert "introduces" in brief.lower() or "Today's briefing" in brief


def test_enforce_min_length_raises_when_sources_too_thin(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    profile = UserProfile(user_id="u1")
    article = _article("Tiny", "short body only")

    def _boom(*_a: object, **_k: object) -> tuple[str, int]:
        raise RuntimeError("gemini down")

    monkeypatch.setattr(synthesizer, "_call_gemini", _boom)
    monkeypatch.setattr(synthesizer, "_min_words", lambda: 500)
    monkeypatch.setattr(synthesizer, "_max_words", lambda: 600)

    with pytest.raises(RuntimeError, match="Digest too short"):
        synthesizer._enforce_min_length(
            profile,
            [article],
            [synthesizer._section("Overview / Summary", "tiny", [1])],
            0,
            scraped_only=False,
        )


def test_enforce_min_length_pads_near_miss_shortfall(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """4489/4500-style shortfalls should pad from source bodies, not fail."""
    profile = UserProfile(user_id="u1")
    # Long body so pad has material to pull from
    body = ("Redis streams buffer events for consumers. " * 200)
    article = _article("Redis streams", body)
    # Start just under the floor
    almost = "word " * 90
    monkeypatch.setattr(synthesizer, "_call_gemini", lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("skip")))
    monkeypatch.setattr(synthesizer, "_min_words", lambda: 100)
    monkeypatch.setattr(synthesizer, "_max_words", lambda: 5000)

    sections, _ = synthesizer._enforce_min_length(
        profile,
        [article],
        [synthesizer._section("Overview / Summary", almost, [1])],
        0,
        scraped_only=False,
    )
    assert synthesizer._words_in(sections) >= 100


def test_normalize_digest_sections_enforces_canonical_titles() -> None:
    messy = [
        {
            "title": "Continuation from yesterday",
            "content": "Yesterday we covered hooks. Today we deepen effects.",
            "sources_cited": [1],
        },
        {
            "title": "Some random article title",
            "content": (
                "## Brief\n\nHook into the render cycle carefully.\n\n"
                "## Overview / Summary\n\n"
                "Effects run after paint.\n\n"
                "```ts\nuseEffect(() => {}, []);\n```\n"
            ),
            "sources_cited": [2],
        },
        {
            "title": "Going deeper",
            "content": "Cleanup functions avoid leaks.",
            "sources_cited": [2],
        },
    ]
    out = synthesizer._normalize_digest_sections(messy)
    titles = [s["title"] for s in out]
    assert titles == ["Brief", "Code Snippet", "Overview / Summary"]
    assert "useEffect" in out[1]["content"]
    assert "```" in out[1]["content"]
    assert "Yesterday we covered hooks" in out[0]["content"]
    assert "Effects run after paint" in out[2]["content"]
    assert "Cleanup functions" in out[2]["content"]

