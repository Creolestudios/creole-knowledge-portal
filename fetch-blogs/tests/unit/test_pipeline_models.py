"""Unit tests for payload adapters and Beanie digest/job documents."""

from __future__ import annotations

from datetime import UTC, date, datetime, timezone
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from src.adapters.article_payload import legacy_schema_to_payload, to_article_fields
from src.adapters.supabase_profile import to_user_profile_fields
from src.models.article import Article
from src.models.digest import (
    DailyDigest,
    DigestContent,
    DigestMetrics,
    DigestSection,
    DigestSource,
)
from src.models.job import JobStatus, PipelineJob, PipelineStage, StageResult
from src.models.profile import (
    ContentDepth,
    DifficultyDirection,
    LearningPath,
    QuizOutcome,
    ScrapePace,
    UserProfile,
    apply_quiz_result,
    effective_content_depth,
    next_scrape_pace,
    scrape_focus_terms,
    topic_tokens_from_text,
)
from src.schemas.profile import ProfileOut, ProfileSyncOut, QuizResultIn


class TestSupabaseProfileAdapter:
    def test_maps_core_fields_and_ignores_learning_path(self) -> None:
        fields = to_user_profile_fields(
            {
                "user_id": "u1",
                "name": "Dev",
                "years_of_experience": "4",
                "primary_tech_stack": "python, fastapi",
                "interests": None,
                "future_learning_goals": ["llm"],
                "preferred_content_depth": "advanced",
            }
        )
        assert fields["user_id"] == "u1"
        assert fields["primary_tech_stack"] == ["python", "fastapi"]
        assert fields["interests"] == ["llm"]
        assert fields["preferred_content_depth"] == ContentDepth.ADVANCED
        assert "learning_path" not in fields
        assert "profile_embedding" not in fields

    def test_maps_future_interests_string_from_next_app(self) -> None:
        fields = to_user_profile_fields(
            {
                "user_id": "u1",
                "primary_tech_stack": ["python"],
                "secondary_tech_stack": ["docker"],
                "future_interests": "AI, Redis, asyncio",
            }
        )
        assert fields["primary_tech_stack"] == ["python"]
        assert fields["secondary_tech_stack"] == ["docker"]
        assert fields["interests"] == ["AI", "Redis", "asyncio"]

    def test_requires_user_id(self) -> None:
        with pytest.raises(ValueError, match="user_id"):
            to_user_profile_fields({"name": "Dev"})

    def test_maps_list_tuple_and_invalid_ints(self) -> None:
        fields = to_user_profile_fields(
            {
                "user_id": "u1",
                "primary_tech_stack": ("python", "go"),
                "secondary_tech_stack": {"rust"},
                "years_of_experience": "nope",
                "preferred_content_depth": "  intermediate ",
            }
        )
        assert fields["primary_tech_stack"] == ["python", "go"]
        assert fields["secondary_tech_stack"] == ["rust"]
        assert fields["years_of_experience"] == 0
        assert fields["preferred_content_depth"].value == "intermediate"

    def test_ignores_non_collection_interests_and_clamps_freshness(self) -> None:
        fields = to_user_profile_fields(
            {
                "user_id": "u1",
                "interests": 99,
                "preferred_content_depth": None,
                "content_freshness_days": 0,
            }
        )
        assert fields["interests"] == []
        assert fields["preferred_content_depth"] is None
        assert fields["content_freshness_days"] == 30

    def test_unknown_content_depth_becomes_none(self) -> None:
        fields = to_user_profile_fields(
            {"user_id": "u1", "preferred_content_depth": "not-a-real-depth"}
        )
        assert fields["preferred_content_depth"] is None


