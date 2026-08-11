"""
Health check routes.

GET  /api/v1/health        — full liveness + dependency pings
GET  /api/v1/health/live   — simple process-alive probe (no I/O)
GET  /api/v1/health/ready  — readiness: MongoDB + Redis must respond
"""

from __future__ import annotations

from enum import StrEnum

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from src.core.db import ping_db
from src.core.redis import ping_redis

router = APIRouter(prefix="/health", tags=["health"])


class ServiceStatus(StrEnum):
    OK = "ok"
    DEGRADED = "degraded"
    DOWN = "down"


class DependencyHealth(BaseModel):
    status: ServiceStatus
    latency_ms: float | None = None
    error: str | None = None


class HealthOut(BaseModel):
    status: ServiceStatus  # overall status
    version: str = "0.1.0"
    mongo: DependencyHealth
    redis: DependencyHealth


async def _check_mongo() -> DependencyHealth:
    import time

    t0 = time.monotonic()
    try:
        ok = await ping_db()
        latency = round((time.monotonic() - t0) * 1000, 2)
        return DependencyHealth(
            status=ServiceStatus.OK if ok else ServiceStatus.DOWN,
            latency_ms=latency,
        )
    except Exception as exc:
        return DependencyHealth(status=ServiceStatus.DOWN, error=str(exc))


async def _check_redis() -> DependencyHealth:
    import time

    t0 = time.monotonic()
    try:
        ok = await ping_redis()
        latency = round((time.monotonic() - t0) * 1000, 2)
        return DependencyHealth(
            status=ServiceStatus.OK if ok else ServiceStatus.DOWN,
            latency_ms=latency,
        )
    except Exception as exc:
        return DependencyHealth(status=ServiceStatus.DOWN, error=str(exc))


# ── Routes ───────────────────────────────────────────────────────────────────


@router.get(
    "",
    response_model=HealthOut,
    summary="Full health check (liveness + dependency pings)",
)
async def health() -> JSONResponse:
    """
    Pings MongoDB and Redis. Returns 200 if all dependencies are healthy,
    503 if any dependency is down.
    """
    mongo = await _check_mongo()
    redis_ = await _check_redis()

    all_ok = mongo.status == ServiceStatus.OK and redis_.status == ServiceStatus.OK
    overall = ServiceStatus.OK if all_ok else ServiceStatus.DEGRADED

    body = HealthOut(status=overall, mongo=mongo, redis=redis_)
    http_status = status.HTTP_200_OK if all_ok else status.HTTP_503_SERVICE_UNAVAILABLE

    return JSONResponse(content=body.model_dump(), status_code=http_status)


@router.get(
    "/live",
    summary="Liveness probe — process is up (no I/O)",
    status_code=status.HTTP_200_OK,
)
async def liveness() -> dict[str, str]:
    """Kubernetes liveness probe — returns immediately without hitting DB or Redis."""
    return {"status": "ok"}


@router.get(
    "/ready",
    summary="Readiness probe — MongoDB + Redis must respond",
)
async def readiness() -> JSONResponse:
    """
    Kubernetes readiness probe.
    Returns 200 when both MongoDB and Redis respond, 503 otherwise.
    """
    mongo = await _check_mongo()
    redis_ = await _check_redis()
    ready = mongo.status == ServiceStatus.OK and redis_.status == ServiceStatus.OK

    body = {
        "ready": ready,
        "mongo": mongo.model_dump(),
        "redis": redis_.model_dump(),
    }
    return JSONResponse(
        content=body,
        status_code=status.HTTP_200_OK if ready else status.HTTP_503_SERVICE_UNAVAILABLE,
    )
