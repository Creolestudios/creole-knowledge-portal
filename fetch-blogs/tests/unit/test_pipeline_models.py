"""Unit tests for payload adapters and Beanie digest/job documents."""

from __future__ import annotations

from datetime import date

import pytest
from pydantic import ValidationError

from src.adapters.article_payload import to_article_fields
from src.adapters.supabase_profile import to_user_profile_fields
from src.models.digest import DailyDigest, DigestContent
from src.models.job import JobStatus, PipelineJob, PipelineStage
from src.models.profile import ContentDepth, LearningPath, QuizOutcome, UserProfile


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

    def test_requires_user_id(self) -> None:
        with pytest.raises(ValueError, match="user_id"):
            to_user_profile_fields({"name": "Dev"})

    def test_invalid_depth_becomes_none(self) -> None:
        fields = to_user_profile_fields({"user_id": "u1", "preferred_content_depth": "deep"})
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


class TestDigestAndJobDocuments:
    async def test_daily_digest_persists(self) -> None:
        digest = DailyDigest(
            user_id="u1",
            digest_date=date(2026, 8, 17),
            content=DigestContent(headline="Brief"),
        )
        await digest.insert()
        loaded = await DailyDigest.find_one(DailyDigest.user_id == "u1")
        assert loaded is not None
        assert loaded.content.headline == "Brief"

    async def test_pipeline_job_persists(self) -> None:
        job = PipelineJob(job_id="job-1", user_id="u1", status=JobStatus.RUNNING)
        await job.insert()
        loaded = await PipelineJob.find_one(PipelineJob.job_id == "job-1")
        assert loaded is not None
        assert loaded.status is JobStatus.RUNNING
        assert loaded.current_stage is None

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
