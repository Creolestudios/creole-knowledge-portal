"""Unit tests for the Strategy-A scrapers and the content-extraction layer.

All network access (httpx, feedparser, newspaper3k) is stubbed — these tests
cover the parsing, mapping and failure-tolerance logic only.
"""
from __future__ import annotations

import time
from datetime import datetime
from typing import Any

import pytest

from src.ai_pipeline import jina_crawler
from src.models.schemas import Article
from src.scrapers import (
    devto_scraper,
    extractor,
    fetch_devto_articles,
    fetch_hn_top_stories,
    hn_scraper,
    parse_rss_feed,
    rss_scraper,
)


def test_sources_by_kind_filters_the_registry() -> None:
    from src.config.source_registry import sources_by_kind

    rss_sources = sources_by_kind("rss")
    assert len(rss_sources) == 1
    assert rss_sources[0].name == "devto-feed"
    assert sources_by_kind("missing-kind") == []


def test_package_reexports_match_submodule_helpers() -> None:
    """Execute scrapers/__init__.py re-exports without calling the network."""
    import importlib

    from src import scrapers as scrapers_pkg

    importlib.reload(scrapers_pkg)
    assert scrapers_pkg.fetch_devto_articles is scrapers_pkg.devto_scraper.fetch_devto_articles
    assert scrapers_pkg.fetch_hn_top_stories is scrapers_pkg.hn_scraper.fetch_hn_top_stories
    assert scrapers_pkg.parse_rss_feed is scrapers_pkg.rss_scraper.parse_rss_feed
    assert list(scrapers_pkg.__all__) == [
        "fetch_devto_articles",
        "fetch_hn_top_stories",
        "parse_rss_feed",
    ]


def test_scraped_item_as_payload() -> None:
    from src.scrapers.base import ScrapedItem

    item = ScrapedItem(
        url="https://dev.to/post",
        title="Hello",
        source_domain="dev.to",
        author="Ada",
        published_at=datetime(2026, 1, 1, 12, 0, 0),
        summary="short",
        topics=["python"],
        engagement_score=1.5,
        authority_score=0.8,
        robots_allowed=False,
    )
    payload = item.as_payload()
    assert payload["title"] == "Hello"
    assert payload["source_domain"] == "dev.to"
    assert payload["topics"] == ["python"]
    assert payload["robots_allowed"] is False
    assert "url" in payload


def test_extract_article_content_bs4_h1_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx
    from src.scrapers import extractor

    html = "<html><body><h1>H1 Title Fallback</h1><p>" + ("Paragraph text content that is longer than thirty characters. " * 3) + "</p></body></html>"

    class _FakeResp:
        status_code = 200
        text = html

    class _FakeClient:
        def __init__(self, **_: object) -> None:
            pass

        def __enter__(self) -> _FakeClient:
            return self

        def __exit__(self, *_: object) -> None:
            return None

        def get(self, *_: object, **__: object) -> _FakeResp:
            return _FakeResp()

    monkeypatch.setattr(httpx, "Client", _FakeClient)

    # Force newspaper3k to fail/raise so it falls back to BeautifulSoup
    class _FailingArticle:
        def __init__(self, *_: object, **__: object) -> None:
            pass

        def download(self) -> None:
            raise RuntimeError("newspaper failed")


    monkeypatch.setattr(extractor, "Article", _FailingArticle)
    res = extractor.extract_article_content("https://example.com/h1-test")
    assert res is not None
    assert res["title"] == "H1 Title Fallback"


# ── shared doubles ────────────────────────────────────────────────────────────


class FakeResponse:
    def __init__(self, status_code: int = 200, payload: Any = None, text: str = "") -> None:
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self) -> Any:
        return self._payload


