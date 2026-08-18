"""Unit tests for the new Celery scrape/extract/generate/publish workers."""

from __future__ import annotations

from datetime import date

import pytest

from src.models.article import Article
from src.models.digest import DailyDigest, DigestContent, DigestSource
from src.models.profile import UserProfile
from src.workers import extractor_tasks, generator_tasks, publisher_tasks, scraper_tasks


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_scrape_inserts_thin_articles_and_returns_ids(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await UserProfile(user_id="u1", name="Dev", primary_tech_stack=["python"]).insert()
    monkeypatch.setattr(
        scraper_tasks,
        "_collect_payloads",
        lambda terms: [
            {
                "url": "https://dev.to/a",
                "title": "A",
                "source_domain": "dev.to",
                "topics": ["python"],
            }
        ],
    )

    ids = await scraper_tasks._scrape_for_user("u1")
    assert len(ids) == 1
    stored = await Article.get(ids[0])
    assert stored is not None
    assert stored.body_text == ""
    assert stored.title == "A"


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_scrape_returns_empty_when_profile_missing() -> None:
    ids = await scraper_tasks._scrape_for_user("missing")
    assert ids == []


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_extract_fills_body(monkeypatch: pytest.MonkeyPatch) -> None:
    article = Article(url="https://dev.to/a", title="A", source_domain="dev.to", body_text="")
    await article.insert()
    monkeypatch.setattr(
        extractor_tasks,
        "extract_body",
        lambda url: {"body_text": "hello python fastapi", "title": "A", "tags": ["python"]},
    )
    monkeypatch.setattr(extractor_tasks, "embed_text", lambda text: [0.1, 0.2])

    ids = await extractor_tasks._extract_articles([str(article.id)])
    loaded = await Article.get(article.id)
    assert ids == [str(article.id)]
    assert loaded is not None
    assert "hello" in loaded.body_text
    assert loaded.embedding == [0.1, 0.2]


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_generate_upserts_digest(monkeypatch: pytest.MonkeyPatch) -> None:
    await UserProfile(user_id="u1", name="Dev", primary_tech_stack=["python"]).insert()
    article = Article(
        url="https://dev.to/a",
        title="A",
        source_domain="dev.to",
        body_text="body " * 20,
    )
    await article.insert()

    fake = DailyDigest(
        user_id="u1",
        digest_date=date(2026, 8, 17),
        article_ids=[str(article.id)],
        content=DigestContent(headline="Hi"),
    )
    monkeypatch.setattr(generator_tasks, "synthesize_digest", lambda profile, articles: fake)

    digest_id = await generator_tasks._generate_digest([str(article.id)], "u1")
    assert digest_id
    stored = await DailyDigest.get(digest_id)
    assert stored is not None
    assert stored.content.headline == "Hi"


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_publish_records_served_urls() -> None:
    profile = UserProfile(user_id="u1", name="Dev")
    await profile.insert()
    digest = DailyDigest(
        user_id="u1",
        digest_date=date(2026, 8, 17),
        content=DigestContent(
            headline="Hi",
            sources=[
                DigestSource(
                    id=1,
                    title="A",
                    url="https://dev.to/a",
                    source_domain="dev.to",
                )
            ],
        ),
    )
    await digest.insert()

    published = await publisher_tasks._publish_digest(str(digest.id))
    assert published == str(digest.id)
    loaded = await UserProfile.find_one(UserProfile.user_id == "u1")
    assert loaded is not None
    assert str(loaded.learning_path.served_urls[0]).rstrip("/") == "https://dev.to/a"


def test_run_async_keeps_loop_open_across_calls() -> None:
    from src.workers.runtime import run_async

    async def once(value: int) -> int:
        return value

    assert run_async(once(1)) == 1
    assert run_async(once(2)) == 2


def test_celery_tasks_are_registered() -> None:
    assert scraper_tasks.scrape_sources.name.endswith("scrape_sources")
    assert extractor_tasks.extract_articles.name.endswith("extract_articles")
    assert generator_tasks.generate_digest.name.endswith("generate_digest")
    assert publisher_tasks.publish_digest.name.endswith("publish_digest")
