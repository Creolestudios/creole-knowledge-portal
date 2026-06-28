"""Async Redis connection pool."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

import redis.asyncio as aioredis
import structlog

from src.core.config import get_redis_settings

log = structlog.get_logger(__name__)

_pool: aioredis.ConnectionPool[Any] | None = None


def _build_pool() -> aioredis.ConnectionPool[Any]:
    cfg = get_redis_settings()
    log.info("redis: building connection pool", url=cfg.URL)
    return aioredis.ConnectionPool.from_url(
        cfg.URL,
        max_connections=20,
        decode_responses=True,
    )


def get_redis_pool() -> aioredis.ConnectionPool[Any]:
    """Get the shared connection pool."""
    global _pool
    if _pool is None:
        _pool = _build_pool()
    return _pool


def get_redis_client() -> aioredis.Redis[Any]:
    """Get a standalone Redis client instance."""
    return aioredis.Redis(connection_pool=get_redis_pool())


async def get_redis() -> AsyncGenerator[aioredis.Redis[Any], None]:
    """FastAPI dependency yielding a Redis client."""
    client: aioredis.Redis[Any] = aioredis.Redis(connection_pool=get_redis_pool())
    try:
        yield client
    finally:
        await client.close()


async def ping_redis() -> bool:
    """Check Redis connection availability."""
    try:
        client = get_redis_client()
        result = await client.ping()
        return bool(result)
    except Exception:
        return False
