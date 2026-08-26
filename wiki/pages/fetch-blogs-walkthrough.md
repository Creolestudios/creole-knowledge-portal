---
title: Fetch Blogs Microservice — What Exists and How It Runs
tags: [fetch-blogs, fastapi, celery, mongodb, gemini, scraping]
created: 2026-08-25
updated: 2026-08-25
---

# Fetch Blogs Microservice

This is the current state of `fetch-blogs/` as of 2026-08-25. It is a **running Python service**, not a placeholder.

It crawls public tech articles, ranks them against each user's Supabase profile, synthesizes a ~20–25 minute morning briefing with Gemini, and stores the result in MongoDB. Next.js never scrapes; it calls this service over HTTP.

Related decisions: [[decisions/0004-decoupled-blog-fetcher|ADR 0004]] (decoupled Python crawler) and [[decisions/003-hybrid-fetch|ADR 003]] (hybrid Strategy C).

---

## What it produces

For each user, once per calendar day (or on demand from the dashboard Generate button):

1. Discover articles from **Dev.to**, **Hacker News**, and a small **RSS** registry.
2. Extract full bodies (Dev.to API → newspaper3k / BeautifulSoup → Jina Reader).
3. Rank against the user's stack, interests, quiz learning path, and embeddings.
4. Ask Gemini to write a structured markdown briefing (TL;DR, teaching chapters, takeaways, citations).
5. Persist a `DailyDigest` in MongoDB. Next.js flattens that into the Daily Blog tab.

Target length is about **4,500 words** (~20 minutes at 225 WPM). Cron default is **08:00 IST** (`30 2 * * *` UTC), configurable via `SCRAPING_CRON_SCHEDULE`.

---

## What's done vs leftover

| Area | Status | Where |
|---|---|---|
| FastAPI app, CORS, lifespan, health probes | Done | `src/main.py`, `src/api/routes/health.py` |
| Domain-split settings (`pydantic-settings`) | Done | `src/core/config.py` |
| Mongo + Beanie documents | Done | `articles`, `user_profiles`, `daily_digests`, `pipeline_jobs` |
| Redis + Celery 5-queue app | Done | `src/workers/celery_app.py` |
| Pipeline trigger + status APIs | Done | `src/api/routes/pipeline.py` |
| Digest generate / latest / past APIs | Done | `src/api/routes/digests.py` |
| Supabase → Mongo profile sync | Done | `src/services/supabase_profiles.py` |
| Quiz learning-path write-back | Done | `POST /profiles/{user_id}/quiz` |
| Dev.to + HN + RSS scrapers | Done | `src/scrapers/` |
| `robots.txt` cache | Done | `src/config/robots_cache.py` |
| Body extraction (no browser) | Done | `src/extractors/article_body.py` |
| Gemini embeddings | Done | `src/extractors/embedding.py` |
| TF-IDF + authority + recency scorer | Done | `src/ranker/scorer.py` |
| numpy cosine vector search | Done | `src/ranker/vector_search.py` |
| Gemini re-ranker | Done | `src/ranker/llm_reranker.py` |
| Gemini synthesizer | Done | `src/generator/synthesizer.py` |
| Digest publisher + served-URL tracking | Done | `src/publisher/mongo_publisher.py` |
| APScheduler daily cron | Done | `src/core/scheduler.py`, `src/scheduler/jobs.py` |
| Local Docker (Mongo + Redis) | Done | `docker-compose.yml` |
| Prod Docker (API + 5 workers + Flower) | Done | `docker-compose.prod.yml` |
| Reddit scraper | Stub | `src/scrapers/reddit.py` (`IMPLEMENTED = False`) |
| Admin config CRUD | Stub | `src/api/routes/admin.py`, `src/models/admin.py` |
| Prompt-builder module | Stub | `src/generator/prompt_builder.py` (prompts live in `synthesizer.py`) |
| Quality-gate module | Stub | `src/generator/quality_gate.py` (`textstat` is a dep, unused) |
| Crawl4AI / Playwright | **Not used** | Replaced by newspaper3k + Jina |
| Ollama fallback | **Not used** | Gemini only |
| MongoDB Atlas `$vectorSearch` | Future | Isolated to `vector_search.py` |

