"""APIRouter aggregator — health and digests are active."""

from __future__ import annotations

from fastapi import APIRouter

from src.api.routes.health import router as health_router
from src.api.routes.digests import router as digests_router

api_router = APIRouter()

# ── Active routes ─────────────────────────────────────────────────────────────
api_router.include_router(health_router)
api_router.include_router(digests_router)
