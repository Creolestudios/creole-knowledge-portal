# Skill: Blog Fetch Module Workflows

## When to Use
Use when working on the `fetch-blogs/` Python/FastAPI module —
scraper additions, strategy changes, new endpoints, or benchmark runs.

---

## Workflow 1: Add a New RSS/API Scraper (Strategy A)

### Location
`fetch-blogs/src/scrapers/<scraper_name>.py`

### Template
```python
"""
<SourceName> scraper — Strategy A
Respects robots.txt. Free tier only.
"""
import httpx
import feedparser
from tenacity import retry, stop_after_attempt, wait_exponential
from structlog import get_logger
from ..models.article import RawArticle
from ..config.settings import Settings

log = get_logger(__name__)

class <SourceName>Scraper:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.client = httpx.AsyncClient(timeout=30.0)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def fetch(self, query: str, limit: int = 20) -> list[RawArticle]:
        """Fetch articles. Always check robots.txt compliance first."""
        log.info("fetching", source="<source_name>", query=query)
        # TODO: implement actual fetch
        return []

    async def close(self):
        await self.client.aclose()
```

### Checklist
- [ ] Add `robots.txt` check via `config/robots_cache.py`
- [ ] Add to `src/scrapers/__init__.py`
- [ ] Add to Strategy A's fetch pipeline in `src/scrapers/pipeline.py`
- [ ] Add unit test with mocked HTTP in `tests/scrapers/test_<name>.py`
- [ ] Add source domains to `config/source_registry.py`

---

## Workflow 2: Run the Benchmark

```bash
cd fetch-blogs
# Start FastAPI service first
uvicorn src.api.main:app --reload --port 8000

# Trigger benchmark for a profile
curl -X POST http://localhost:8000/api/benchmark/run \
  -H "Content-Type: application/json" \
  -d '{"profile_id": "<uuid>"}'

# Get results
curl http://localhost:8000/api/benchmark/results/<profile_id>
```

Expected output: JSON comparison of strategies A, B, C with all `StrategyBenchmark` fields.

---

## Workflow 3: Add a New FastAPI Endpoint

### Location
`fetch-blogs/src/api/routes/<resource>.py`

### Template
```python
from fastapi import APIRouter, HTTPException, Depends
from ..models.user_profile import UserProfile
from ..storage.repository import ArticleRepository
from structlog import get_logger

router = APIRouter(prefix="/api/<resource>", tags=["<resource>"])
log = get_logger(__name__)

@router.get("/{id}")
async def get_resource(
    id: str,
    repo: ArticleRepository = Depends()
):
    result = await repo.get_by_id(id)
    if not result:
        raise HTTPException(status_code=404, detail="Not found")
    return result
```

### Register in `src/api/main.py`
```python
from .routes.<resource> import router as <resource>_router
app.include_router(<resource>_router)
```

---

## Workflow 4: Trigger a Manual Digest

```bash
curl -X POST http://localhost:8000/api/digests/generate \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "<uuid>",
    "strategy": "C"
  }'
```

Check result:
```bash
curl http://localhost:8000/api/digests/<user_id>/latest
```

Validate JSON matches the `DigestOutput` TypeScript interface in `.claude/rules/blog-fetch-rules.md`.

---

## Workflow 5: Run Python Tests

```bash
cd fetch-blogs
python -m pytest tests/ -v
python -m pytest tests/scrapers/ -v   # scraper-specific
python -m pytest tests/ --cov=src     # with coverage
```

All tests must mock external HTTP — never hit real APIs in tests.
