"""
FastAPI application factory.

Entry point: `fastapi run --workers 4 src/main.py`
             or via Docker Compose: see CMD in Dockerfile
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

import structlog
from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

    from fastapi.routing import APIRoute

from src.api.main import api_router
from src.core.config import get_app_settings
from src.core.db import close_db, init_db
from src.core.logging import configure_logging


def strip_root_path(path: str, root_path: str) -> str:
    """Drop the ALB app prefix so FastAPI sees /api/v1/... not /{app}/api/v1/..."""
    prefix = (root_path or "").rstrip("/")
    if not prefix:
        return path
    if path == prefix:
        return "/"
    if path.startswith(prefix + "/"):
        stripped = path[len(prefix) :]
        return stripped or "/"
    return path


class StripRootPathMiddleware:
    """ASGI wrapper: ALB forwards /creole-knowledge-portal/api/... unchanged."""

    def __init__(self, app, root_path: str = "") -> None:
        self.app = app
        self.root_path = (root_path or "").rstrip("/")

    async def __call__(self, scope, receive, send):
        if self.root_path and scope["type"] in {"http", "websocket"}:
            path = str(scope.get("path") or "")
            stripped = strip_root_path(path, self.root_path)
            if stripped != path:
                scope = {**scope, "path": stripped, "root_path": self.root_path}
        await self.app(scope, receive, send)


log = structlog.get_logger(__name__)


def _unique_op_id(route: APIRoute) -> str:
    """Stable, unique operationId for OpenAPI (avoids duplicate names)."""
    tag = route.tags[0] if route.tags else "default"
    return f"{tag}-{route.name}"


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    """FastAPI lifespan: runs startup before yield, shutdown after."""
    cfg = get_app_settings()
    configure_logging(cfg.LOG_LEVEL)
    log.info("startup", env=cfg.ENVIRONMENT)

    # ── Startup ───────────────────────────────────────────────────────────
    await init_db()

    # Start APScheduler (cron → enqueues Celery task)
    from src.core.scheduler import start_scheduler, stop_scheduler

    start_scheduler()

    # ── App is running ────────────────────────────────────────────────────
    yield

    # ── Shutdown ──────────────────────────────────────────────────────────
    stop_scheduler()
    close_db()
    log.info("shutdown complete")


def create_app() -> FastAPI:
    """Application factory — call once, reuse the returned `app`."""
    cfg = get_app_settings()

    # Sentry — only outside local dev
    if cfg.SENTRY_DSN and cfg.ENVIRONMENT != "local":
        import sentry_sdk

        sentry_sdk.init(dsn=str(cfg.SENTRY_DSN), enable_tracing=True)

    application = FastAPI(
        title=cfg.PROJECT_NAME,
        openapi_url=f"{cfg.API_V1_STR}/openapi.json" if cfg.show_docs else None,
        generate_unique_id_function=_unique_op_id,
        lifespan=lifespan,
    )

    application.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:3000"],  # Next.js dev server
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    application.include_router(api_router, prefix=cfg.API_V1_STR)
    if cfg.ROOT_PATH:
        application.add_middleware(StripRootPathMiddleware, root_path=cfg.ROOT_PATH)
    return application


# Module-level `app` required by `fastapi run src/main.py`
app = create_app()
