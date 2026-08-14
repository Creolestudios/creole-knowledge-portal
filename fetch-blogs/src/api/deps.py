"""
All Annotated dependency aliases live here.
Route handlers import these aliases — never use Depends() directly in route signatures.

Usage:
    from src.api.deps import RedisDep, InternalTokenDep

    async def my_route(redis: RedisDep) -> ...: ...
"""

from __future__ import annotations

from typing import Annotated, Any

import redis.asyncio as aioredis
from fastapi import Depends, Header, HTTPException, status

from src.core.config import get_auth_settings
from src.core.redis import get_redis

# ── Redis ─────────────────────────────────────────────────────────────────────
RedisDep = Annotated[aioredis.Redis[Any], Depends(get_redis)]


# ── X-Internal-Token header guard ─────────────────────────────────────────────
def _verify_internal_token(
    x_internal_token: Annotated[str | None, Header()] = None,
) -> None:
    cfg = get_auth_settings()
    if not x_internal_token or x_internal_token != cfg.SECRET_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid X-Internal-Token header.",
        )


InternalTokenDep = Annotated[None, Depends(_verify_internal_token)]