There is also a **legacy in-process path** under `src/hybrid/coordinator.py` and `src/synthesis/`. The live path used by the dashboard is the Celery (or local in-process) chain in `src/api/routes/pipeline.py`.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Python 3.11–3.13, packaged with **uv** | `pyproject.toml` + `uv.lock` |
| HTTP API | **FastAPI** + Uvicorn (`fastapi[standard]`) | REST for Next.js; OpenAPI in local/staging |
| Validation | **Pydantic v2** + **pydantic-settings** | Typed env (`APP_`, `MONGO_`, `REDIS_`, `LLM_`, …) |
| HTTP client | **httpx** | Dev.to, HN, Jina, Supabase PostgREST |
| Retries | **tenacity** | Declared; used where scrapers wrap HTTP |
| Logging | **structlog** | JSON-ish structured logs |
| Errors (non-local) | **Sentry SDK** | Only if `APP_SENTRY_DSN` is set |
| Internal auth | **X-Internal-Token** vs `AUTH_SECRET_KEY` | Next.js sends this from `lib/blog-service.ts` |

### Storage and queues

| Piece | Library | Role |
|---|---|---|
| MongoDB 7 | **Motor** (async driver) + **Beanie** ODM | Articles, profiles, digests, jobs |
| Redis 7 | **redis** + **celery[redis]** | Broker `db=0`, results `db=1` |
| Workers | **Celery** 5 queues | scrape → extract → rank → generate → publish |
| Cron | **APScheduler** | Enqueues `run_scrape_stage` on the scrape queue |

### Fetch, extract, rank, generate

| Piece | Library | Role |
|---|---|---|
| RSS | **feedparser** | Parse Medium / Substack / generic feeds |
| HTML body | **newspaper3k** + **lxml-html-clean** | Primary article extract |
| HTML fallback | **BeautifulSoup4** | If newspaper fails |
| Reader fallback | **Jina Reader** (`r.jina.ai/{url}`) | Last extract hop, no API key |
| Dev.to bodies | Dev.to REST (`/api/articles/{user}/{slug}`) | Full markdown, preferred for `dev.to` URLs |
| HN metadata | Firebase HN API | Top stories; bodies extracted later |
| Keyword rank | **scikit-learn** TF-IDF + cosine | 35% of composite score |
| Vector rank | **numpy** cosine on Gemini embeddings | Isolated for a future Atlas swap |
| Embeddings | **google-generativeai** `text-embedding-004` | 768-dim, free tier |
| Re-rank + synthesis | **google-generativeai** (`LLM_GEMINI_MODEL`, default `gemini-3.6-flash`) | JSON re-rank + long-form markdown |
| Nested async in Celery | **nest-asyncio** | Same-process eager chain does not close Motor's loop |
| Readability helper | **textstat** | Installed; quality gate not wired |

No Playwright, Crawl4AI, or Scrapy in the current lockfile. The Dockerfile comment is explicit: scraping is HTTP-only.

---

## How it is wired to the rest of the portal

```
Browser
  └─ Next.js (:3000)
       ├─ Supabase Auth + PostgreSQL (source of truth for user_profiles)
       └─ lib/blog-service.ts  →  BLOG_SERVICE_URL (default http://localhost:8000/api/v1)
              │  header X-Internal-Token
              ▼
         fetch-blogs FastAPI (:8000)
              ├─ reads profiles from Supabase PostgREST
              ├─ writes articles / digests / jobs to MongoDB
              └─ (prod) Celery workers via Redis
```

Next.js BFF routes that proxy this service:

| Next.js route | FastAPI route | Purpose |
|---|---|---|
| `POST /api/digests/generate` | `POST /api/v1/digests/generate` | Run full pipeline, return flat blog |
| `GET /api/digests/latest` | `GET /api/v1/digests/{user_id}/latest` | Today's (or newest) digest |
| `GET /api/digests/past` | `GET /api/v1/digests/{user_id}/past` | History, one per calendar day |

