# fetch-blogs

Backend microservice for crawling technology blogs, ranking them by user preferences, and synthesizing a daily newsletter/digest.

Next.js communicates with this service via `GET /api/v1/digests/{user_id}/latest`.

---

## Quick Commands

```bash
# Development
uv sync                                                 # Install dependencies and setup venv
uv run fastapi dev src/main.py                          # Start local dev server (auto-reload on port 8000)
uv run celery -A src.workers.celery_app worker -l info  # Start Celery worker processes

# Formatting & Linting
uv run ruff format src                                  # Format codebase
uv run ruff check src --fix                             # Run linter and auto-fix violations
uv run mypy src --strict                                # Run strict type checking

# Execution & Testing
docker compose up                                       # Run full stack in Docker (API, DB, Redis, Workers)
bash scripts/test.sh                                    # Run full quality gate (mypy + ruff + pytest)
```

---

## Current Status & Scope

This service is in a staged implementation phase:
* **Active**: Configuration validation, database and Redis connection pooling, Celery worker setup, health check APIs (`/health`, `/health/live`, `/health/ready`), and the rank stage's Article/UserProfile contracts plus deterministic scoring, vector similarity, and Gemini-assisted re-ranking with fallback.
* **Stubs**: Blog scrapers, text extractors, digest synthesis, publisher, and several API route handlers remain placeholders to be implemented.

---

## Configuration (.env)

Create a `.env` file in the root of this directory. Refer to `.env.example` for details:

```bash
APP_ENVIRONMENT=local
MONGO_URI=mongodb://localhost:27017
REDIS_URL=redis://localhost:6379/0
REDIS_RESULT_URL=redis://localhost:6379/1
AUTH_SECRET_KEY=some-random-key
LLM_GEMINI_API_KEY=your-api-key
```

Settings are split by domain (e.g. `MongoSettings`, `RedisSettings`) using `pydantic-settings` to avoid loading unused configuration options in worker processes.

---

## Project Layout

```
fetch-blogs/
├── src/
│   ├── main.py               # FastAPI application entrypoint and lifespan management
│   ├── core/                 # Shared infrastructure (database/redis pools, logger, scheduler, security)
│   ├── models/               # Beanie ODM document models (MongoDB collections)
│   ├── schemas/              # Pydantic validation schemas
│   ├── api/                  # FastAPI routers and dependency injections
│   ├── workers/              # Celery task definitions and worker configuration
│   ├── scrapers/             # Blog crawl adapters (RSS, HackerNews, Dev.to, Reddit)
│   ├── extractors/           # Content cleaning (Crawl4AI) and text embeddings (Gemini)
│   ├── ranker/               # numpy cosine similarity and LLM re-ranking
│   ├── generator/            # LLM newsletter generator & quality check gates
│   └── publisher/            # Persistence handlers
├── tests/                    # Unit and integration tests (mocked db/network)
├── scripts/                  # Lifespan/wait scripts and test runners
└── docker-compose.yml        # Multi-container local execution setup
```

---

## Development Standards

* **Strict typing**: Every function must have complete type signatures (`mypy --strict` passes with zero warnings).
* **Linting & Formatting**: Enforced via `ruff`. Run `uv run ruff check src --fix` and `uv run ruff format src` before committing.
* **Database Access**: Must go through `Beanie` ODM documents instead of writing raw motor queries.
* **Queue Safety**: Tasks must pass only document IDs (`list[str]`) rather than copying raw scraped bodies into Redis.
