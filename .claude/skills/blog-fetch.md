# Skill: Blog Fetch Module Workflows

## When to Use
Use when working on the `fetch-blogs/` Python microservice —
scraper additions, Beanie model changes, new FastAPI endpoints, Celery task chains,
type-safety fixes, Docker workflow, or benchmark runs.

> **Layout reminder:** all Python source lives under `fetch-blogs/src/` (not `app/`).
> All internal imports are `from src.<domain>.<module> import ...`.

---

## Workflow 1: Add a New RSS / API Scraper (Strategy A)

### Location
`fetch-blogs/src/scrapers/<scraper_name>.py`

### Template (fully type-annotated, mypy-strict compatible)
```python
"""<SourceName> scraper — Strategy A. Respects robots.txt. Free tier only."""
from __future__ import annotations

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential
import structlog

from src.config.robots_cache import RobotsCache
from src.models.article import Article, StrategySource
from src.core.config import get_scraping_settings

log = structlog.get_logger(__name__)


class <SourceName>Scraper:
    def __init__(self, robots: RobotsCache) -> None:
        self._robots = robots
        self._cfg = get_scraping_settings()
        self._client = httpx.AsyncClient(timeout=30.0)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(min=2, max=10))
    async def fetch(self, query: str, limit: int = 20) -> list[Article]:
        """Fetch articles. Always check robots.txt compliance first."""
        log.info("fetching", source="<source_name>", query=query)
        # 1. Check robots.txt
        # 2. Fetch + parse
        # 3. Return list[Article] — don't call .insert() here; that's publisher's job
        return []

    async def aclose(self) -> None:
        await self._client.aclose()
```

### Checklist
- [ ] `robots.txt` check via `src/config/robots_cache.py` before any HTTP call
- [ ] Add to `src/scrapers/__init__.py`
- [ ] Add to `src/workers/scraper_tasks.py` (Celery task chain)
- [ ] Add source domains to `src/config/source_registry.py`
- [ ] Add unit test: `tests/unit/test_scrapers_<name>.py` — mock `httpx.AsyncClient`
- [ ] Run `uv run mypy src --strict` — zero errors
- [ ] Run `uv run ruff check src --fix`

---

## Workflow 2: Add a New Beanie Document (MongoDB Collection)

### Location
`fetch-blogs/src/models/<collection>.py`

### Template
```python
"""<CollectionName> Beanie document — MongoDB collection `<collection_name>`."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from beanie import Document, Indexed
from pydantic import Field


class <CollectionName>(Document):
    field_one: Annotated[str, Indexed(unique=True)]
    field_two: str = Field(min_length=1, max_length=256)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )

    class Settings:
        name = "<collection_name>"           # MongoDB collection name (snake_case)
        indexes = [
            [("created_at", -1)],
        ]
```

### Register in `src/core/db.py`
```python
from src.models.<collection> import <CollectionName>

# Inside init_beanie() call, add to document_models list:
document_models=[..., <CollectionName>]
```

### Checklist
- [ ] All fields typed — no bare `Any`
- [ ] Registered in `src/core/db.init_beanie()` document_models list
- [ ] `class Settings.name` is `lower_case_snake`
- [ ] Indexes declared in `Settings.indexes` (not in migration scripts — Beanie auto-creates)
- [ ] Exported from `src/models/__init__.py`
- [ ] `uv run mypy src --strict` passes

---

## Workflow 3: Add a New FastAPI Endpoint (Python microservice)

### Location
`fetch-blogs/src/api/routes/<resource>.py`

### Template (Annotated deps, response_model, status code, full docs)
```python
"""<Resource> routes — /api/v1/<resource>"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, status

from src.api.deps import RedisDep        # pre-built Annotated alias
from src.models.<resource> import <ResourceModel>
from src.schemas.<resource> import <ResourceOut>, <ResourceCreate>

router = APIRouter(prefix="/<resource>", tags=["<resource>"])


@router.get(
    "/{resource_id}",
    response_model=<ResourceOut>,
    summary="Get a single <resource>",
    responses={
        status.HTTP_404_NOT_FOUND: {"description": "<Resource> not found"},
    },
)
async def get_<resource>(resource_id: str) -> <ResourceOut>:
    doc = await <ResourceModel>.get(resource_id)
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="<Resource> not found.",
        )
    return <ResourceOut>.model_validate(doc)


@router.post(
    "/",
    response_model=<ResourceOut>,
    status_code=status.HTTP_201_CREATED,
    summary="Create a <resource>",
)
async def create_<resource>(payload: <ResourceCreate>) -> <ResourceOut>:
    doc = <ResourceModel>(**payload.model_dump())
    await doc.insert()
    return <ResourceOut>.model_validate(doc)
```

### Register in `src/api/main.py`
```python
from src.api.routes.<resource> import router as <resource>_router
api_router.include_router(<resource>_router)
```

