"""Unit tests for the Pydantic transport schemas and the small core helpers.

These modules are pure/deterministic, so they're exercised directly rather
than through the API layer.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import jwt
import pytest

from src.models.schemas import (
    Article,
    DailyDigest,
    DigestArticle,
    DigestMetadata,
    Section,
    SourceCitation,
    UserProfile,
)


class TestSchemas:
    def test_user_profile_applies_documented_defaults(self) -> None:
        p = UserProfile(user_id="u1", name="Dev")
        assert p.years_of_experience == 0
        assert p.primary_tech_stack == []
        assert p.current_role == "Developer"
        assert p.content_freshness_days == 30
        assert p.preferred_content_depth is None

    def test_user_profile_round_trips_all_fields(self) -> None:
        p = UserProfile(
            user_id="u1",
            name="Dev",
            years_of_experience=5,
            primary_tech_stack=["python", "fastapi"],
            secondary_tech_stack=["react"],
            interests=["llm"],
            current_role="Staff Engineer",
            preferred_content_depth="deep",
            excluded_topics=["crypto"],
            preferred_sources=["dev.to"],
            content_freshness_days=7,
        )
        dumped = p.model_dump()
        assert dumped["primary_tech_stack"] == ["python", "fastapi"]
        assert UserProfile(**dumped) == p

    def test_article_defaults_and_scraped_at_autofill(self) -> None:
        a = Article(url="https://x.com/a", title="T", source_domain="x.com", body_text="body")
        assert a.word_count == 0
        assert a.quality_score == 0.0
        assert a.strategy_source == "A"
        assert a.embedding is None
        assert isinstance(a.scraped_at, datetime)

    def test_article_accepts_embedding_and_metadata(self) -> None:
        a = Article(
            url="https://x.com/a",
            title="T",
            source_domain="x.com",
            body_text="body",
            embedding=[0.1] * 768,
            metadata={"k": "v"},
            tags=["ai"],
            word_count=1200,
            reading_time_min=6.0,
            quality_score=0.87,
            strategy_source="C",
        )
        assert len(a.embedding or []) == 768
        assert a.metadata["k"] == "v"
        assert a.strategy_source == "C"

    def test_article_requires_mandatory_fields(self) -> None:
        with pytest.raises(Exception):
            Article(title="missing url")  # type: ignore[call-arg]

    def test_digest_composes_nested_models(self) -> None:
        digest = DailyDigest(
            digest_id="d1",
            user_id="u1",
            reading_time_minutes=18.5,
            word_count=4300,
            article=DigestArticle(
                headline="H",
                tldr=["point one", "point two"],
                sections=[
                    Section(
                        title="S1",
                        content="## body",
                        sources_cited=[0],
                        estimated_read_minutes=4.5,
                    )
                ],
                key_takeaways=["takeaway"],
                sources=[
                    SourceCitation(
                        id=0,
                        title="Src",
                        url="https://x.com/a",
                        source_domain="x.com",
                        author="A",
                        published_at="2026-08-01T00:00:00Z",
                    )
                ],
                further_reading=[{"title": "More", "url": "https://x.com/b"}],
            ),
            metadata=DigestMetadata(
                articles_evaluated=40,
                articles_used_in_synthesis=6,
                llm_tokens_used=12000,
                generation_latency_seconds=31.2,
            ),
        )
        assert digest.strategy_used == "C"
        assert digest.article.sections[0].sources_cited == [0]
        assert digest.metadata.articles_evaluated == 40
        assert isinstance(digest.generated_at, datetime)

    def test_digest_metadata_defaults_to_zeroes(self) -> None:
        m = DigestMetadata()
        assert (m.articles_evaluated, m.llm_tokens_used) == (0, 0)
        assert m.generation_latency_seconds == 0.0

    def test_section_defaults(self) -> None:
        s = Section(title="T", content="C")
        assert s.sources_cited == []
        assert s.estimated_read_minutes == 0.0


class TestSecurityTokens:
    def test_create_and_decode_round_trip(self) -> None:
        from src.core.security import create_access_token, decode_token

        token = create_access_token({"sub": "user-1"})
        decoded = decode_token(token)
        assert decoded["sub"] == "user-1"
        assert "exp" in decoded

    def test_decode_rejects_a_tampered_token(self) -> None:
        from src.core.security import create_access_token, decode_token

        token = create_access_token({"sub": "user-1"})
        with pytest.raises(ValueError, match="Invalid or expired token"):
            decode_token(token + "tampered")

    def test_decode_rejects_an_expired_token(self) -> None:
        from src.core.config import get_auth_settings
        from src.core.security import decode_token

        cfg = get_auth_settings()
        expired = jwt.encode(
            {"sub": "u1", "exp": datetime.now(UTC) - timedelta(minutes=5)},
            cfg.SECRET_KEY,
            algorithm=cfg.JWT_ALG,
        )
        with pytest.raises(ValueError):
            decode_token(expired)

    def test_decode_rejects_a_token_signed_with_another_key(self) -> None:
        from src.core.security import decode_token

        foreign = jwt.encode(
            {"sub": "u1", "exp": datetime.now(UTC) + timedelta(minutes=5)},
            "a-totally-different-secret",
            algorithm="HS256",
        )
        with pytest.raises(ValueError):
            decode_token(foreign)


class TestLoggingConfiguration:
    def test_configure_logging_dev_uses_console_renderer(self) -> None:
        import structlog

        from src.core.logging import configure_logging

        configure_logging("DEBUG")
        # Smoke-test that the configured logger actually emits without raising.
        structlog.get_logger("test").info("hello", key="value")

    def test_configure_logging_accepts_an_unknown_level(self) -> None:
        from src.core.logging import configure_logging

        configure_logging("NOT_A_REAL_LEVEL")  # falls back to INFO

    def test_configure_logging_json_in_production(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import structlog

        from src.core import logging as logging_mod
        from src.core.config import Environment

        class _Cfg:
            ENVIRONMENT = Environment.PRODUCTION

        monkeypatch.setattr(logging_mod, "get_app_settings", lambda: _Cfg())
        logging_mod.configure_logging("INFO")
        structlog.get_logger("test").info("prod message")


class TestSettingsModule:
    def test_settings_expose_expected_constants(self) -> None:
        from src.config import settings

        assert isinstance(settings.MONGODB_URI, str)
        assert settings.MONGODB_URI  # non-empty, has a default
        assert isinstance(settings.PORT, int)
        assert isinstance(settings.GEMINI_API_KEY, str)
        assert isinstance(settings.SUPABASE_URL, str)
