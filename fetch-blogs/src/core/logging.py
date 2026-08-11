"""
structlog configuration.

Call `configure_logging(log_level)` once in the FastAPI lifespan.
All other modules use `structlog.get_logger(__name__)`.

Local dev → pretty ConsoleRenderer
Staging / Production → JSON (machine-parseable by log aggregators)
"""

from __future__ import annotations

import logging
import sys

import structlog

from src.core.config import Environment, get_app_settings


def configure_logging(log_level: str = "INFO") -> None:
    """Configure structlog — JSON in production, pretty colours in dev."""
    cfg = get_app_settings()
    is_production = cfg.ENVIRONMENT == Environment.PRODUCTION

    shared_processors: list[structlog.types.Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.stdlib.add_log_level,
    ]

    if is_production:
        renderer: structlog.types.Processor = structlog.processors.JSONRenderer()
    else:
        renderer = structlog.dev.ConsoleRenderer(colors=True)

    structlog.configure(
        processors=[*shared_processors, renderer],
        wrapper_class=structlog.make_filtering_bound_logger(
            logging.getLevelNamesMapping().get(log_level.upper(), logging.INFO)
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(file=sys.stdout),
        cache_logger_on_first_use=True,
    )