class TestArticlePayloadAdapter:
    def test_renames_legacy_fields(self) -> None:
        fields = to_article_fields(
            {
                "url": "https://dev.to/a",
                "title": "Hello",
                "tags": ["python"],
                "body_markdown": "ignored for thin insert",
                "description": "short",
                "published_at": "2026-01-01T00:00:00Z",
            }
        )
        assert fields["topics"] == ["python"]
        assert fields["body_text"] == ""
        assert fields["summary"] == "short"
        assert fields["source_domain"] == "dev.to"
        assert fields["published_at"] is not None

    def test_requires_url(self) -> None:
        with pytest.raises(ValueError, match="url"):
            to_article_fields({"title": "x"})

    def test_topics_from_comma_string_and_collection(self) -> None:
        from_string = to_article_fields({"url": "https://dev.to/a", "topics": "python, fastapi, "})
        from_list = to_article_fields({"url": "https://dev.to/a", "topics": ["python", " ", "go"]})
        from_set = to_article_fields({"url": "https://dev.to/a", "topics": {"rust"}})
        ignored = to_article_fields({"url": "https://dev.to/a", "topics": 12})
        assert from_string["topics"] == ["python", "fastapi"]
        assert from_list["topics"] == ["python", "go"]
        assert from_set["topics"] == ["rust"]
        assert ignored["topics"] == []

    def test_summary_falls_back_to_body_excerpt(self) -> None:
        body = "x" * 450
        fields = to_article_fields({"url": "https://example.com/post", "body_text": body})
        assert fields["summary"] == body[:400]
        assert fields["body_text"] == ""

    def test_domain_from_explicit_value_and_from_url(self) -> None:
        explicit = to_article_fields(
            {"url": "https://www.other.com/a", "source_domain": "www.dev.to"}
        )
        inferred = to_article_fields({"url": "https://www.hn.example/item"})
        assert explicit["source_domain"] == "dev.to"
        assert inferred["source_domain"] == "hn.example"

    def test_published_at_parses_datetime_timestamp_and_iso(self) -> None:
        naive = datetime(2026, 1, 2, 3, 4, 5)
        aware = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
        stamp = 1_735_689_600
        from_naive = to_article_fields({"url": "https://x.com/a", "published_at": naive})
        from_aware = to_article_fields({"url": "https://x.com/a", "published_at": aware})
        from_stamp = to_article_fields({"url": "https://x.com/a", "published_at": stamp})
        from_iso = to_article_fields(
            {"url": "https://x.com/a", "published_at": "2026-01-02T03:04:05Z"}
        )
        missing = to_article_fields({"url": "https://x.com/a", "published_at": None})
        blank = to_article_fields({"url": "https://x.com/a", "published_at": "   "})
        invalid = to_article_fields({"url": "https://x.com/a", "published_at": "not-a-date"})
        assert from_naive["published_at"] == naive.replace(tzinfo=UTC)
        assert from_aware["published_at"] == aware
        assert from_stamp["published_at"] == datetime.fromtimestamp(float(stamp), tz=UTC)
        assert from_iso["published_at"] is not None
        assert missing["published_at"] is None
        assert blank["published_at"] is None
        assert invalid["published_at"] is None

    def test_default_scores_and_explicit_scores(self) -> None:
        defaults = to_article_fields({"url": "https://x.com/a"})
        explicit = to_article_fields(
            {
                "url": "https://x.com/a",
                "engagement_score": 2,
                "authority_score": 0.9,
                "robots_allowed": False,
            }
        )
        assert defaults["engagement_score"] == 0.0
        assert defaults["authority_score"] == 0.5
        assert defaults["robots_allowed"] is True
        assert explicit["engagement_score"] == 2.0
        assert explicit["authority_score"] == 0.9
        assert explicit["robots_allowed"] is False

    def test_empty_title_falls_back_to_url(self) -> None:
        fields = to_article_fields({"url": "https://x.com/post", "title": "   "})
        assert fields["title"] == "https://x.com/post"

    def test_legacy_schema_to_payload(self) -> None:
        article = SimpleNamespace(
            url="https://dev.to/a",
            title="Hello",
            author="Ada",
            source_domain="dev.to",
            published_at=datetime(2026, 1, 1, tzinfo=UTC),
            body_text="full body",
            tags=["python"],
        )
        payload = legacy_schema_to_payload(article)
        fields = to_article_fields(payload)
        assert payload["description"] == "full body"
        assert payload["body_text"] == ""
        assert fields["summary"] == "full body"
        assert fields["topics"] == ["python"]
        assert fields["author"] == "Ada"

    def test_legacy_schema_without_optional_attrs(self) -> None:
        article = SimpleNamespace(
            url="https://x.com/a",
            title="T",
            author="",
            source_domain="x.com",
            published_at=None,
        )
        payload = legacy_schema_to_payload(article)
        assert payload["description"] == ""
        assert payload["tags"] == []

    def test_invalid_score_inputs_use_defaults(self) -> None:
        fields = to_article_fields(
            {
                "url": "https://x.com/a",
                "engagement_score": "not-a-number",
                "authority_score": [1, 2],
            }
        )
        assert fields["engagement_score"] == 0.0
        assert fields["authority_score"] == 0.5


