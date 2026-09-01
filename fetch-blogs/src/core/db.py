"""MongoDB connection and Beanie ODM initialization."""

from __future__ import annotations

import certifi
import structlog
from beanie import init_beanie
from motor.motor_asyncio import AsyncIOMotorClient

# pyrefly: ignore [missing-import]
from src.core.config import get_mongo_settings

log = structlog.get_logger(__name__)

_client: AsyncIOMotorClient | None = None  # type: ignore[type-arg]
_initialized = False


async def init_db() -> None:
    """Initialize the MongoDB client and Beanie ODM."""
    global _client, _initialized
    if _initialized and _client is not None:
        return

    if _client is not None:
        try:
            _client.close()
        except Exception:
            pass
        _client = None

    cfg = get_mongo_settings()

    log.info("db: connecting", db=cfg.DB_NAME)
    client_kwargs: dict[str, object] = {
        "serverSelectionTimeoutMS": 15000,
        "connectTimeoutMS": 15000,
        "socketTimeoutMS": 20000,
    }
    if "mongodb+srv://" in cfg.URI or "ssl=true" in cfg.URI.lower() or "tls=true" in cfg.URI.lower():
        client_kwargs["tlsCAFile"] = certifi.where()

    _client = AsyncIOMotorClient(
        cfg.URI,
        **client_kwargs,
    )

    from src.models.article import Article
    from src.models.digest import DailyDigest
    from src.models.job import PipelineJob
    from src.models.profile import UserProfile

    document_models: list[type] = [Article, UserProfile, DailyDigest, PipelineJob]

    await init_beanie(
        database=_client[cfg.DB_NAME],
        document_models=document_models,
    )
    _initialized = True
    log.info("db: ready")


async def ensure_db() -> None:
    """Ensure MongoDB and Beanie ODM are connected and initialized."""
    global _client, _initialized
    if not _initialized or _client is None:
        await init_db()


def close_db() -> None:
    """Close the MongoDB connection pool."""
    global _client, _initialized
    if _client is not None:
        _client.close()
        _client = None
        _initialized = False
        log.info("db: connection closed")


async def ping_db() -> bool:
    """Check MongoDB availability."""
    if _client is None:
        return False
    try:
        await _client.admin.command("ping")
        return True
    except Exception:
        return False
