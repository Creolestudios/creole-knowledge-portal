# Blog Fetch Plan — Full Implementation Reference

Condensed from the approved implementation plan for agent consumption.
Source of truth: `implementation_plan.md` in the project artifacts.

## Goal
Generate a **15–20 minute personalised tech article digest** daily for each user profile,
synthesised from free public sources, stored in **MongoDB** via Beanie ODM, and served
to the Next.js dashboard via FastAPI REST.

## User Profile Shape (Beanie Document)
```python
class UserProfile(Document):
    user_id: str
    name: str
    years_of_experience: int           # 0-1 = junior, 2-5 = mid, 6+ = senior
    primary_tech_stack: list[str]      # e.g. ["Python", "FastAPI", "MongoDB"]
    secondary_tech_stack: list[str]
    interests: list[str]               # e.g. ["distributed-systems", "MLOps"]
    current_role: str
    preferred_content_depth: str | None = None   # auto-derived from YOE
    excluded_topics: list[str] = []
    preferred_sources: list[str] = []
    content_freshness_days: int = 30
    profile_embedding: list[float] = []          # Gemini text-embedding-004
```
Auto-derive depth: 0–1 YOE → beginner, 2–5 → intermediate, 6+ → advanced.

## Strategy A: Traditional (No LLM)
- **Sources:** RSS (Medium, Substack, personal blogs), HN API, Dev.to API, Reddit API
- **Extraction:** `feedparser` → `readability-lxml` / `trafilatura` / Crawl4AI fallback
- **Scoring:** `0.35×TF-IDF + 0.25×authority + 0.15×recency + 0.15×engagement + 0.10×complexity_fit`
- **Curated Registry:** ~200 feeds across Systems, Python, Frontend, AI/ML, DevOps, Career

## Strategy B: LLM-Powered
- **Query gen:** Gemini 2.0 Flash or Ollama (llama3.1)
- **Crawl:** Crawl4AI (self-hosted Playwright) → `r.jina.ai/{url}` fallback
- **Embeddings:** Gemini `text-embedding-004` (768-dim, free tier)
- **Ranking:** numpy cosine sim (self-hosted Mongo) + Gemini re-ranker on top-50
- **Quality:** LLM evaluates accuracy, depth, actionability, originality

## Strategy C: Hybrid (Production Default)
1. Fetch via Strategy A's RSS + API pipeline
2. Extract with Crawl4AI / trafilatura
3. Rank via Strategy B's numpy cosine + Gemini re-ranking
4. Synthesise with Gemini Flash / Ollama fallback

## Celery Pipeline Stages
| Stage | Queue | Celery task module |
|---|---|---|
| 1 — Scrape | `scrape_queue` | `src.workers.scraper_tasks` |
| 2 — Extract | `extract_queue` | `src.workers.extractor_tasks` |
| 3 — Rank | `rank_queue` | `src.workers.ranker_tasks` |
| 4 — Generate | `generate_queue` | `src.workers.generator_tasks` |
| 5 — Publish | `publish_queue` | `src.workers.publisher_tasks` |

Stages are chained: each passes `list[str]` (article IDs) to the next.
Beanie documents are fetched inside each worker from MongoDB.

## MongoDB Collections (Beanie Documents)
| Document class | Collection name | Key fields |
|---|---|---|
| `Article` | `articles` | `url` (unique), `embedding`, `quality_score` |
| `DailyDigest` | `daily_digests` | `user_id`, `generated_at`, `article` (DigestArticle JSON) |
| `UserProfile` | `user_profiles` | `user_id`, `profile_embedding` |
| `PipelineJob` | `pipeline_jobs` | `task_id`, `status`, `user_profile_id` |
| `AdminConfig` | `admin_configs` | Key-value store for admin settings |

## Vector Search (Self-Hosted Mongo → Future Atlas)
```python
# src/ranker/vector_search.py
# Current: numpy cosine similarity over Motor cursor
# Future migration: replace this file's function with $vectorSearch aggregation
# Zero other code changes needed for Atlas migration
```

## Environment Variables (domain-prefixed)
```bash
APP_ENVIRONMENT=local           # local | staging | production
MONGO_URI=mongodb://mongo:27017
MONGO_DB_NAME=knowledge_portal
REDIS_URL=redis://redis:6379/0              # broker
REDIS_RESULT_URL=redis://redis:6379/1       # result backend
AUTH_SECRET_KEY=<32-char random string>
LLM_GEMINI_API_KEY=<key>
SCRAPING_CRON_SCHEDULE="30 0 * * *"        # 06:00 IST = 00:30 UTC
```

## Benchmark Metrics
```python
class StrategyBenchmark(BaseModel):
    strategy: Literal["A", "B", "C"]
    profile_id: str
    articles_fetched: int
    articles_after_dedup: int
    avg_relevance_score: float      # 0–1
    latency_seconds: float
    llm_tokens_used: int
    synthesis_quality_score: float  # human-rated 1–10
    reading_time_accuracy: float
```

## Synthesis Rules
- Target: 3,750–5,000 words (midpoint: 4,375)
- Prose: 250 WPM / Code: 100 WPM / Image: +12s
- Max 2 refinement iterations
- LLM priority: Gemini 2.0 Flash → Gemini 1.5 Pro → Llama 3.1 8B (Ollama) → Mistral 7B (Ollama)

## Developer Commands
```bash
cd fetch-blogs/

# First-time setup
cp .env.example .env                  # fill in secrets
uv sync                               # install all deps
uv run pre-commit install             # enable git hooks

# Run locally with Docker
docker compose up                     # all 8 services with hot reload

# Quality gate (same as CI)
uv run mypy src --strict && \
  uv run ruff check src && \
  uv run ruff format --check src && \
  uv run pytest --cov=src --cov-fail-under=80
```