def test_models_package_init_exports() -> None:
    import src.models as models_pkg

    assert hasattr(models_pkg, "__all__")
    assert sorted(models_pkg.__all__) == ["Article", "DailyDigest", "PipelineJob", "UserProfile"]
    assert models_pkg.Article is Article
    assert models_pkg.DailyDigest is DailyDigest
    assert models_pkg.PipelineJob is PipelineJob
    assert models_pkg.UserProfile is UserProfile


class TestDigestAndJobDocuments:
    async def test_daily_digest_persists(self) -> None:
        digest = DailyDigest(
            user_id="u1",
            digest_date=date(2026, 8, 17),
            article_ids=["a1"],
            strategy_used="B",
            reading_time_minutes=12.5,
            word_count=2400,
            content=DigestContent(
                headline="Brief",
                tldr=["point one"],
                sections=[
                    DigestSection(
                        title="Why it matters",
                        content="Body copy",
                        sources_cited=[1],
                        estimated_read_minutes=3.5,
                    )
                ],
                key_takeaways=["ship tests"],
                sources=[
                    DigestSource(
                        id=1,
                        title="Source A",
                        url="https://dev.to/a",
                        author="Ada",
                        source_domain="dev.to",
                        published_at=datetime(2026, 8, 17, tzinfo=UTC),
                    )
                ],
                further_reading=[{"title": "More", "url": "https://dev.to/more"}],
            ),
            metrics=DigestMetrics(
                articles_evaluated=8,
                articles_used=3,
                llm_tokens_used=1200,
                generation_latency_seconds=4.2,
            ),
        )
        await digest.insert()
        loaded = await DailyDigest.find_one(DailyDigest.user_id == "u1")
        assert loaded is not None
        assert loaded.content.headline == "Brief"
        assert loaded.content.sections[0].title == "Why it matters"
        assert loaded.content.sources[0].author == "Ada"
        assert loaded.metrics.articles_used == 3
        assert loaded.strategy_used == "B"
        assert DailyDigest.Settings.name == "daily_digests"
        assert DailyDigest.Settings.indexes

    async def test_pipeline_job_persists(self) -> None:
        job = PipelineJob(job_id="job-1", user_id="u1", status=JobStatus.RUNNING)
        await job.insert()
        loaded = await PipelineJob.find_one(PipelineJob.job_id == "job-1")
        assert loaded is not None
        assert loaded.status is JobStatus.RUNNING
        assert loaded.current_stage is None

    def test_job_status_enum_covers_all_states(self) -> None:
        assert [status.value for status in JobStatus] == [
            "pending",
            "running",
            "succeeded",
            "failed",
        ]

    def test_stage_result_defaults_and_assignment(self) -> None:
        started = datetime(2026, 8, 17, 8, 0, tzinfo=UTC)
        finished = datetime(2026, 8, 17, 8, 5, tzinfo=UTC)
        result = StageResult(
            status=JobStatus.SUCCEEDED,
            items_in=10,
            items_out=8,
            started_at=started,
            finished_at=finished,
            error="",
        )
        assert result.status is JobStatus.SUCCEEDED
        assert result.items_in == 10
        assert result.items_out == 8
        assert result.started_at == started
        assert result.finished_at == finished

        defaults = StageResult()
        assert defaults.status is JobStatus.PENDING
        assert defaults.items_in == 0
        assert defaults.items_out == 0
        assert defaults.started_at is None
        assert defaults.finished_at is None
        assert defaults.error == ""

    async def test_pipeline_job_persists_stages_and_metadata(self) -> None:
        job = PipelineJob(
            job_id="job-2",
            user_id="u1",
            status=JobStatus.RUNNING,
            current_stage=PipelineStage.SCRAPE,
            stages={
                "scrape": StageResult(status=JobStatus.SUCCEEDED, items_in=5, items_out=5),
            },
            triggered_by="cron",
            article_ids=["a1", "a2"],
            digest_id="digest-1",
            error="",
        )
        await job.insert()
        loaded = await PipelineJob.find_one(PipelineJob.job_id == "job-2")
        assert loaded is not None
        assert loaded.current_stage is PipelineStage.SCRAPE
        assert loaded.stages["scrape"].items_out == 5
        assert loaded.triggered_by == "cron"
        assert loaded.article_ids == ["a1", "a2"]
        assert loaded.digest_id == "digest-1"
        assert isinstance(loaded.created_at, datetime)
        assert isinstance(loaded.updated_at, datetime)
        assert PipelineJob.Settings.name == "pipeline_jobs"
        assert PipelineJob.Settings.indexes == ["job_id", "user_id", "created_at"]

    async def test_profile_learning_path_survives_field_update(self) -> None:
        profile = UserProfile(
            user_id="u1",
            name="Dev",
            learning_path=LearningPath(weak_topics=["hooks"], last_quiz_outcome=QuizOutcome.FAILED),
        )
        await profile.insert()
        profile.name = "Updated"
        await profile.save()
        loaded = await UserProfile.find_one(UserProfile.user_id == "u1")
        assert loaded is not None
        assert loaded.learning_path.weak_topics == ["hooks"]
        assert loaded.learning_path.last_quiz_outcome is QuizOutcome.FAILED

    def test_pipeline_stage_enum_covers_full_chain(self) -> None:
        assert [stage.value for stage in PipelineStage] == [
            "scrape",
            "extract",
            "rank",
            "generate",
            "publish",
        ]

    def test_digest_requires_headline(self) -> None:
        with pytest.raises(ValidationError):
            DigestContent()  # type: ignore[call-arg]

    def test_models_package_reexports(self) -> None:
        import importlib

        from src import models as models_pkg

        importlib.reload(models_pkg)
        assert models_pkg.Article is Article
        assert models_pkg.DailyDigest is DailyDigest
        assert models_pkg.PipelineJob is PipelineJob
        assert models_pkg.UserProfile is UserProfile
        assert list(models_pkg.__all__) == ["Article", "DailyDigest", "PipelineJob", "UserProfile"]

    async def test_mongomock_accepts_pymongo_collection_kwargs(self) -> None:
        import mongomock

        names = mongomock.MongoClient().db.list_collection_names(
            authorizedCollections=True,
            nameOnly=True,
        )
        assert isinstance(names, list)


