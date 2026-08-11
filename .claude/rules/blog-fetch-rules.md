# Blog Fetch Module — Architecture Rules

## Overview
The `fetch-blogs/` directory is a **fully standalone Python microservice** living inside
the Next.js monorepo. It has **zero runtime coupling** to Next.js. The Next.js app
reads its output via HTTP only.

## Package Layout (Locked)
- Source root: `fetch-blogs/src/` — all internal imports use `from src.<domain>.<module>`
- Package manager: `uv` — all deps pinned in `uv.lock`, committed to version control
- Entry point: `src/main.py` → `create_app()` factory → `app = create_app()`

## Tech Stack (Locked)
| Layer | Technology | Notes |
|---|---|---|
| Framework | FastAPI 0.115+ | `Annotated[T, Depends(...)]` only |
| ORM | Beanie ODM 1.26+ | Pydantic v2 Documents |
| Async driver | Motor 3.4+ | Managed by Beanie |
| Queue broker | Redis 7 `db=0` | Celery broker |
| Queue results | Redis 7 `db=1` | Celery result backend |
| Workers | Celery 5.4+ | 5 queues, 1 container per queue |
| Type checking | `mypy --strict` | Zero errors required |
| Linting | `ruff 0.6+` | ANN + full rule set |
| Pre-commit | ruff + mypy + detect-secrets | Runs on every `git commit` |
| Containers | Docker Compose | All services: API, 5 workers, Flower, Mongo, Redis |
| Scraping | Crawl4AI (Playwright) | Baked into Docker image |
| LLM / Embeddings | Gemini 2.0 Flash + text-embedding-004 | Free tier; Ollama fallback |
| Monitoring | Flower `:5555` | Celery dashboard |

## Three Strategies (Always Build Independently)
- **Strategy A** — Traditional: RSS + free APIs + TF-IDF/BM25 ranking (zero LLM cost)
- **Strategy B** — LLM-Powered: Crawl4AI + Gemini embeddings + semantic re-ranking
- **Strategy C** — Hybrid (preferred): Strategy A fetch pipeline + Strategy B ranking + Gemini synthesis

> Default to Strategy C in production. Benchmark all three before choosing per user profile.

## Content Policy (Non-Negotiable)
- Always check and respect `robots.txt` before scraping any domain
- Use `src/config/robots_cache.py` — Redis-cached, never re-fetch on every request
- Maintain a blocklist of domains that disallow scraping
- Never scrape paywalled content

## Free-Tier API Constraints
| Source | Limit | Handle By |
|--------|-------|-----------|
| Gemini 2.0 Flash | 15 RPM / 1M TPD | Rate limiter + Ollama fallback |
| Dev.to API | 30 req/min | `tenacity` retry with backoff |
| Reddit API | 60 req/min | `tenacity` retry with backoff |
| Google Custom Search | 100/day | Cache results aggressively |

## Settings — Domain Split (Mandatory)
Each module imports **only its own settings class**:

| Domain | Class | Env Prefix |
|---|---|---|
| App / FastAPI | `AppSettings` | `APP_` |
| MongoDB | `MongoSettings` | `MONGO_` |
| Redis / Celery | `RedisSettings` | `REDIS_` |
| Auth / JWT | `AuthSettings` | `AUTH_` |
| LLM / Gemini | `LLMSettings` | `LLM_` |
| Scraping / Cron | `ScrapingSettings` | `SCRAPING_` |

Never import from another domain's settings class.

## Beanie Document Conventions
- Document class → one MongoDB collection
- `class Settings.name` must be `lower_case_snake` (e.g. `"daily_digests"`)
- All indexes declared in `Settings.indexes` — Beanie auto-creates on startup
- Never call raw Motor methods in business logic — use Beanie Document methods
- Register every Document in `src/core/db.init_beanie()` document_models list

## Celery Task Chain
```
scrape_queue → extract_queue → rank_queue → generate_queue → publish_queue
```
- Each stage receives and returns only `list[str]` (article IDs) — no large Redis payloads
- Every task: `acks_late=True`, `max_retries=3`, `default_retry_delay=60`
- Each worker container handles exactly one queue

## Data Flow
1. APScheduler (cron `SCRAPING_CRON_SCHEDULE`) or `POST /api/v1/pipeline/trigger`
2. `scrape_queue` — feedparser/HN/Dev.to/Reddit → Article documents inserted to Mongo
3. `extract_queue` — Crawl4AI content extraction → updates Article.body_text + embedding
4. `rank_queue` — numpy cosine sim + Gemini re-rank → sets Article.quality_score
5. `generate_queue` — Gemini synthesis → builds DigestArticle JSON
6. `publish_queue` — Beanie upsert → DailyDigest document written
7. Next.js calls `GET /api/v1/digests/{user_id}/latest` → receives DigestOut

## Output Contract (for Next.js) — Source of Truth
The digest JSON shape **must exactly match** this TypeScript interface:
```typescript
interface DigestOutput {
  digest_id: string;                   // MongoDB _id as string
  generated_at: string;                // ISO 8601 UTC timestamp
  user_id: string;
  strategy_used: 'A' | 'B' | 'C';
  reading_time_minutes: number;        // target: 15–20
  word_count: number;                  // target: 3750–5000
  article: {
    headline: string;
    tldr: string[];
    sections: Array<{
      title: string;
      content: string;                 // Markdown
      sources_cited: number[];         // indexes into article.sources[]
      estimated_read_minutes: number;
    }>;
    key_takeaways: string[];
    sources: Array<{
      id: number;
      title: string;
      url: string;
      author: string;
      source_domain: string;
      published_at: string;            // ISO 8601
    }>;
    further_reading: Array<{ title: string; url: string }>;
  };
  metadata: {
    articles_evaluated: number;
    articles_used_in_synthesis: number;
    llm_tokens_used: number;
    generation_latency_seconds: number;
  };
}
```

**Do not change this shape without coordinating with the Frontend Developer agent.**

## FastAPI Endpoints
| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/health` | Liveness + Redis + Mongo ping |
| POST | `/api/v1/pipeline/trigger` | Enqueue pipeline (requires `X-Internal-Token`) |
| GET | `/api/v1/pipeline/status/{task_id}` | Poll job status |
| GET | `/api/v1/digests/{user_id}/latest` | Latest digest (consumed by Next.js) |
| GET | `/api/v1/digests/{user_id}/history` | Past digests |
| POST | `/api/v1/profiles` | Create/update user profile |
| GET | `/api/v1/profiles/{id}` | Get user profile |

## Synthesis Rules
- Target word count: 3,750–5,000 (midpoint: 4,375)
- Reading speed: 250 WPM prose / 100 WPM code / +12s per image
- Max 2 refinement iterations on word count
- LLM priority: Gemini 2.0 Flash → Gemini 1.5 Pro → Llama 3.1 8B (Ollama) → Mistral 7B (Ollama)

## Atlas Migration Path (Future)
When article volume exceeds ~100k, replace `src/ranker/vector_search.py` only:
- Current: numpy cosine over Motor cursor (self-hosted Mongo)
- Future: `$vectorSearch` aggregation (MongoDB Atlas)
- Everything else: zero changes
