"""Unit tests for the new Celery scrape/extract/generate/publish workers."""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace

import pytest

from src.models.article import Article
from src.models.digest import DailyDigest, DigestContent, DigestMetrics, DigestSource
from src.models.job import JobStatus, PipelineJob, PipelineStage
from src.models.profile import LearningPath, UserProfile
from src.publisher import mongo_publisher
from src.workers import extractor_tasks, generator_tasks, publisher_tasks, scraper_tasks


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_scrape_inserts_thin_articles_and_returns_ids(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await UserProfile(
        user_id="u1",
        name="Dev",
        interests=["python"],
        primary_tech_stack=["python"],
    ).insert()
    monkeypatch.setattr(
        scraper_tasks,
        "_collect_payloads",
        lambda terms, **_kwargs: [
            {
                "url": "https://dev.to/a",
                "title": "Python tips",
                "summary": "python asyncio",
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
    assert stored.title == "Python tips"


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
        lambda url: {
            "body_text": "hello python fastapi",
            "title": "A",
            "author": "Ada",
            "summary": "short summary",
            "tags": ["python"],
        },
    )
    monkeypatch.setattr(extractor_tasks, "embed_text", lambda text: [0.1, 0.2])

    ids = await extractor_tasks._extract_articles([str(article.id)])
    loaded = await Article.get(article.id)
    assert ids == [str(article.id)]
    assert loaded is not None
    assert "hello" in loaded.body_text
    assert loaded.author == "Ada"
    assert loaded.summary == "short summary"
    assert loaded.embedding == [0.1, 0.2]


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_extract_skips_missing_long_and_empty_then_stops_at_target(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    missing_id = "a" * 24
    long_article = Article(
        url="https://dev.to/long",
        title="Long",
        source_domain="dev.to",
        body_text=("word " * 500).strip(),
        embedding=[0.9],
    )
    await long_article.insert()
    empty_extract = Article(
        url="https://dev.to/empty",
        title="Empty",
        source_domain="dev.to",
        body_text="",
    )
    await empty_extract.insert()
    already_embedded = Article(
        url="https://dev.to/thin",
        title="Thin",
        source_domain="dev.to",
        body_text="short",
        embedding=[1.0, 2.0],
    )
    await already_embedded.insert()

    extract_calls: list[str] = []
    embed_calls: list[str] = []

    def _extract(url: str) -> dict[str, object]:
        extract_calls.append(url)
        if "empty" in url:
            return {"body_text": "", "title": "  ", "tags": "not-a-list"}
        return {
            "body_text": "python fastapi coverage " * 30,
            "title": "Enriched",
            "tags": ["python"],
        }

    monkeypatch.setattr(extractor_tasks, "extract_body", _extract)
    monkeypatch.setattr(
        extractor_tasks, "embed_text", lambda text: (embed_calls.append(text), [9.0])[1]
    )
    monkeypatch.setattr(
        extractor_tasks,
        "get_scraping_settings",
        lambda: SimpleNamespace(DIGEST_WORD_TARGET=10_000),
    )

    ids = await extractor_tasks._extract_articles(
        [
            missing_id,
            str(long_article.id),
            str(empty_extract.id),
            str(already_embedded.id),
        ]
    )
    assert ids == [
        str(long_article.id),
        str(empty_extract.id),
        str(already_embedded.id),
    ]
    assert all("long" not in url for url in extract_calls)
    assert any("empty" in url for url in extract_calls)
    assert embed_calls == []

    empty_loaded = await Article.get(empty_extract.id)
    assert empty_loaded is not None
    assert empty_loaded.body_text == ""

    thin_loaded = await Article.get(already_embedded.id)
    assert thin_loaded is not None
    assert thin_loaded.title == "Enriched"
    assert thin_loaded.embedding == [1.0, 2.0]


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_extract_stops_once_word_target_is_met(monkeypatch: pytest.MonkeyPatch) -> None:
    first = Article(
        url="https://dev.to/first",
        title="First",
        source_domain="dev.to",
        body_text=("word " * 500).strip(),
    )
    second = Article(
        url="https://dev.to/second",
        title="Second",
        source_domain="dev.to",
        body_text="tiny",
    )
    await first.insert()
    await second.insert()
    monkeypatch.setattr(
        extractor_tasks, "extract_body", lambda url: {"body_text": "should not run"}
    )
    monkeypatch.setattr(
        extractor_tasks,
        "get_scraping_settings",
        lambda: SimpleNamespace(DIGEST_WORD_TARGET=400),
    )

    ids = await extractor_tasks._extract_articles([str(first.id), str(second.id)])
    assert ids == [str(first.id)]


def test_extract_articles_task_runs_empty_and_none_ids(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _ready() -> None:
        return None

    monkeypatch.setattr(extractor_tasks, "ensure_db", _ready)
    assert extractor_tasks.extract_articles([]) == []
    assert extractor_tasks.extract_articles(None) == []  # type: ignore[arg-type]


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
async def test_generate_raises_when_profile_missing() -> None:
    with pytest.raises(RuntimeError, match="profile missing"):
        await generator_tasks._generate_digest(
            ["507f1f77bcf86cd799439011"], "missing-user"
        )


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_generate_raises_when_no_articles_resolve() -> None:
    await UserProfile(user_id="u1", name="Dev").insert()
    with pytest.raises(RuntimeError, match="no articles available"):
        await generator_tasks._generate_digest(
            ["507f1f77bcf86cd799439011"], "u1"
        )


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_generate_skips_missing_article_ids(monkeypatch: pytest.MonkeyPatch) -> None:
    await UserProfile(user_id="u1", name="Dev", primary_tech_stack=["python"]).insert()
    article = Article(
        url="https://dev.to/b",
        title="B",
        source_domain="dev.to",
        body_text="body " * 20,
    )
    await article.insert()

    fake = DailyDigest(
        user_id="u1",
        digest_date=date(2026, 8, 17),
        article_ids=[str(article.id)],
        content=DigestContent(headline="Partial"),
    )
    monkeypatch.setattr(generator_tasks, "synthesize_digest", lambda profile, articles: fake)

    digest_id = await generator_tasks._generate_digest(
        [str(article.id), "507f1f77bcf86cd799439011"],
        "u1",
    )
    assert digest_id


def test_generate_digest_task_coerces_none_and_empty_ids(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _ready() -> None:
        return None

    monkeypatch.setattr(generator_tasks, "ensure_db", _ready)
    assert generator_tasks.generate_digest([], "u1") == ""
    assert generator_tasks.generate_digest(None, "u1") == ""  # type: ignore[arg-type]


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_publish_records_served_urls(monkeypatch: pytest.MonkeyPatch) -> None:
    def _fake_embed(profile: UserProfile, **_kwargs: object) -> list[float]:
        profile.learning_path.last_digest_embedding = [0.5]
        return [0.5]

    monkeypatch.setattr(mongo_publisher, "embed_and_store_digest", _fake_embed)
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


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_upsert_digest_inserts_then_replaces_existing_row() -> None:
    original = DailyDigest(
        user_id="u1",
        digest_date=date(2026, 8, 17),
        article_ids=["a1"],
        word_count=100,
        content=DigestContent(headline="First"),
        metrics=DigestMetrics(articles_used=1),
    )
    digest_id = await mongo_publisher.upsert_digest(original)
    assert digest_id

    replacement = DailyDigest(
        user_id="u1",
        digest_date=date(2026, 8, 17),
        article_ids=["a1", "a2"],
        word_count=250,
        reading_time_minutes=9.0,
        strategy_used="B",
        content=DigestContent(headline="Updated"),
        metrics=DigestMetrics(articles_used=2),
    )
    same_id = await mongo_publisher.upsert_digest(replacement)
    assert same_id == digest_id

    loaded = await DailyDigest.get(digest_id)
    assert loaded is not None
    assert loaded.content.headline == "Updated"
    assert loaded.article_ids == ["a1", "a2"]
    assert loaded.word_count == 250
    assert loaded.strategy_used == "B"
    assert loaded.metrics.articles_used == 2


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_record_served_urls_deduplicates_and_caps_history(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _fake_embed(profile: UserProfile, **_kwargs: object) -> list[float]:
        profile.learning_path.last_digest_embedding = [0.1, 0.2]
        profile.profile_embedding = [0.1, 0.2]
        return [0.1, 0.2]

    monkeypatch.setattr(mongo_publisher, "embed_and_store_digest", _fake_embed)
    existing_urls = [f"https://example.com/{index}" for index in range(99)]
    profile = UserProfile(
        user_id="u1",
        name="Dev",
        learning_path=LearningPath(served_urls=existing_urls),
    )
    await profile.insert()

    digest = DailyDigest(
        user_id="u1",
        digest_date=date(2026, 8, 18),
        content=DigestContent(
            headline="Brief",
            sources=[
                DigestSource(id=1, title="Python async patterns", url="https://dev.to/a"),
                DigestSource(id=2, title="Python async patterns", url="https://dev.to/a"),
                DigestSource(id=3, title="Rust ownership guide", url="https://example.com/new"),
            ],
        ),
    )

    await mongo_publisher.record_served_urls(digest, profile)

    loaded = await UserProfile.find_one(UserProfile.user_id == "u1")
    assert loaded is not None
    served = [str(url) for url in loaded.learning_path.served_urls]
    assert served.count("https://dev.to/a") == 1
    assert "https://example.com/new" in served
    assert len(served) == 100
    assert served[-1] == "https://example.com/new"
    assert loaded.learning_path.last_topics
    assert "python" in loaded.learning_path.last_topics
    assert loaded.learning_path.last_digest_embedding == [0.1, 0.2]

@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_publish_returns_empty_for_blank_digest_id() -> None:
    assert await publisher_tasks._publish_digest("") == ""


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_publish_returns_empty_when_digest_is_missing() -> None:
    assert await publisher_tasks._publish_digest("507f1f77bcf86cd799439011") == ""


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_publish_returns_digest_id_when_profile_is_missing() -> None:
    digest = DailyDigest(
        user_id="orphan",
        digest_date=date(2026, 8, 17),
        content=DigestContent(headline="Hi"),
    )
    await digest.insert()
    assert await publisher_tasks._publish_digest(str(digest.id)) == str(digest.id)


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_publish_marks_the_latest_pipeline_job_succeeded() -> None:
    await UserProfile(user_id="u1", name="Dev").insert()
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
    await PipelineJob(
        job_id="job-publish",
        user_id="u1",
        status=JobStatus.RUNNING,
        current_stage=PipelineStage.GENERATE,
    ).insert()

    published = await publisher_tasks._publish_digest(str(digest.id))
    assert published == str(digest.id)

    loaded_job = await PipelineJob.find_one(PipelineJob.job_id == "job-publish")
    assert loaded_job is not None
    assert loaded_job.status is JobStatus.SUCCEEDED
    assert loaded_job.current_stage is PipelineStage.PUBLISH
    assert loaded_job.digest_id == str(digest.id)
    assert loaded_job.stages["publish"].status is JobStatus.SUCCEEDED


def test_publish_digest_task_runs_through_run_async(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _ready() -> None:
        return None

    monkeypatch.setattr(publisher_tasks, "ensure_db", _ready)
    assert publisher_tasks.publish_digest("") == ""


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_mark_stage_noops_without_a_job() -> None:
    from src.workers.runtime import mark_stage

    await mark_stage(None, PipelineStage.SCRAPE, status=JobStatus.RUNNING)


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_mark_stage_persists_running_and_failed_progress() -> None:
    from src.workers.runtime import mark_stage

    job = PipelineJob(job_id="job-stage", user_id="u1", status=JobStatus.PENDING)
    await job.insert()

    await mark_stage(job, PipelineStage.SCRAPE, status=JobStatus.RUNNING, items_in=4)
    running = await PipelineJob.find_one(PipelineJob.job_id == "job-stage")
    assert running is not None
    assert running.status is JobStatus.RUNNING
    assert running.current_stage is PipelineStage.SCRAPE
    assert running.stages["scrape"].items_in == 4
    assert running.stages["scrape"].started_at is not None

    await mark_stage(
        job,
        PipelineStage.SCRAPE,
        status=JobStatus.FAILED,
        items_in=4,
        items_out=0,
        error="scrape failed",
    )
    failed = await PipelineJob.find_one(PipelineJob.job_id == "job-stage")
    assert failed is not None
    assert failed.status is JobStatus.FAILED
    assert failed.error == "scrape failed"
    assert failed.stages["scrape"].finished_at is not None


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_ensure_db_bootstraps_beanie_when_the_collection_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.workers import runtime as runtime_mod

    called: list[int] = []

    def _missing_collection() -> None:
        raise RuntimeError("beanie not ready")

    async def _init_db() -> None:
        called.append(1)

    monkeypatch.setattr(runtime_mod.Article, "get_motor_collection", _missing_collection)
    monkeypatch.setattr(runtime_mod, "init_db", _init_db)

    await runtime_mod.ensure_db()
    assert called == [1]


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


def test_matches_terms_treats_empty_filters_as_match_all() -> None:
    assert scraper_tasks._matches_terms("Python async", ["java"]) is False
    assert scraper_tasks._matches_terms("Python async", ["python"]) is True
    assert scraper_tasks._matches_terms("Anything", []) is True


def test_matches_terms_does_not_match_go_inside_golf() -> None:
    assert scraper_tasks._matches_terms("Early Golf Habits", ["go"]) is False
    assert scraper_tasks._matches_terms("Writing Go concurrency", ["go"]) is True


def test_collect_payloads_deduplicates_filters_hn_and_rss(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.models.schemas import Article as LegacyArticle

    devto = LegacyArticle(
        url="https://dev.to/python-post",
        title="Python tips",
        source_domain="dev.to",
        body_text="python",
    )
    hn_match = LegacyArticle(
        url="https://news.ycombinator.com/item?id=1",
        title="Go concurrency",
        source_domain="news.ycombinator.com",
        body_text="",
    )
    hn_other = LegacyArticle(
        url="https://news.ycombinator.com/item?id=2",
        title="Unrelated headline",
        source_domain="news.ycombinator.com",
        body_text="",
    )
    rss_match = LegacyArticle(
        url="https://blog.example.com/go",
        title="Go patterns",
        source_domain="blog.example.com",
        body_text="golang guide",
    )
    blocked = LegacyArticle(
        url="https://blocked.example.com/post",
        title="Blocked article",
        source_domain="blocked.example.com",
        body_text="python",
    )

    monkeypatch.setattr(
        scraper_tasks,
        "fetch_devto_articles",
        lambda tag=None, limit=4: [devto, devto, blocked],
    )
    monkeypatch.setattr(
        scraper_tasks,
        "fetch_hn_top_stories",
        lambda limit=16: [hn_match, hn_other],
    )
    monkeypatch.setattr(
        scraper_tasks,
        "parse_rss_feed",
        lambda feed_url, limit=3: [rss_match] if feed_url else [],
    )
    monkeypatch.setattr(
        scraper_tasks,
        "is_url_allowed",
        lambda url: "blocked.example.com" not in url,
    )

    payloads = scraper_tasks._collect_payloads(["python", "go"], prefer_hn_match=True)
    urls = [str(payload["url"]) for payload in payloads]

    assert urls.count("https://dev.to/python-post") == 1
    assert "https://news.ycombinator.com/item?id=1" in urls
    # Unmatched HN must not enter the pool
    assert "https://news.ycombinator.com/item?id=2" not in urls
    assert "https://blog.example.com/go" in urls
    assert "https://blocked.example.com/post" not in urls
    # Dev.to (tech tags) leads; matched HN is a supplement
    assert urls[0] == "https://dev.to/python-post"


def test_collect_payloads_empty_terms_without_trending_returns_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Without interests and without trending_mode, do not scrape generic day posts."""
    from src.models.schemas import Article as LegacyArticle

    latest = LegacyArticle(
        url="https://dev.to/latest-1",
        title="Hot today python tips",
        source_domain="dev.to",
        body_text="python",
    )

    monkeypatch.setattr(
        scraper_tasks,
        "fetch_devto_articles",
        lambda tag=None, limit=12: [latest],
    )
    monkeypatch.setattr(scraper_tasks, "fetch_hn_top_stories", lambda limit=16: [])
    monkeypatch.setattr(scraper_tasks, "sources_by_kind", lambda kind: [])
    monkeypatch.setattr(scraper_tasks, "is_url_allowed", lambda url: True)

    payloads = scraper_tasks._collect_payloads([], prefer_hn_match=False, trending_mode=False)
    assert payloads == []


def test_collect_payloads_trending_mode_uses_configured_sites_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Empty interests + trending_mode → tech posts from registry/admin sites only."""
    from src.models.schemas import Article as LegacyArticle

    latest = LegacyArticle(
        url="https://dev.to/latest-1",
        title="Hot today python tips",
        source_domain="dev.to",
        body_text="python asyncio tutorial",
    )
    hn_tech = LegacyArticle(
        url="https://news.ycombinator.com/item?id=1",
        title="Show HN: a new Rust compiler trick",
        source_domain="news.ycombinator.com",
        body_text="rust",
    )
    hn_offsite = LegacyArticle(
        url="https://random.example.com/a",
        title="Show HN: widgets with python",
        source_domain="random.example.com",
        body_text="python",
    )
    calls: list[object] = []

    def fake_devto(tag=None, limit=12):
        calls.append({"tag": tag, "limit": limit})
        return [latest]

    monkeypatch.setattr(scraper_tasks, "fetch_devto_articles", fake_devto)
    monkeypatch.setattr(
        scraper_tasks,
        "fetch_hn_top_stories",
        lambda limit=16: [hn_tech, hn_offsite],
    )
    monkeypatch.setattr(scraper_tasks, "sources_by_kind", lambda kind: [])
    monkeypatch.setattr(scraper_tasks, "is_url_allowed", lambda url: True)

    payloads = scraper_tasks._collect_payloads([], prefer_hn_match=False, trending_mode=True)
    urls = [str(p["url"]) for p in payloads]
    assert calls == [{"tag": None, "limit": 12}]
    assert "https://dev.to/latest-1" in urls
    assert "https://news.ycombinator.com/item?id=1" in urls
    assert "https://random.example.com/a" not in urls


def test_collect_payloads_continuity_and_trending_when_no_interests(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Helper still supports continuity tags + untagged trending when asked."""
    from src.models.schemas import Article as LegacyArticle

    cont = LegacyArticle(
        url="https://dev.to/rag-next",
        title="RAG chunking strategies",
        source_domain="dev.to",
        body_text="rag embedding vector search",
    )
    latest = LegacyArticle(
        url="https://dev.to/latest-1",
        title="Hot today rust tips",
        source_domain="dev.to",
        body_text="rust async tutorial",
    )
    devto_calls: list[object] = []

    def fake_devto(tag=None, limit=12):
        devto_calls.append({"tag": tag, "limit": limit})
        if tag == "rag":
            return [cont]
        return [latest]

    monkeypatch.setattr(scraper_tasks, "fetch_devto_articles", fake_devto)
    monkeypatch.setattr(scraper_tasks, "fetch_hn_top_stories", lambda limit=16: [])
    monkeypatch.setattr(scraper_tasks, "sources_by_kind", lambda kind: [])
    monkeypatch.setattr(scraper_tasks, "is_url_allowed", lambda url: True)

    payloads = scraper_tasks._collect_payloads(
        [],
        prefer_hn_match=False,
        trending_mode=True,
        continuity_terms=["rag"],
    )
    urls = [str(p["url"]) for p in payloads]
    assert {"tag": "rag", "limit": 4} in devto_calls
    assert {"tag": None, "limit": 12} in devto_calls
    assert "https://dev.to/rag-next" in urls
    assert "https://dev.to/latest-1" in urls


def test_collect_payloads_includes_admin_urls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.models.schemas import Article as LegacyArticle

    admin_art = LegacyArticle(
        url="https://company.example/posts/1",
        title="Company eng blog on kubernetes",
        source_domain="company.example",
        body_text="kubernetes deployment guide",
    )
    monkeypatch.setattr(scraper_tasks, "fetch_devto_articles", lambda **_: [])
    monkeypatch.setattr(scraper_tasks, "fetch_hn_top_stories", lambda **_: [])
    monkeypatch.setattr(scraper_tasks, "sources_by_kind", lambda kind: [])
    monkeypatch.setattr(
        scraper_tasks,
        "scrape_admin_source_articles",
        lambda urls, limit_per_feed=3: [admin_art] if urls else [],
    )
    monkeypatch.setattr(scraper_tasks, "is_url_allowed", lambda url: True)

    payloads = scraper_tasks._collect_payloads(
        [],
        prefer_hn_match=False,
        admin_source_urls=["https://company.example/blog"],
        trending_mode=True,
    )
    assert [str(p["url"]) for p in payloads] == ["https://company.example/posts/1"]


def test_collect_payloads_skips_rss_sources_without_feed_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.config.source_registry import SourceConfig

    monkeypatch.setattr(scraper_tasks, "fetch_devto_articles", lambda **_: [])
    monkeypatch.setattr(scraper_tasks, "fetch_hn_top_stories", lambda **_: [])
    monkeypatch.setattr(
        scraper_tasks,
        "sources_by_kind",
        lambda kind: [SourceConfig(name="empty", kind="rss", feed_url=None)],
    )
    rss_calls: list[str] = []
    monkeypatch.setattr(
        scraper_tasks,
        "parse_rss_feed",
        lambda feed_url, limit=3: rss_calls.append(feed_url) or [],
    )

    assert scraper_tasks._collect_payloads(["python"]) == []
    assert rss_calls == []


def test_run_scrape_stage_triggers_daily_briefings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from src.scheduler import jobs as jobs_mod

    called: list[str] = []

    async def fake_job() -> None:
        called.append("ran")

    monkeypatch.setattr(jobs_mod, "trigger_daily_briefings_job", fake_job)

    assert scraper_tasks.run_scrape_stage("cron") == "cron"
    assert called == ["ran"]


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_upsert_thin_article_returns_existing_id() -> None:
    article = Article(url="https://dev.to/existing", title="Existing", source_domain="dev.to")
    await article.insert()

    article_id = await scraper_tasks._upsert_thin_article(
        {"url": "https://dev.to/existing", "title": "Existing"}
    )
    assert article_id == str(article.id)


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_upsert_thin_article_recovers_from_duplicate_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from pymongo.errors import DuplicateKeyError

    saved = Article(url="https://example.com/dup", title="Dup", source_domain="example.com")
    await saved.insert()
    lookups = {"count": 0}

    original_find_one = Article.find_one

    async def fake_find_one(*args: object, **kwargs: object) -> Article | None:
        lookups["count"] += 1
        if lookups["count"] == 1:
            return None
        return await original_find_one(*args, **kwargs)

    async def boom_insert(self: Article) -> None:
        raise DuplicateKeyError("dup")

    monkeypatch.setattr(Article, "find_one", fake_find_one)
    monkeypatch.setattr(Article, "insert", boom_insert)

    article_id = await scraper_tasks._upsert_thin_article(
        {"url": "https://example.com/dup", "title": "Dup"}
    )
    assert article_id == str(saved.id)


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_upsert_thin_article_returns_none_when_duplicate_has_no_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from pymongo.errors import DuplicateKeyError

    async def boom_insert(self: Article) -> None:
        raise DuplicateKeyError("dup")

    async def missing_find(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(Article, "insert", boom_insert)
    monkeypatch.setattr(Article, "find_one", missing_find)

    article_id = await scraper_tasks._upsert_thin_article(
        {"url": "https://example.com/missing", "title": "Missing"}
    )
    assert article_id is None


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_upsert_thin_article_returns_none_when_insert_leaves_id_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def blank_insert(self: Article) -> None:
        return None

    monkeypatch.setattr(Article, "insert", blank_insert)

    article_id = await scraper_tasks._upsert_thin_article(
        {"url": "https://example.com/no-id", "title": "No id"}
    )
    assert article_id is None


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_scrape_skips_already_served_urls(monkeypatch: pytest.MonkeyPatch) -> None:
    await UserProfile(
        user_id="u1",
        name="Dev",
        interests=["python"],
        primary_tech_stack=["python"],
        learning_path=LearningPath(served_urls=["https://dev.to/served"]),
    ).insert()
    monkeypatch.setattr(
        scraper_tasks,
        "_collect_payloads",
        lambda terms, **_kwargs: [
            {
                "url": "https://dev.to/served",
                "title": "Served python tips",
                "summary": "python",
                "source_domain": "dev.to",
            },
            {
                "url": "https://dev.to/new",
                "title": "New python tips",
                "summary": "python",
                "source_domain": "dev.to",
            },
        ],
    )

    ids = await scraper_tasks._scrape_for_user("u1")
    assert len(ids) == 1
    stored = await Article.get(ids[0])
    assert stored is not None
    assert str(stored.url).rstrip("/") == "https://dev.to/new"


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
async def test_scrape_stops_after_max_article_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    await UserProfile(
        user_id="u1",
        name="Dev",
        interests=["python"],
        primary_tech_stack=["python"],
    ).insert()
    monkeypatch.setattr(
        scraper_tasks,
        "_collect_payloads",
        lambda terms, **_kwargs: [
            {
                "url": f"https://dev.to/post-{index}",
                "title": f"Python post {index}",
                "summary": "python tutorial",
                "source_domain": "dev.to",
            }
            for index in range(30)
        ],
    )

    ids = await scraper_tasks._scrape_for_user("u1")
    assert len(ids) == scraper_tasks._MAX_ARTICLES


def test_scrape_sources_delegates_to_async_worker(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_scrape(user_id: str) -> list[str]:
        assert user_id == "u1"
        return ["id-1"]

    monkeypatch.setattr(scraper_tasks, "_scrape_for_user", fake_scrape)
    assert scraper_tasks.scrape_sources("u1") == ["id-1"]