class TestUserProfileModel:
    def test_content_depth_honours_explicit_preference(self) -> None:
        profile = UserProfile(
            user_id="u1",
            years_of_experience=10,
            preferred_content_depth=ContentDepth.BEGINNER,
        )
        assert profile.content_depth is ContentDepth.BEGINNER

    def test_content_depth_derives_from_experience(self) -> None:
        beginner = UserProfile(user_id="b", years_of_experience=1)
        intermediate = UserProfile(user_id="i", years_of_experience=3)
        advanced = UserProfile(user_id="a", years_of_experience=8)

        assert beginner.content_depth is ContentDepth.BEGINNER
        assert intermediate.content_depth is ContentDepth.INTERMEDIATE
        assert advanced.content_depth is ContentDepth.ADVANCED

    def test_ranking_terms_use_interests_field_only(self) -> None:
        profile = UserProfile(
            user_id="u1",
            primary_tech_stack=["Python", " FastAPI "],
            secondary_tech_stack=["React"],
            interests=["LLM", " Redis "],
            current_role="Engineer",
            learning_path=LearningPath(
                last_topics=["python"],
                next_step_topics=["docker"],
                weak_topics=["hooks"],
            ),
            years_of_experience=6,
        )

        terms = profile.ranking_terms
        assert terms == ["llm", "redis"]

    def test_ranking_terms_use_stack_when_interests_empty(self) -> None:
        profile = UserProfile(
            user_id="u1",
            primary_tech_stack=["Python"],
            secondary_tech_stack=["React"],
            current_role="Engineer",
        )
        assert profile.ranking_terms == ["python", "react"]

    def test_topic_tokens_from_text_finds_known_topics(self) -> None:
        assert topic_tokens_from_text("Building FastAPI apps with Python") == ["python", "fastapi"]

    def test_scrape_focus_terms_stays_on_active_stack_not_weak_next(self) -> None:
        profile = UserProfile(
            user_id="u1",
            primary_tech_stack=["python", "rust"],
            interests=["AI"],
            learning_path=LearningPath(
                active_stack="python",
                last_topics=["Python async patterns"],
                next_step_topics=["kubernetes"],
                weak_topics=["graphql"],
                last_quiz_outcome=QuizOutcome.PASSED,
                last_quiz_percentage=70,
                last_quiz_attempt_number=1,
            ),
        )
        terms = scrape_focus_terms(profile)
        assert terms[0] == "python"
        assert "kubernetes" not in terms
        assert "graphql" not in terms

    def test_scrape_focus_terms_no_hardcoded_pace_keywords(self) -> None:
        profile = UserProfile(
            user_id="u1",
            primary_tech_stack=["python"],
            learning_path=LearningPath(
                active_stack="python",
                last_topics=["asyncio event loop"],
                last_quiz_outcome=QuizOutcome.FAILED,
                last_quiz_percentage=20,
                last_quiz_attempt_number=3,
                last_quiz_score=1,
                last_quiz_total=5,
            ),
        )
        terms = scrape_focus_terms(profile)
        assert terms[0] == "python"
        assert "basics" not in terms
        assert "fundamentals" not in terms
        assert "explained" not in terms
        assert "beginners" not in terms
        assert "advanced" not in terms
        assert "production" not in terms

    def test_apply_quiz_result_stores_marks_attempt_result_pass_at_60(self) -> None:
        profile = UserProfile(
            user_id="u1",
            primary_tech_stack=["python"],
            learning_path=LearningPath(last_topics=["asyncio"]),
        )
        apply_quiz_result(
            profile,
            score=3,
            total=5,
            weak_topics=["redis"],
            next_step_topics=["docker"],
            percentage=60,
            passed=True,
            attempt_number=1,
            blog_id="blog-xyz",
        )
        assert profile.learning_path.last_quiz_outcome is QuizOutcome.PASSED
        assert profile.learning_path.last_quiz_score == 3
        assert profile.learning_path.last_quiz_total == 5
        assert profile.learning_path.last_quiz_percentage == 60
        assert profile.learning_path.last_quiz_attempt_number == 1
        assert profile.learning_path.active_stack == "python"
        assert profile.learning_path.difficulty_direction is DifficultyDirection.SAME

    def test_apply_quiz_result_updates_learning_path_by_score_band(self) -> None:
        failed = UserProfile(
            user_id="u1",
            primary_tech_stack=["react"],
            learning_path=LearningPath(last_topics=["react"]),
        )
        apply_quiz_result(failed, score=1, total=5, percentage=20, passed=False, attempt_number=2)
        assert failed.learning_path.last_quiz_outcome is QuizOutcome.FAILED
        assert failed.learning_path.difficulty_direction is DifficultyDirection.EASIER
        assert next_scrape_pace(failed) is ScrapePace.SIMPLER

        passed = UserProfile(
            user_id="u2",
            primary_tech_stack=["docker"],
            learning_path=LearningPath(last_topics=["docker"]),
        )
        apply_quiz_result(passed, score=3, total=5, percentage=60, passed=True, attempt_number=1)
        assert passed.learning_path.last_quiz_outcome is QuizOutcome.PASSED
        assert passed.learning_path.difficulty_direction is DifficultyDirection.SAME
        assert next_scrape_pace(passed) is ScrapePace.ADVANCE

        strong = UserProfile(
            user_id="u3",
            primary_tech_stack=["llm"],
            learning_path=LearningPath(last_topics=["llm"]),
        )
        apply_quiz_result(strong, score=4, total=4, percentage=100, passed=True, attempt_number=1)
        assert strong.learning_path.last_quiz_outcome is QuizOutcome.PASSED
        assert strong.learning_path.difficulty_direction is DifficultyDirection.HARDER
        assert next_scrape_pace(strong) is ScrapePace.ADVANCE_HARD

    def test_effective_content_depth_shifts_with_quiz_direction(self) -> None:
        profile = UserProfile(user_id="u1", years_of_experience=3)
        profile.learning_path.difficulty_direction = DifficultyDirection.EASIER
        assert effective_content_depth(profile) is ContentDepth.BEGINNER

        profile.learning_path.difficulty_direction = DifficultyDirection.HARDER
        assert effective_content_depth(profile) is ContentDepth.ADVANCED

        profile.learning_path.difficulty_direction = DifficultyDirection.SAME
        assert effective_content_depth(profile) is ContentDepth.INTERMEDIATE

    async def test_user_profile_persists_with_settings(self) -> None:
        profile = UserProfile(
            user_id="u1",
            name="Dev",
            excluded_topics=["crypto"],
            preferred_sources=["dev.to"],
            content_freshness_days=14,
            profile_embedding=[0.1, 0.2],
        )
        await profile.insert()
        loaded = await UserProfile.find_one(UserProfile.user_id == "u1")
        assert loaded is not None
        assert loaded.excluded_topics == ["crypto"]
        assert loaded.preferred_sources == ["dev.to"]
        assert loaded.content_freshness_days == 14
        assert loaded.profile_embedding == [0.1, 0.2]
        assert isinstance(loaded.created_at, datetime)
        assert UserProfile.Settings.name == "user_profiles"
        assert UserProfile.Settings.indexes == ["user_id", "primary_tech_stack", "interests"]


class TestProfileSchemas:
    def test_profile_out_and_sync_out_round_trip(self) -> None:
        now = datetime(2026, 8, 19, tzinfo=UTC)
        out = ProfileOut(
            user_id="u1",
            name="Dev",
            content_depth=ContentDepth.INTERMEDIATE,
            updated_at=now,
        )
        sync = ProfileSyncOut(**out.model_dump(), created=True)

        assert sync.user_id == "u1"
        assert sync.created is True
        assert sync.ranking_terms == []

    def test_quiz_result_in_validates_score_bounds(self) -> None:
        payload = QuizResultIn(score=4, total=5)
        assert payload.score == 4
        assert payload.total == 5

        with pytest.raises(ValidationError):
            QuizResultIn(score=-1, total=5)
        with pytest.raises(ValidationError):
            QuizResultIn(score=1, total=0)
