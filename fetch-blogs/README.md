# fetch-blogs

Backend microservice for crawling technology blogs, ranking them by user preferences, and synthesizing a daily newsletter/digest.

Next.js communicates with this service via `GET /api/v1/digests/{user_id}/latest`.

---

## Quick Commands

```bash
# Local dev — infra in Docker, app on your machine
uv sync
docker compose up -d                                    # Mongo + Redis
uv run fastapi dev src/main.py                          # hot reload on :8000
uv run celery -A src.workers.celery_app worker -l info  # optional, if you need workers locally

# Production — everything in Docker
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# Formatting & Linting
uv run ruff format src                                  # Format codebase
uv run ruff check src --fix                             # Run linter and auto-fix violations
uv run mypy src --strict                                # Run strict type checking

# Execution & Testing
bash scripts/test.sh                                    # Run full quality gate (mypy + ruff + pytest)
```

---

## Current Status & Scope

The scrape → extract → rank → generate → publish chain is live. Next.js calls `POST /api/v1/digests/generate` and `GET /api/v1/digests/{user_id}/latest`.

* **Done**: Dev.to / HN / RSS scrapers, robots.txt cache, newspaper3k + Jina extraction, Gemini embeddings, TF-IDF + cosine + Gemini re-rank, digest synthesis, Mongo publisher, profile sync from Supabase, quiz learning-path write-back, health/pipeline/digest APIs, local eager mode (no Celery required).
* **Still stubs**: Reddit scraper, admin config CRUD, quality-gate module, dedicated prompt-builder module.
* **Not used (plan leftovers)**: Crawl4AI / Playwright, Ollama fallback.

Full walkthrough: `wiki/pages/fetch-blogs-walkthrough.md`.

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

## MongoDB + Beanie Storage Pattern

This service stores app data in MongoDB using Beanie ODM. Beanie is initialized in [src/core/db.py](src/core/db.py), and the active document models are defined in [src/models/article.py](src/models/article.py) and [src/models/profile.py](src/models/profile.py).

### 1) Database connection setup

The settings layer defines the Mongo connection values in [src/core/config.py](src/core/config.py):

```python
class MongoSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="MONGO_", extra="ignore")

    URI: str = "mongodb://localhost:27017"
    DB_NAME: str = "knowledge_portal"
```

At startup, the app creates an `AsyncIOMotorClient` and registers Beanie document models:

```python
_client = AsyncIOMotorClient(cfg.URI)

await init_beanie(
    database=_client[cfg.DB_NAME],
    document_models=[Article, UserProfile],
)
```

This happens inside `init_db()` during the FastAPI lifespan. The connection is closed in `close_db()` during shutdown.

### 2) How data is stored

Each Beanie document becomes a MongoDB collection.

#### Article collection

The `Article` model maps to the `articles` collection. It stores:
- canonical metadata: URL, title, source domain, author, published date
- content: summary, body text, topics, tags, embedding
- scoring data: `quality_score`, `ranking_breakdown`, `llm_rerank_reason`, `ranked_at`
- timestamps: `created_at`, `updated_at`

```python
class Article(Document):
    url: Indexed(HttpUrl, unique=True)
    title: str
    source_domain: Indexed(str)
    author: str = ""
    summary: str = ""
    body_text: str = ""
    topics: list[str] = Field(default_factory=list)
    embedding: list[float] = Field(default_factory=list)
    quality_score: float = Field(default=0.0, ge=0.0, le=1.0)

    class Settings:
        name = "articles"
        indexes = [
            "source_domain",
            "published_at",
            "quality_score",
            "topics",
            "tech_stack",
        ]
```

Because it subclasses `Document`, Beanie automatically serializes it into MongoDB documents with an ObjectId `_id` field and stores the typed fields as BSON values.

#### User profile collection

The `UserProfile` model maps to the `user_profiles` collection and stores preferences used for ranking and digest generation:

```python
class UserProfile(Document):
    user_id: Indexed(str, unique=True)
    name: str = ""
    years_of_experience: int = Field(default=0, ge=0)
    primary_tech_stack: list[str] = Field(default_factory=list)
    secondary_tech_stack: list[str] = Field(default_factory=list)
    interests: list[str] = Field(default_factory=list)
    preferred_sources: list[str] = Field(default_factory=list)
    profile_embedding: list[float] = Field(default_factory=list)
```

Each profile is uniquely keyed by `user_id`, which lets the app fetch or upsert personalization state quickly.

### 3) What gets persisted in MongoDB

In practice, the data flow is:
1. Scrapers collect article metadata and raw content.
2. Extractors enrich the article with `summary`, `body_text`, and `embedding`.
3. Ranking logic updates `quality_score` and `ranking_breakdown`.
4. User personalization is saved in `user_profiles`.
5. Beanie writes those typed Python objects directly to MongoDB collections.

### 4) Indexing and querying

Beanie indexes are declared inside each model's `Settings.indexes`. For example:
- `Article` is indexed by `source_domain`, `quality_score`, and topics for fast relevance queries
- `UserProfile` is indexed by `user_id` for fast profile lookup

This keeps common access patterns cheap without writing raw Motor queries in business logic.

### 5) Local setup

For local development, the repo expects a MongoDB instance on `mongodb://localhost:27017` and Redis on `redis://localhost:6379`. You can bring those up with:

```bash
cd fetch-blogs
docker compose up -d
```

Then start the FastAPI app on the host:

```bash
uv run fastapi dev src/main.py
```

This matches the project convention where infrastructure runs in Docker while the app runs locally.

---

## Docker

| Mode | Command | What runs |
|------|---------|-----------|
| **Dev** | `docker compose up -d` | MongoDB + Redis only |
| **Dev API** | `uv run fastapi dev src/main.py` | FastAPI on host (hot reload, port 8000) |
| **Prod** | `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` | Full stack: API (4 workers), Celery, Flower |

Dev `.env` points at `localhost` because the app runs on your laptop while Mongo and Redis live in Docker. Production compose swaps those for `mongo` / `redis` on the internal network — you don't need a second env file.

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
│   ├── extractors/           # newspaper3k / BeautifulSoup / Jina + Gemini embeddings
│   ├── ranker/               # numpy cosine similarity and LLM re-ranking
│   ├── generator/            # LLM newsletter generator & quality check gates
│   └── publisher/            # Persistence handlers
├── tests/                    # Unit and integration tests (mocked db/network)
├── scripts/                  # Lifespan/wait scripts and test runners
├── docker-compose.yml      # Dev: Mongo + Redis
└── docker-compose.prod.yml # Prod: adds API, workers, Flower
```

---

## Development Standards

* **Strict typing**: Every function must have complete type signatures (`mypy --strict` passes with zero warnings).
* **Linting & Formatting**: Enforced via `ruff`. Run `uv run ruff check src --fix` and `uv run ruff format src` before committing.
* **Database Access**: Must go through `Beanie` ODM documents instead of writing raw motor queries.
* **Queue Safety**: Tasks must pass only document IDs (`list[str]`) rather than copying raw scraped bodies into Redis.