class FakeClient:
    """Sync httpx.Client stand-in; `router` maps a URL substring to a response."""

    def __init__(self, router: Any = None, raise_on_get: bool = False) -> None:
        self._router = router
        self._raise = raise_on_get

    def __enter__(self) -> FakeClient:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def get(self, url: str, **_: object) -> FakeResponse:
        if self._raise:
            raise RuntimeError("network unreachable")
        if callable(self._router):
            return self._router(url)
        return self._router


# ── extractor.get_domain ──────────────────────────────────────────────────────


class TestGetDomain:
    @pytest.mark.parametrize(
        ("url", "expected"),
        [
            ("https://www.example.com/post/1", "example.com"),
            ("https://blog.example.co.uk/x", "blog.example.co.uk"),
            ("http://example.com", "example.com"),
            ("not-a-url", ""),
        ],
    )
    def test_strips_scheme_and_www(self, url: str, expected: str) -> None:
        assert extractor.get_domain(url) == expected

    def test_returns_unknown_when_parsing_explodes(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def _boom(_: object) -> None:
            raise ValueError("bad url")

        monkeypatch.setattr(extractor.urllib.parse, "urlparse", _boom)
        assert extractor.get_domain("https://x.com") == "unknown"


# ── extractor.extract_article_content ─────────────────────────────────────────


class FakeNewspaperArticle:
    def __init__(
        self,
        text: str = "",
        title: str = "",
        authors: list[str] | None = None,
        tags: set[str] | None = None,
        explode: bool = False,
    ) -> None:
        self.text = text
        self.title = title
        self.authors = authors or []
        self.tags = tags or set()
        self._explode = explode

    def __call__(self, _url: str) -> FakeNewspaperArticle:
        return self

    def set_html(self, _html: str) -> None:
        return None

    def download(self) -> None:
        if self._explode:
            raise RuntimeError("download blocked")

    def parse(self) -> None:
        if self._explode:
            raise RuntimeError("parse failed")


class TestExtractArticleContent:
    def test_returns_newspaper_result_when_it_yields_text(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake = FakeNewspaperArticle(
            text="First para.\n\nSecond para.",
            title="Real Title",
            authors=["Ada", "Grace"],
            tags={"python"},
        )
        monkeypatch.setattr(extractor, "Article", lambda _u: fake)

        out = extractor.extract_article_content("https://x.com/a")
        assert out["title"] == "Real Title"
        assert out["author"] == "Ada, Grace"
        assert out["word_count"] == 4
        assert out["reading_time_min"] == 0.5  # floored at 0.5
        assert out["tags"] == ["python"]
        assert "First para." in out["body_markdown"]

    def test_uses_supplied_html_instead_of_downloading(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        fake = FakeNewspaperArticle(text="From html", title="T")
        monkeypatch.setattr(extractor, "Article", lambda _u: fake)

        out = extractor.extract_article_content("https://x.com/a", html_content="<p>x</p>")
        assert out["body_text"] == "From html"

    def test_author_is_none_when_newspaper_finds_no_authors(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            extractor, "Article", lambda _u: FakeNewspaperArticle(text="Body", authors=[])
        )
        assert extractor.extract_article_content("https://x.com/a")["author"] is None

    def test_falls_back_to_soup_when_newspaper_raises(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            extractor, "Article", lambda _u: FakeNewspaperArticle(explode=True)
        )
        html = (
            "<html><head><title>Soup Title</title></head><body>"
            "<script>ignored()</script>"
            "<p>" + ("a long enough paragraph " * 3) + "</p>"
            "<p>short</p>"
            "</body></html>"
        )
        monkeypatch.setattr(
            extractor.httpx, "Client", lambda **_: FakeClient(FakeResponse(200, text=html))
        )

        out = extractor.extract_article_content("https://x.com/a")
        assert out["title"] == "Soup Title"
        assert "long enough paragraph" in out["body_text"]
        assert "short" not in out["body_text"]  # under the 30-char threshold
        assert "ignored" not in out["body_text"]

    def test_soup_fallback_uses_the_url_as_title_when_no_title_tag(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            extractor, "Article", lambda _u: FakeNewspaperArticle(explode=True)
        )
        html = "<html><body><p>" + ("body text here " * 4) + "</p></body></html>"
        monkeypatch.setattr(
            extractor.httpx, "Client", lambda **_: FakeClient(FakeResponse(200, text=html))
        )

        out = extractor.extract_article_content("https://x.com/a")
        assert out["title"] == "https://x.com/a"

    def test_returns_the_empty_shape_when_both_strategies_fail(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            extractor, "Article", lambda _u: FakeNewspaperArticle(explode=True)
        )
        monkeypatch.setattr(
            extractor.httpx, "Client", lambda **_: FakeClient(raise_on_get=True)
        )

        out = extractor.extract_article_content("https://x.com/a")
        assert out["body_text"] == ""
        assert out["word_count"] == 0


# ── hn_scraper ────────────────────────────────────────────────────────────────


class TestHackerNewsScraper:
    def test_maps_top_stories_onto_articles(self, monkeypatch: pytest.MonkeyPatch) -> None:
        def router(url: str) -> FakeResponse:
            if "topstories" in url:
                return FakeResponse(200, [1, 2])
            return FakeResponse(
                200,
                {
                    "url": "https://example.com/story",
                    "title": "A Story",
                    "by": "author1",
                    "time": int(time.time()),
                },
            )

        monkeypatch.setattr(hn_scraper.httpx, "Client", lambda **_: FakeClient(router))

        out = fetch_hn_top_stories(limit=2)
        assert len(out) == 2
        assert out[0].source_domain == "example.com"
        assert out[0].author == "author1"
        assert "hacker-news" in out[0].tags
        assert out[0].strategy_source == "A"

    def test_skips_stories_without_a_url(self, monkeypatch: pytest.MonkeyPatch) -> None:
        def router(url: str) -> FakeResponse:
            if "topstories" in url:
                return FakeResponse(200, [1])
            return FakeResponse(200, {"title": "Ask HN: no link", "time": int(time.time())})

        monkeypatch.setattr(hn_scraper.httpx, "Client", lambda **_: FakeClient(router))
        assert fetch_hn_top_stories(limit=1) == []

    def test_returns_empty_when_the_index_call_fails(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            hn_scraper.httpx, "Client", lambda **_: FakeClient(FakeResponse(503))
        )
        assert fetch_hn_top_stories() == []

    def test_swallows_transport_errors(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            hn_scraper.httpx, "Client", lambda **_: FakeClient(raise_on_get=True)
        )
        assert fetch_hn_top_stories() == []

    def test_continues_past_a_single_bad_item(self, monkeypatch: pytest.MonkeyPatch) -> None:
        calls = {"n": 0}

        def router(url: str) -> FakeResponse:
            if "topstories" in url:
                return FakeResponse(200, [1, 2])
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("item fetch failed")
            return FakeResponse(
                200, {"url": "https://ok.com/x", "title": "Fine", "time": int(time.time())}
            )

        monkeypatch.setattr(hn_scraper.httpx, "Client", lambda **_: FakeClient(router))
        out = fetch_hn_top_stories(limit=2)
        assert len(out) == 1

    def test_skips_items_with_non_200_responses(self, monkeypatch: pytest.MonkeyPatch) -> None:
        def router(url: str) -> FakeResponse:
            if "topstories" in url:
                return FakeResponse(200, [1])
            return FakeResponse(404)

        monkeypatch.setattr(hn_scraper.httpx, "Client", lambda **_: FakeClient(router))
        assert fetch_hn_top_stories(limit=1) == []

    def test_returns_collected_articles_after_successful_fetch(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def router(url: str) -> FakeResponse:
            if "topstories" in url:
                return FakeResponse(200, [42])
            return FakeResponse(
                200,
                {
                    "url": "https://news.example/hn",
                    "title": "HN headline",
                    "by": "alice",
                    "time": int(time.time()),
                },
            )

        monkeypatch.setattr(hn_scraper.httpx, "Client", lambda **_: FakeClient(router))
        articles = fetch_hn_top_stories(limit=1)
        assert len(articles) == 1
        assert articles[0].title == "HN headline"
        assert articles[0].word_count == len("HN headline".split())


# ── devto_scraper ─────────────────────────────────────────────────────────────


class TestDevToScraper:
    def test_maps_api_payload_onto_articles(self, monkeypatch: pytest.MonkeyPatch) -> None:
        payload = [
            {
                "url": "https://dev.to/a/post",
                "title": "Dev Post",
                "description": "a short summary",
                "user": {"name": "Writer"},
                "published_at": "2026-08-01T10:00:00Z",
                "tag_list": ["python", "testing"],
            }
        ]
        monkeypatch.setattr(
            devto_scraper.httpx, "Client", lambda **_: FakeClient(FakeResponse(200, payload))
        )

        out = fetch_devto_articles(tag="Python", limit=5)
        assert len(out) == 1
        assert out[0].source_domain == "dev.to"
        assert out[0].author == "Writer"
        assert out[0].tags == ["python", "testing"]
        assert out[0].published_at is not None

    def test_skips_entries_without_a_url(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            devto_scraper.httpx,
            "Client",
            lambda **_: FakeClient(FakeResponse(200, [{"title": "no url"}])),
        )
        assert fetch_devto_articles() == []

    def test_falls_back_to_now_for_an_unparseable_timestamp(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = [
            {"url": "https://dev.to/a", "title": "T", "published_at": "not-a-date", "user": {}}
        ]
        monkeypatch.setattr(
            devto_scraper.httpx, "Client", lambda **_: FakeClient(FakeResponse(200, payload))
        )

        out = fetch_devto_articles()
        assert isinstance(out[0].published_at, datetime)

    def test_uses_the_query_tag_when_the_payload_has_none(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = [{"url": "https://dev.to/a", "title": "T", "user": {}, "tag_list": []}]
        monkeypatch.setattr(
            devto_scraper.httpx, "Client", lambda **_: FakeClient(FakeResponse(200, payload))
        )

        assert fetch_devto_articles(tag="rust")[0].tags == ["rust"]

    def test_defaults_the_tag_when_neither_is_supplied(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = [{"url": "https://dev.to/a", "title": "T", "user": {}, "tag_list": []}]
        monkeypatch.setattr(
            devto_scraper.httpx, "Client", lambda **_: FakeClient(FakeResponse(200, payload))
        )

        assert fetch_devto_articles()[0].tags == ["dev.to"]

    def test_returns_empty_on_a_non_200(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            devto_scraper.httpx, "Client", lambda **_: FakeClient(FakeResponse(429))
        )
        assert fetch_devto_articles() == []

    def test_swallows_transport_errors(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            devto_scraper.httpx, "Client", lambda **_: FakeClient(raise_on_get=True)
        )
        assert fetch_devto_articles() == []

    def test_skips_url_less_items_and_defaults_empty_fields(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = [
            {"title": "missing url"},
            {
                "url": "https://dev.to/kept",
                "title": "Kept",
                "description": None,
                "user": {},
                "published_at": None,
                "tag_list": None,
            },
        ]
        monkeypatch.setattr(
            devto_scraper.httpx, "Client", lambda **_: FakeClient(FakeResponse(200, payload))
        )
        out = fetch_devto_articles()
        assert len(out) == 1
        assert str(out[0].url) == "https://dev.to/kept"
        assert out[0].body_text == ""
        assert out[0].tags == ["dev.to"]
        assert isinstance(out[0].published_at, datetime)


# ── rss_scraper ───────────────────────────────────────────────────────────────


class FakeEntry:
    def __init__(self, **kw: Any) -> None:
        for k, v in kw.items():
            setattr(self, k, v)


class TestRssScraper:
    def test_maps_feed_entries_onto_articles(self, monkeypatch: pytest.MonkeyPatch) -> None:
        entry = FakeEntry(
            link="https://blog.example.com/post",
            title="RSS Post",
            summary="a summary body",
            author="Feed Author",
            published_parsed=time.localtime(),
            tags=[type("T", (), {"term": "python"})()],
        )
        monkeypatch.setattr(
            rss_scraper.feedparser, "parse", lambda _u: type("F", (), {"entries": [entry]})()
        )

        out = parse_rss_feed("https://blog.example.com/rss", limit=5)
        assert len(out) == 1
        assert out[0].title == "RSS Post"
        assert out[0].author == "Feed Author"
        assert out[0].tags == ["python"]
        assert out[0].source_domain == "blog.example.com"

    def test_skips_entries_without_a_link(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            rss_scraper.feedparser,
            "parse",
            lambda _u: type("F", (), {"entries": [FakeEntry(title="no link")]})(),
        )
        assert parse_rss_feed("https://x.com/rss") == []

    def test_defaults_title_and_tags_when_absent(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        entry = FakeEntry(link="https://x.com/p")
        monkeypatch.setattr(
            rss_scraper.feedparser, "parse", lambda _u: type("F", (), {"entries": [entry]})()
        )

        out = parse_rss_feed("https://x.com/rss")
        assert out[0].title == "Untitled Feed Item"
        assert out[0].tags == ["rss"]
        # body falls back to the title when there's no summary/description
        assert out[0].body_text == "Untitled Feed Item"

    def test_ignores_an_unparseable_published_date(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        entry = FakeEntry(link="https://x.com/p", title="T", published_parsed="garbage")
        monkeypatch.setattr(
            rss_scraper.feedparser, "parse", lambda _u: type("F", (), {"entries": [entry]})()
        )

        out = parse_rss_feed("https://x.com/rss")
        assert isinstance(out[0].published_at, datetime)

    def test_returns_empty_when_feedparser_raises(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        def _boom(_u: object) -> None:
            raise RuntimeError("bad feed")

        monkeypatch.setattr(rss_scraper.feedparser, "parse", _boom)
        assert parse_rss_feed("https://x.com/rss") == []

    def test_returns_multiple_articles_from_a_successful_feed(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        entries = [
            FakeEntry(link="https://x.com/a", title="A"),
            FakeEntry(link="https://x.com/b", title="B"),
        ]
        monkeypatch.setattr(
            rss_scraper.feedparser,
            "parse",
            lambda _u: type("F", (), {"entries": entries})(),
        )

        out = parse_rss_feed("https://x.com/rss", limit=2)
        assert len(out) == 2
        assert [article.title for article in out] == ["A", "B"]


# ── robots_cache ──────────────────────────────────────────────────────────────


class TestRobotsCache:
    def test_rejects_urls_without_a_host(self) -> None:
        from src.config import robots_cache as robots_mod

        robots_mod._cache.clear()
        assert robots_mod.is_url_allowed("not-a-url") is False

    def test_allows_fetching_when_robots_txt_cannot_be_loaded(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from src.config import robots_cache as robots_mod

        robots_mod._cache.clear()
        monkeypatch.setattr(robots_mod, "_load_parser", lambda _url: None)
        assert robots_mod.is_url_allowed("https://example.com/page") is True

    def test_reuses_cached_parser_within_the_ttl(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from types import SimpleNamespace

        from src.config import robots_cache as robots_mod

        robots_mod._cache.clear()
        calls = {"n": 0}

        class FakeParser:
            def can_fetch(self, _user_agent: str, _url: str) -> bool:
                return False

        def _load(_url: str) -> FakeParser:
            calls["n"] += 1
            return FakeParser()

        monkeypatch.setattr(robots_mod, "_load_parser", _load)
        monkeypatch.setattr(
            robots_mod,
            "get_scraping_settings",
            lambda: SimpleNamespace(ROBOTS_CACHE_TTL_SECONDS=3600),
        )

        assert robots_mod.is_url_allowed("https://example.com/page") is False
        assert robots_mod.is_url_allowed("https://example.com/other") is False
        assert calls["n"] == 1

    def test_allows_the_url_when_can_fetch_raises(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from types import SimpleNamespace

        from src.config import robots_cache as robots_mod

        robots_mod._cache.clear()

        class BrokenParser:
            def can_fetch(self, _user_agent: str, _url: str) -> bool:
                raise RuntimeError("parser blew up")

        monkeypatch.setattr(robots_mod, "_load_parser", lambda _url: BrokenParser())
        monkeypatch.setattr(
            robots_mod,
            "get_scraping_settings",
            lambda: SimpleNamespace(ROBOTS_CACHE_TTL_SECONDS=3600),
        )

        assert robots_mod.is_url_allowed("https://example.com/page") is True

    def test_load_parser_returns_none_for_http_errors(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from src.config import robots_cache as robots_mod

        class FakeResponse:
            status_code = 404
            text = ""

        class FakeClient:
            def __init__(self, *args: object, **kwargs: object) -> None:
                pass

            def __enter__(self) -> FakeClient:
                return self

            def __exit__(self, *_: object) -> None:
                return None

            def get(self, *_: object, **__: object) -> FakeResponse:
                return FakeResponse()

        monkeypatch.setattr(robots_mod.httpx, "Client", FakeClient)
        assert robots_mod._load_parser("https://example.com/robots.txt") is None

    def test_load_parser_parses_a_successful_robots_response(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from src.config import robots_cache as robots_mod

        class FakeResponse:
            status_code = 200
            text = "User-agent: *\nDisallow: /private\n"

        class FakeClient:
            def __init__(self, *args: object, **kwargs: object) -> None:
                pass

            def __enter__(self) -> FakeClient:
                return self

            def __exit__(self, *_: object) -> None:
                return None

            def get(self, *_: object, **__: object) -> FakeResponse:
                return FakeResponse()

        monkeypatch.setattr(robots_mod.httpx, "Client", FakeClient)
        parser = robots_mod._load_parser("https://example.com/robots.txt")
        assert parser is not None
        assert parser.can_fetch("CreoleKnowledgePortal/1.0", "https://example.com/public") is True
        assert parser.can_fetch("CreoleKnowledgePortal/1.0", "https://example.com/private/page") is False

    def test_load_parser_allows_on_transport_errors(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import httpx

        from src.config import robots_cache as robots_mod

        class FakeClient:
            def __init__(self, *args: object, **kwargs: object) -> None:
                pass

            def __enter__(self) -> FakeClient:
                return self

            def __exit__(self, *_: object) -> None:
                return None

            def get(self, *_: object, **__: object) -> None:
                raise httpx.ConnectError("offline")

        monkeypatch.setattr(robots_mod.httpx, "Client", FakeClient)
        assert robots_mod._load_parser("https://example.com/robots.txt") is None

    def test_robots_url_defaults_missing_scheme_to_https(self) -> None:
        from src.config.robots_cache import _robots_url

        assert _robots_url("//example.com/post") == "https://example.com/robots.txt"


# ── jina_crawler ──────────────────────────────────────────────────────────────


class TestJinaCrawler:
    def test_returns_the_mapped_payload_on_success(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = {"data": {"content": "word " * 500, "title": "Jina Title"}}
        monkeypatch.setattr(
            jina_crawler.httpx, "Client", lambda **_: FakeClient(FakeResponse(200, payload))
        )

        out = jina_crawler.fetch_via_jina("https://x.com/a")
        assert out is not None
        assert out["word_count"] == 500
        assert out["reading_time_min"] == 2.0
        assert out["title"] == "Jina Title"

    def test_accepts_the_text_key_as_a_content_alias(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        payload = {"data": {"text": "alt body"}}
        monkeypatch.setattr(
            jina_crawler.httpx, "Client", lambda **_: FakeClient(FakeResponse(200, payload))
        )
        out = jina_crawler.fetch_via_jina("https://x.com/a")
        assert out is not None and out["body_text"] == "alt body"

    def test_returns_none_for_an_empty_body(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            jina_crawler.httpx,
            "Client",
            lambda **_: FakeClient(FakeResponse(200, {"data": {"content": ""}})),
        )
        assert jina_crawler.fetch_via_jina("https://x.com/a") is None

    def test_returns_none_on_a_non_200(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            jina_crawler.httpx, "Client", lambda **_: FakeClient(FakeResponse(502))
        )
        assert jina_crawler.fetch_via_jina("https://x.com/a") is None

    def test_returns_none_on_a_transport_error(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            jina_crawler.httpx, "Client", lambda **_: FakeClient(raise_on_get=True)
        )
        assert jina_crawler.fetch_via_jina("https://x.com/a") is None

    def test_enrich_overwrites_body_fields_on_success(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            jina_crawler,
            "fetch_via_jina",
            lambda _u: {
                "body_text": "enriched body",
                "body_markdown": "# enriched",
                "word_count": 2,
                "reading_time_min": 0.5,
                "title": "New Title",
            },
        )
        art = Article(
            url="https://x.com/a", title="Keep Me", source_domain="x.com", body_text="old"
        )

        out = jina_crawler.enrich_article_via_jina(art)
        assert out.body_text == "enriched body"
        assert out.title == "Keep Me"  # existing title is preserved

    def test_enrich_fills_a_blank_title_from_jina(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            jina_crawler,
            "fetch_via_jina",
            lambda _u: {
                "body_text": "b",
                "body_markdown": "b",
                "word_count": 1,
                "reading_time_min": 0.5,
                "title": "Discovered Title",
            },
        )
        art = Article(url="https://x.com/a", title="", source_domain="x.com", body_text="old")

        assert jina_crawler.enrich_article_via_jina(art).title == "Discovered Title"

    def test_enrich_leaves_the_article_untouched_when_jina_returns_nothing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(jina_crawler, "fetch_via_jina", lambda _u: None)
        art = Article(
            url="https://x.com/a", title="T", source_domain="x.com", body_text="original"
        )

        assert jina_crawler.enrich_article_via_jina(art).body_text == "original"


class TestTopicFilter:
    def test_infer_topics_finds_known_keywords_and_prepends_extras(self) -> None:
        from src.extractors.topic_filter import infer_topics

        topics = infer_topics("Python and FastAPI are great", extra=["custom"])
        assert topics[0] == "custom"
        assert "python" in topics
        assert "fastapi" in topics
        assert infer_topics("hello world", extra=["  ", ""]) == []

    def test_infer_tech_stack_uses_topics_when_available(self) -> None:
        from src.extractors.topic_filter import infer_tech_stack

        assert infer_tech_stack("python fastapi", ["react", "go"]) == ["react", "go"]

    def test_infer_tech_stack_falls_back_to_infer_topics(self) -> None:
        from src.extractors.topic_filter import infer_tech_stack

        result = infer_tech_stack("python fastapi docker", [])
        assert "python" in result
        assert "fastapi" in result

    def test_infer_complexity_beginner_intermediate_advanced(self) -> None:
        from src.extractors.topic_filter import infer_complexity
        from src.models.article import ComplexityLevel

        short = "Hello world"
        assert infer_complexity(short) == ComplexityLevel.BEGINNER

        medium = "word " * 600 + "python docker"
        assert infer_complexity(medium) == ComplexityLevel.INTERMEDIATE

        long_jargon = (
            "word " * 2000
            + "python javascript typescript react fastapi docker kubernetes aws mongodb"
        )
        assert infer_complexity(long_jargon) == ComplexityLevel.ADVANCED
