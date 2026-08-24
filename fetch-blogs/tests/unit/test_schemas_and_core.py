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

    def test_app_settings_docs_and_celery_eager(self) -> None:
        from src.core.config import AppSettings, Environment

        local = AppSettings(_env_file=None, ENVIRONMENT=Environment.LOCAL, CELERY_EAGER=None)
        staging = AppSettings(_env_file=None, ENVIRONMENT=Environment.STAGING, CELERY_EAGER=None)
        prod = AppSettings(_env_file=None, ENVIRONMENT=Environment.PRODUCTION, CELERY_EAGER=None)
        assert local.show_docs is True
        assert staging.show_docs is True
        assert prod.show_docs is False
        assert local.celery_eager is True
        assert prod.celery_eager is False
        assert (
            AppSettings(
                _env_file=None, ENVIRONMENT=Environment.PRODUCTION, CELERY_EAGER=True
            ).celery_eager
            is True
        )
        # Local always runs in-process regardless of CELERY_EAGER override.
        assert (
            AppSettings(
                _env_file=None, ENVIRONMENT=Environment.LOCAL, CELERY_EAGER=False
            ).celery_eager
            is True
        )
        assert (
            AppSettings(
                _env_file=None, ENVIRONMENT=Environment.STAGING, CELERY_EAGER=False
            ).celery_eager
            is False
        )

    def test_blank_sentry_dsn_is_treated_as_none(self) -> None:
        from src.core.config import AppSettings

        assert AppSettings(_env_file=None, SENTRY_DSN=None).SENTRY_DSN is None
        assert AppSettings(_env_file=None, SENTRY_DSN="   ").SENTRY_DSN is None
        dsn = AppSettings(_env_file=None, SENTRY_DSN="https://sentry.example/1")
        assert dsn.SENTRY_DSN is not None

    def test_cached_settings_getters(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from src.core import config as config_mod

        monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
        monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key")
        for getter in (
            config_mod.get_app_settings,
            config_mod.get_mongo_settings,
            config_mod.get_redis_settings,
            config_mod.get_supabase_settings,
            config_mod.get_auth_settings,
            config_mod.get_llm_settings,
            config_mod.get_scraping_settings,
        ):
            getter.cache_clear()

        app = config_mod.get_app_settings()
        mongo = config_mod.get_mongo_settings()
        redis = config_mod.get_redis_settings()
        supabase = config_mod.get_supabase_settings()
        auth = config_mod.get_auth_settings()
        llm = config_mod.get_llm_settings()
        scraping = config_mod.get_scraping_settings()

        assert app.PROJECT_NAME
        assert mongo.DB_NAME == "knowledge_portal"
        assert redis.URL.startswith("redis://")
        assert str(supabase.URL).startswith("https://")
        assert auth.JWT_ALG == "HS256"
        assert llm.GEMINI_MODEL
        assert scraping.CONCURRENCY >= 1
        assert config_mod.get_app_settings() is app

    def test_settings_legacy_file_path_branches(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import importlib
        from pathlib import Path

        from src.config import settings as settings_mod

        original_exists = Path.exists

        def fake_exists(self: Path, *, parent: bool, local: bool) -> bool:
            if self.name == ".env.local":
                return parent
            if self.name == ".env":
                return local
            return original_exists(self)

        monkeypatch.setattr(
            Path, "exists", lambda self: fake_exists(self, parent=False, local=True)
        )
        importlib.reload(settings_mod)
        assert settings_mod.PORT >= 1

        monkeypatch.setattr(
            Path, "exists", lambda self: fake_exists(self, parent=False, local=False)
        )
        importlib.reload(settings_mod)
        assert settings_mod.PORT >= 1


class TestRedisModule:
    @pytest.mark.asyncio
    async def test_redis_helpers_and_generator(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from src.core import redis as redis_mod

        client = redis_mod.get_redis_client()
        assert client is not None

        # Exercise get_redis async generator
        async for r in redis_mod.get_redis():
            assert r is not None

        # Exercise ping_redis exception path
        class ExplodingClient:
            async def ping(self) -> bool:
                raise RuntimeError("redis dead")

        monkeypatch.setattr(redis_mod, "get_redis_client", lambda: ExplodingClient())
        assert await redis_mod.ping_redis() is False
