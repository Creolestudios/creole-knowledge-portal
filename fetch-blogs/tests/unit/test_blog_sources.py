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
