"""MongoDB connection and Beanie ODM initialization."""

from __future__ import annotations

import structlog
from beanie import init_beanie
from motor.motor_asyncio import AsyncIOMotorClient

# pyrefly: ignore [missing-import]
from src.core.config import get_mongo_settings

log = structlog.get_logger(__name__)

_client: AsyncIOMotorClient | None = None  # type: ignore[type-arg]


async def init_db() -> None:
    """Initialize the MongoDB client and Beanie ODM."""
    global _client
    cfg = get_mongo_settings()

    log.info("db: connecting", uri=cfg.URI, db=cfg.DB_NAME)
    _client = AsyncIOMotorClient(cfg.URI)

    # Register Beanie models as they are implemented
    document_models: list[type] = []
    # from src.models.article import Article        # ← uncomment when ready
    # from src.models.digest  import DailyDigest   # ← uncomment when ready
    # from src.models.profile import UserProfile    # ← uncomment when ready
    # from src.models.job     import PipelineJob    # ← uncomment when ready
    # from src.models.admin   import AdminConfig    # ← uncomment when ready

    await init_beanie(
        database=_client[cfg.DB_NAME],
        document_models=document_models,
    )
    log.info("db: ready")


async def close_db() -> None:
    """Close the MongoDB connection pool."""
    if _client is not None:
        _client.close()
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