### Checklist
- [ ] `Annotated[T, Depends(...)]` form — never default-arg `Depends`
- [ ] `response_model=` set and matches return type annotation
- [ ] `status_code=` explicit on POST/DELETE
- [ ] Endpoint documented: `summary`, `tags`, `responses` for error codes
- [ ] Never return the ORM Document directly — always `Schema.model_validate(doc)`
- [ ] `uv run mypy src --strict` passes

---

## Workflow 4: Add a Celery Task

### Location
`fetch-blogs/src/workers/<stage>_tasks.py`

### Template
```python
"""Stage N: <description>"""
from __future__ import annotations

import asyncio
from celery import shared_task
from celery.utils.log import get_task_logger

log = get_task_logger(__name__)


@shared_task(
    bind=True,
    queue="<stage>_queue",
    max_retries=3,
    default_retry_delay=60,
    acks_late=True,
)
def run_<stage>_stage(
    self: shared_task,           # type: ignore[type-arg]
    article_ids: list[str],
) -> list[str]:
    """
    Pass only IDs between stages — never large payloads.
    Fetch the document from MongoDB inside the task.
    """
    try:
        return asyncio.run(_async_stage(article_ids))
    except Exception as exc:
        log.exception("stage failed", stage="<stage>", exc=str(exc))
        raise self.retry(exc=exc) from exc


async def _async_stage(article_ids: list[str]) -> list[str]:
    # initialise Beanie here (worker process needs its own DB connection)
    from src.core.db import init_db
    await init_db()
    # ... process and return updated article_ids
    return article_ids
```

### Checklist
- [ ] Task registered in `celery_app.include` list
- [ ] Uses `acks_late=True` on the decorator
- [ ] Only passes `list[str]` (IDs) between tasks — no large payloads in Redis
- [ ] Initialises Beanie inside the task (workers have their own process)
- [ ] `uv run mypy src --strict` passes

---

## Workflow 5: Trigger Pipeline Manually (Docker)

```bash
cd fetch-blogs/

# 1. Start all services
docker compose up

# 2. Trigger pipeline (requires X-Internal-Token header)
curl -X POST http://localhost:8000/api/v1/pipeline/trigger \
  -H "X-Internal-Token: <AUTH_SECRET_KEY from .env>" \
  -H "Content-Type: application/json" \
  -d '{"user_profile_id": "00000000-0000-0000-0000-000000000001"}'

# 3. Poll status
curl http://localhost:8000/api/v1/pipeline/status/<task_id>

# 4. Read latest digest (consumed by Next.js)
curl http://localhost:8000/api/v1/digests/00000000-0000-0000-0000-000000000001/latest

# 5. Monitor Celery workers
open http://localhost:5555   # Flower UI
```

---

## Workflow 6: Run the Full Quality Gate

```bash
cd fetch-blogs/

# Type check (must be zero errors)
uv run mypy src --strict

# Lint (auto-fix)
uv run ruff check src --fix

# Format
uv run ruff format src

# Tests with coverage (must be ≥ 80%)
uv run pytest --cov=src --cov-report=term-missing

# One-liner gate (same order as CI)
uv run mypy src --strict && \
  uv run ruff check src && \
  uv run ruff format --check src && \
  uv run pytest --cov=src --cov-fail-under=80
```

---

## Workflow 7: Run the Strategy Benchmark

```bash
# Trigger all 3 strategies for a profile and compare
curl -X POST http://localhost:8000/api/v1/pipeline/trigger \
  -H "X-Internal-Token: <token>" \
  -d '{"user_profile_id": "<uuid>", "strategy": "A"}'

curl -X POST http://localhost:8000/api/v1/pipeline/trigger \
  -H "X-Internal-Token: <token>" \
  -d '{"user_profile_id": "<uuid>", "strategy": "B"}'

curl -X POST http://localhost:8000/api/v1/pipeline/trigger \
  -H "X-Internal-Token: <token>" \
  -d '{"user_profile_id": "<uuid>", "strategy": "C"}'
```

Expected output: `DigestOut` JSON for each strategy. Compare `metadata.generation_latency_seconds`
and `metadata.llm_tokens_used`. Strategy C is the default in production.

---

## Anti-Patterns to Never Introduce

| Anti-pattern | Why wrong | Fix |
|---|---|---|
| `import requests` inside `async def` | Blocks event loop | `httpx.AsyncClient` |
| `from app.core.config import` | Wrong package root | `from src.core.config import` |
| `model.dict()` | Pydantic v1 API | `model.model_dump()` |
| `Field(ge=18, default=None)` | Constraint contradiction | Use `int \| None = Field(default=None, ge=18)` |
| `def route(dep = Depends(...))` | Legacy form | `dep: Annotated[T, Depends(...)]` |
| Large payload in Celery task | Redis memory bloat | Pass only `list[str]` IDs |
| `except Exception:` in route | Hides bugs | Catch specific exception, raise `HTTPException` |
| Missing return type annotation | Fails mypy strict | Add `-> ReturnType` to every function |
