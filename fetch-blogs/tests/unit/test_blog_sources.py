"""Tests for admin blog_sources scrape helpers."""

from __future__ import annotations

import pytest

from src.services import blog_sources


def test_feed_candidates_adds_common_paths() -> None:
    cands = blog_sources._feed_candidates("https://blog.example.com/engineering")
    assert "https://blog.example.com/engineering" in cands
    assert "https://blog.example.com/engineering/feed" in cands
    assert "https://blog.example.com/engineering/rss.xml" in cands


def test_feed_candidates_skips_suffix_when_already_feed() -> None:
    cands = blog_sources._feed_candidates("https://blog.example.com/feed")
    assert cands == ["https://blog.example.com/feed"]


def test_feed_candidates_empty_url() -> None:
    assert blog_sources._feed_candidates("") == []
    assert blog_sources._feed_candidates("   ") == []


def test_scrape_admin_source_articles_tries_fallbacks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.models.schemas import Article as LegacyArticle

    calls: list[str] = []

    def fake_parse(feed_url: str, limit: int = 3):
        calls.append(feed_url)
        if feed_url.endswith("/rss.xml"):
            return [
                LegacyArticle(
                    url="https://blog.example.com/post-1",
                    title="Post",
                    source_domain="blog.example.com",
                    body_text="hello",
                )
            ]
        return []

    monkeypatch.setattr(blog_sources, "parse_rss_feed", fake_parse)
    out = blog_sources.scrape_admin_source_articles(
        ["https://blog.example.com"],
        limit_per_feed=2,
    )
    assert len(out) == 1
    assert any(c.endswith("/rss.xml") for c in calls)


@pytest.mark.asyncio
async def test_fetch_admin_blog_source_urls(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeResp:
        status_code = 200

        def json(self):
            return [
                {"url": "https://a.com/feed"},
                {"url": "https://a.com/feed"},
                {"url": "not-a-url"},
                {"url": "https://b.com/blog"},
            ]

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, *args, **kwargs):
            return FakeResp()

    class FakeKey:
        def get_secret_value(self):
            return "secret"

    class FakeCfg:
        URL = "https://example.supabase.co"
        ANON_KEY = FakeKey()
        SERVICE_ROLE_KEY = FakeKey()

    monkeypatch.setattr(blog_sources, "get_supabase_settings", lambda: FakeCfg())
    monkeypatch.setattr(blog_sources.httpx, "AsyncClient", lambda **_: FakeClient())
    urls = await blog_sources.fetch_admin_blog_source_urls()
    assert urls == ["https://a.com/feed", "https://b.com/blog"]


def test_scrape_admin_source_articles_handles_parse_errors_and_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def boom(feed_url: str, limit: int = 3):
        raise RuntimeError(f"bad feed {feed_url}")

    monkeypatch.setattr(blog_sources, "parse_rss_feed", boom)
    assert blog_sources.scrape_admin_source_articles(["https://empty.example"]) == []


@pytest.mark.asyncio
async def test_fetch_admin_blog_source_urls_non_200(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeResp:
        status_code = 500

        def json(self):
            return []

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, *args, **kwargs):
            return FakeResp()

    class FakeKey:
        def get_secret_value(self):
            return "secret"

    class FakeCfg:
        URL = "https://example.supabase.co"
        ANON_KEY = None
        SERVICE_ROLE_KEY = FakeKey()

    monkeypatch.setattr(blog_sources, "get_supabase_settings", lambda: FakeCfg())
    monkeypatch.setattr(blog_sources.httpx, "AsyncClient", lambda **_: FakeClient())
    assert await blog_sources.fetch_admin_blog_source_urls() == []


@pytest.mark.asyncio
async def test_fetch_admin_blog_source_urls_network_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, *args, **kwargs):
            raise RuntimeError("offline")

    class FakeKey:
        def get_secret_value(self):
            return "secret"

    class FakeCfg:
        URL = "https://example.supabase.co"
        ANON_KEY = FakeKey()
        SERVICE_ROLE_KEY = FakeKey()

    monkeypatch.setattr(blog_sources, "get_supabase_settings", lambda: FakeCfg())
    monkeypatch.setattr(blog_sources.httpx, "AsyncClient", lambda **_: FakeClient())
    assert await blog_sources.fetch_admin_blog_source_urls() == []


@pytest.mark.asyncio
async def test_fetch_admin_blog_source_urls_filters_schemes_news_and_cap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rows = (
        [{"url": ""}]
        + [{"url": "ftp://bad.example/feed"}]
        + [{"url": "http://upgrade.example/blog"}]
        + [{"url": "https://www.theverge.com/tech"}]
        + [{"url": f"https://learn{i}.example/feed"} for i in range(12)]
    )

    class FakeResp:
        status_code = 200

        def json(self):
            return rows

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, *args, **kwargs):
            return FakeResp()

    class FakeKey:
        def get_secret_value(self):
            return "secret"

    class FakeCfg:
        URL = "https://example.supabase.co"
        ANON_KEY = FakeKey()
        SERVICE_ROLE_KEY = FakeKey()

    monkeypatch.setattr(blog_sources, "get_supabase_settings", lambda: FakeCfg())
    monkeypatch.setattr(blog_sources.httpx, "AsyncClient", lambda **_: FakeClient())
    monkeypatch.setattr(
        blog_sources,
        "is_news_noise",
        lambda *_a, url="", **_k: "theverge.com" in url,
    )

    urls = await blog_sources.fetch_admin_blog_source_urls()
    assert "https://upgrade.example/blog" in urls
    assert all("theverge.com" not in u for u in urls)
    assert all(u.startswith("https://") for u in urls)
    assert len(urls) == blog_sources._MAX_ADMIN_FEEDS
