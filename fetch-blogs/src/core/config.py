"""
Configuration settings split by domain using pydantic-settings.
Getters are cached to avoid recreating settings instances.
"""

from __future__ import annotations

from enum import StrEnum
from functools import lru_cache

from pydantic import AliasChoices, AnyHttpUrl, AnyUrl, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


# ── Shared enum ───────────────────────────────────────────────────────────────
class Environment(StrEnum):
    LOCAL = "local"
    STAGING = "staging"
    PRODUCTION = "production"


# ── Domain settings classes ───────────────────────────────────────────────────
class AppSettings(BaseSettings):
    """FastAPI application settings — prefix: APP_"""

    model_config = SettingsConfigDict(env_file=".env", env_prefix="APP_", extra="ignore")

    PROJECT_NAME: str = "Creole Knowledge Portal API"
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: Environment = Environment.LOCAL
    LOG_LEVEL: str = "INFO"
    SENTRY_DSN: AnyUrl | None = None
    CELERY_EAGER: bool | None = None

    @field_validator("SENTRY_DSN", mode="before")
    @classmethod
    def blank_sentry_dsn_is_none(cls, value: object) -> object:
        if value is None:
            return None
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @property
    def show_docs(self) -> bool:
        """OpenAPI docs only in local/staging."""
        return self.ENVIRONMENT in {Environment.LOCAL, Environment.STAGING}

    @property
    def celery_eager(self) -> bool:
        """When True, Celery runs in-process (no Redis workers needed).

        Local and prod both use real workers by default. Set APP_CELERY_EAGER=true
        only for quick debugging without Redis.
        """
        if self.CELERY_EAGER is not None:
            return bool(self.CELERY_EAGER)
        return False


class MongoSettings(BaseSettings):
    """MongoDB connection settings — prefix: MONGO_"""

    model_config = SettingsConfigDict(env_file=".env", env_prefix="MONGO_", extra="ignore")

    URI: str = "mongodb://localhost:27017"
    DB_NAME: str = "knowledge_portal"


class RedisSettings(BaseSettings):
    """Redis connection settings — prefix: REDIS_"""

    model_config = SettingsConfigDict(env_file=".env", env_prefix="REDIS_", extra="ignore")

    URL: str = "redis://localhost:6379/0"  # Celery broker
    RESULT_URL: str = "redis://localhost:6379/1"  # Celery result backend


class SupabaseSettings(BaseSettings):
    """Server-only Supabase settings — prefix: SUPABASE_."""

    model_config = SettingsConfigDict(
        env_file=("../.env.local", ".env"),
        env_prefix="SUPABASE_",
        extra="ignore",
        populate_by_name=True,
    )

    URL: AnyHttpUrl = Field(
        default="https://localhost.supabase.co",  # type: ignore[assignment]
        validation_alias=AliasChoices("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"),
    )
    ANON_KEY: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices("SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    )
    SERVICE_ROLE_KEY: SecretStr = Field(
        default=SecretStr("dummy-service-role-key-for-local-dev"),
        validation_alias=AliasChoices("SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY"),
    )


class AuthSettings(BaseSettings):
    """Auth / JWT settings — prefix: AUTH_"""

    model_config = SettingsConfigDict(env_file=".env", env_prefix="AUTH_", extra="ignore")

    SECRET_KEY: str = "change-me-to-a-32-char-secret"
    JWT_ALG: str = "HS256"
    JWT_EXP_MINUTES: int = Field(default=60, ge=1)


class LLMSettings(BaseSettings):
    """LLM / Gemini settings — prefix: LLM_"""

    model_config = SettingsConfigDict(
        env_file=("../.env.local", ".env"),
        env_prefix="LLM_",
        extra="ignore",
        populate_by_name=True,
    )

    GEMINI_API_KEY: str = Field(
        default="",
        validation_alias=AliasChoices("LLM_GEMINI_API_KEY", "GEMINI_API_KEY"),
    )
    GEMINI_MODEL: str = Field(
        default="gemini-2.5-flash",
        validation_alias=AliasChoices("LLM_GEMINI_MODEL", "GEMINI_MODEL"),
    )
    GEMINI_EMBED_MODEL: str = "models/text-embedding-004"


class ScrapingSettings(BaseSettings):
    """Scraping / scheduling settings — prefix: SCRAPING_"""

    model_config = SettingsConfigDict(env_file=".env", env_prefix="SCRAPING_", extra="ignore")

    CONCURRENCY: int = Field(default=8, ge=1, le=32)
    CONTENT_FRESHNESS_DAYS: int = Field(default=30, ge=1)
    DIGEST_WORD_TARGET: int = Field(default=4000, ge=1000)
    CRON_SCHEDULE: str = "30 2 * * *"  # 08:00 IST = 02:30 UTC — daily scrape + 20–25 min briefing
    ROBOTS_CACHE_TTL_SECONDS: int = 3600


# ── LRU-cached getters (one instance per settings class) ─────────────────────
@lru_cache
def get_app_settings() -> AppSettings:
    return AppSettings()


@lru_cache
def get_mongo_settings() -> MongoSettings:
    return MongoSettings()


@lru_cache
def get_redis_settings() -> RedisSettings:
    return RedisSettings()


@lru_cache
def get_supabase_settings() -> SupabaseSettings:
    return SupabaseSettings()


@lru_cache
def get_auth_settings() -> AuthSettings:
    return AuthSettings()


@lru_cache
def get_llm_settings() -> LLMSettings:
    return LLMSettings()


@lru_cache
def get_scraping_settings() -> ScrapingSettings:
    return ScrapingSettings()
