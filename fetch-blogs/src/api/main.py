"""APIRouter aggregator — only health is active. Add routers here as you implement them."""

from __future__ import annotations

from fastapi import APIRouter

from src.api.routes.health import router as health_router

api_router = APIRouter()

# ── Active routes ─────────────────────────────────────────────────────────────
api_router.include_router(health_router)

# ── Inactive — uncomment as each feature is implemented ──────────────────────
# from src.api.routes.pipeline import router as pipeline_router
# api_router.include_router(pipeline_router)

# from src.api.routes.digests  import router as digests_router
# api_router.include_router(digests_router)

# from src.api.routes.profiles import router as profiles_router
# api_router.include_router(profiles_router)

# from src.api.routes.admin    import router as admin_router
# api_router.include_router(admin_router)