If FastAPI is down, generate currently **errors** (it used to fall back to a Gemini-only Next.js path when `force` is true). Latest/past can fall back to the Supabase `blogs` table.

---

## How a run actually works

Production default is **Strategy C**: traditional fetch (A) + semantic/LLM rank (B) + Gemini synthesis.

```
POST /api/v1/digests/generate  { "userId": "<supabase uuid>" }
        │
        ├─ upsert_mongo_profile(userId)     # copy stack/interests from Supabase
        │
        └─ scrape → extract → rank → generate → publish
```

Local and staging/prod use the same path: FastAPI enqueues a `celery.chain` across five Redis queues (`scrape_queue` → … → `publish_queue`); Celery workers build the digest. Each task passes only IDs (article IDs, then a digest ID). Set `APP_CELERY_EAGER=true` only for in-process debug (no workers).

### Stage 1 — Scrape (`scrape_queue`)

`src/workers/scraper_tasks.py`

- Load Mongo `UserProfile`. Focus terms come from yesterday's topics, then quiz weak/next-step topics, then primary stack.
- Dev.to: tagged REST search for up to 4 terms.
- Hacker News: top stories, title must match those terms.
- RSS: registry in `src/config/source_registry.py` (currently Dev.to's feed).
- Skip URLs already on `learning_path.served_urls`, skip career-fluff titles, check `robots.txt` (HN/Dev.to hosts are allow-listed).
- Insert thin `Article` docs (URL, title, summary). Cap 24 IDs.

### Stage 2 — Extract (`extract_queue`)

`src/workers/extractor_tasks.py` + `src/extractors/article_body.py`

For each thin article, fill `body_text` until the digest word target is reached:

1. Dev.to article API if the URL is `dev.to/{user}/{slug}`.
2. newspaper3k, then BeautifulSoup.
3. `https://r.jina.ai/{url}` if still empty.

Then infer topics/tech stack/complexity and embed `title + first 2k chars` with Gemini.

### Stage 3 — Rank (`rank_queue`)

`src/workers/ranker_tasks.py`

1. Drop paywalled / robots-blocked / fluff.
2. Composite score: `0.35 TF-IDF + 0.25 authority + 0.15 recency + 0.15 engagement + 0.10 complexity_fit`.
3. numpy cosine vs `profile_embedding`.
4. Gemini re-ranks the top 15 down to 10. Writes `quality_score` and `ranking_breakdown` back onto each article.

### Stage 4 — Generate (`generate_queue`)

`src/generator/synthesizer.py`

Gemini writes teaching chapters from the top ~5 articles (short excerpts only, not full pasted blogs). If the model is short or quota-fails, it tops up from scraped technical bodies. Result is a `DailyDigest` with headline, TL;DR, sections, takeaways, and source citations.

### Stage 5 — Publish (`publish_queue`)

`src/publisher/mongo_publisher.py`

Upsert one digest per `(user_id, digest_date)`. Append cited URLs onto `learning_path.served_urls` (cap 100) and store last topics so tomorrow's scrape continues the thread.

Cron path: APScheduler → `run_scrape_stage` → load every `user_id` from Supabase → enqueue the same chain per user.

---

## Mongo collections (Beanie)

| Document | Collection | Key |
|---|---|---|
| `Article` | `articles` | unique `url` |
| `UserProfile` | `user_profiles` | unique `user_id` (mirror of Supabase + learning_path) |
| `DailyDigest` | `daily_digests` | unique `(user_id, digest_date)` |
| `PipelineJob` | `pipeline_jobs` | `job_id`, stage status |

Supabase remains source of truth for login and preference forms. Mongo holds crawl artifacts, embeddings, and generated briefings. `learning_path` (quiz outcomes, served URLs) lives on the Mongo profile so the next scrape can adapt.

---

## REST surface (`/api/v1`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health`, `/health/live`, `/health/ready` | none | Mongo + Redis pings |
| POST | `/pipeline/trigger` | internal token | enqueue chain |
| GET | `/pipeline/status/{user_id}` | none | latest `PipelineJob` |
| POST | `/digests/generate` | none (called via Next.js session) | sync profile, run pipeline, return flat blog |
| GET | `/digests/{user_id}/latest` | none | prefer today's IST digest |
| GET | `/digests/{user_id}/past` | none | history; can backfill orphan jobs |
| POST | `/digests/cron/trigger` | none | fire daily job in a background task |
| POST | `/profiles/{user_id}/sync` | internal token | copy Supabase → Mongo |
| GET | `/profiles/{user_id}` | none | Mongo mirror |
| POST | `/profiles/{user_id}/quiz` | internal token | update learning path from quiz |

---

## How to run it

### Everyday local (this is the usual path)

Infra in Docker, API on the host with hot reload:

```bash
cd fetch-blogs
cp .env.example .env          # fill LLM_GEMINI_API_KEY + Supabase keys; keep APP_CELERY_EAGER=false
uv sync
docker compose up -d          # Mongo :27017, Redis :6379
uv run fastapi dev src/main.py
# Required — same worker path as staging/prod (Windows: solo pool):
powershell -File scripts/start-workers.ps1
# Or:
uv run celery -A src.workers.celery_app worker -Q scrape_queue,extract_queue,rank_queue,generate_queue,publish_queue -P solo -l info
```

Point Next.js at it (`BLOG_SERVICE_URL=http://localhost:8000/api/v1`, `BLOG_INTERNAL_TOKEN` matching `AUTH_SECRET_KEY`). FastAPI only enqueues; workers must be running for Synthesize / Generate.

### Full Docker stack (API + five workers + Flower)

```bash
cd fetch-blogs
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

| Service | Port | Role |
|---|---|---|
| `fastapi-api` | 8000 | API + APScheduler |
| `celery-scrape` … `celery-publish` | — | one worker per queue |
| `flower` | 5555 | Celery UI |
| `mongo` | 27017 | documents |
| `redis` | 6379 | broker + results |

Dev `.env` uses `localhost` because the app is on the host. Prod compose overrides Mongo/Redis to service names `mongo` / `redis`.

### Manual trigger

```bash
curl -X POST http://localhost:8000/api/v1/digests/generate \
  -H "Content-Type: application/json" \
  -d '{"userId": "<supabase-user-uuid>"}'
```

Or via the dashboard Generate button, which hits Next.js `POST /api/digests/generate`.

### Quality gate

```bash
cd fetch-blogs
uv run mypy src --strict && uv run ruff check src && uv run ruff format --check src && uv run pytest --cov=src
```

---

## Layout

```
fetch-blogs/
├── src/main.py                 FastAPI factory + scheduler lifespan
├── src/core/                   config, db, redis, logging, scheduler, security
├── src/api/routes/             health, pipeline, digests, profiles
├── src/models/                 Beanie documents
├── src/scrapers/               Dev.to, HN, RSS (+ reddit stub)
├── src/extractors/             body, embeddings, topic/complexity heuristics
├── src/ranker/                 TF-IDF scorer, numpy vectors, Gemini re-rank
├── src/generator/              synthesizer (live); prompt_builder / quality_gate stubs
├── src/publisher/              digest upsert + served URLs
├── src/workers/                Celery app + 5 stage tasks
├── src/hybrid/                 legacy Strategy C coordinator (not the dashboard path)
├── docker-compose.yml          Mongo + Redis only
└── docker-compose.prod.yml     API, workers, Flower
```

---

## Honest gaps

- **Reddit** and **admin scoring-weight UI** were in the original plan and are still stubs.
- **Source registry** is tiny (Dev.to + HN + one RSS feed). Admin `blog_sources` in Supabase is used by the *legacy* hybrid coordinator, not the live Celery scrape worker.
- **Quality gate / textstat** is not applied after synthesis.
- **Ollama** fallback from the original plan was never wired.
- Two code generations coexist (`src/models/schemas.py` + Beanie models). New work should stay on Beanie + the Celery chain.
- Production ECS currently scales the **web** task; API/workers stay at 0 until images and Mongo/Redis secrets are filled in (see [[pages/architecture.md|architecture]]).
